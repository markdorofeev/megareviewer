// Runs the golden set through the real pipeline and model, scores it and prints a summary:
// node evals/run.ts [--case <name>]... [--via claude-code|api] [--model <id>] [--effort <level>]
//   [--baseline evals/baseline.json] [--write-baseline] --yes
// Without --yes it prints the estimate and stops. The judge runs on a signed-in Claude Code, and so
// do the passes, unless --via api runs them on the API (ANTHROPIC_API_KEY or `ant auth login`).
// See evals/README.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "@anthropic-ai/sdk/core/credentials";
import {
  claudeCodeStatus,
  createClaudeAnalysisModel,
  createClaudeCodeAnalysisModel,
  createRunClaude,
  DEFAULT_MODEL,
  EFFORTS,
} from "../src/adapters/model/index.ts";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import { PIPELINE_VERSION } from "../src/application/use-cases/index.ts";
import type { Analysis } from "../src/domain/review/index.ts";
import { Baseline, COMPARED, compareWithBaseline, regressedCases, toBaseline } from "./baseline.ts";
import { type EvalCase, evalCases } from "./cases/index.ts";
import { estimateCost } from "./cost.ts";
import { analyzeCase, quietLogger } from "./harness.ts";
import { JUDGE_MODEL, JUDGE_VERSION, judgeCase } from "./judge.ts";
import { countRatings, type JudgeVerdict } from "./judge-verdict.ts";
import { parseVia, preflight } from "./preflight.ts";
import {
  type CaseCost,
  type CaseScore,
  isTargetMetric,
  meetsTarget,
  type Ratio,
  rate,
  scoreCase,
  summarize,
} from "./score.ts";
import { type CaseTiming, showTiming, timingOf } from "./timing.ts";

const CASE_TIMEOUT_MS = 20 * 60 * 1000;
const CONCURRENCY = 3;

const { values } = parseArgs({
  options: {
    case: { type: "string", multiple: true },
    baseline: { type: "string" },
    "write-baseline": { type: "boolean", default: false },
    // Claude Code by default, so runs stay comparable with the baseline, which was measured on it.
    via: { type: "string", default: "claude-code" },
    // An option's model for the passes, the default's when left out. The judge stays on Opus.
    model: { type: "string" },
    // One effort for every pass in place of each pass's own; Claude Code only.
    effort: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const selected: EvalCase[] = [];
for (const name of values.case ?? evalCases.map((c) => c.name)) {
  const found = evalCases.find((c) => c.name === name);
  if (found === undefined) {
    console.error(`No case named ${name}. Cases: ${evalCases.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }
  selected.push(found);
}

const baseline =
  values.baseline === undefined
    ? null
    : Baseline.parse(JSON.parse(readFileSync(values.baseline, "utf8")));

const estimate = estimateCost(
  selected.map((c) => c.name),
  baseline,
);
const via = parseVia(values.via);
if (via === null) {
  console.error("--via must be api or claude-code.");
  process.exit(1);
}
if (values.effort !== undefined && via !== "claude-code") {
  console.error("--effort runs the passes on Claude Code only; leave out --via api.");
  process.exit(1);
}
const effort = values.effort === undefined ? undefined : EFFORTS.find((e) => e === values.effort);
if (values.effort !== undefined && effort === undefined) {
  console.error(`--effort must be one of ${EFFORTS.join(", ")}.`);
  process.exit(1);
}
console.log(
  `${selected.length} case${selected.length === 1 ? "" : "s"}, the passes on ${via === "api" ? "the API" : "Claude Code"}` +
    ` with ${values.model ?? `${DEFAULT_MODEL}, the default`}` +
    `${effort === undefined ? "" : ` at ${effort} effort`}, ` +
    `judged by ${JUDGE_MODEL} on Claude Code: about $${estimate.totalUsd.toFixed(2)} at API prices ` +
    `(${estimate.measured} at their baseline cost, ${estimate.assumed} at ` +
    `$${estimate.assumedPerCaseUsd.toFixed(2)} each${baseline === null ? ", not measured yet" : ""}). ` +
    "What runs on Claude Code comes out of its plan's usage limits instead.",
);
if (!values.yes) {
  console.log("Nothing was run. Pass --yes to run it.");
  process.exit(1);
}

const runClaude = createRunClaude();
const client = via === "api" ? new Anthropic() : null;
const ready = await preflight(via, {
  claudeCode: () => claudeCodeStatus(runClaude),
  hasApiCredentials: async () =>
    client !== null &&
    (client.apiKey !== null || client.authToken !== null || (await loadConfig()) !== null),
});
if (!ready.ok) {
  console.error(ready.error);
  process.exit(1);
}
const claudeCodeBilling = ready.value.billing;

const parser = await createTreeSitterCodeParser({
  grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
});

interface CaseResult {
  readonly name: string;
  /** error: the analysis failed, timed out, threw, or the judge failed. Not scored. */
  readonly status: "scored" | "error";
  readonly error: string | null;
  readonly problems: readonly string[];
  readonly cost: CaseCost;
  readonly score: CaseScore | null;
  readonly verdict: JudgeVerdict | null;
  readonly judgeModels: readonly string[];
  readonly analysis: Pick<
    Analysis,
    | "status"
    | "error"
    | "intent"
    | "findings"
    | "risk"
    | "decisions"
    | "tour"
    | "warnings"
    | "usage"
    | "modelCalls"
  > | null;
  /** Null when the analysis never started. */
  readonly timing: CaseTiming | null;
}

const runCase = async (evalCase: EvalCase, modelVersion: (v: string) => void) => {
  const problems: string[] = [];
  const logger = quietLogger((line) => problems.push(line));
  const model =
    client === null
      ? createClaudeCodeAnalysisModel({
          run: runClaude,
          billing: claudeCodeBilling,
          logger,
          ...(values.model === undefined ? {} : { model: values.model }),
          ...(effort === undefined ? {} : { effort }),
        })
      : createClaudeAnalysisModel({
          client,
          logger,
          ...(values.model === undefined ? {} : { model: values.model }),
        });
  modelVersion(model.version);
  const since = (started: number) => (performance.now() - started) / 1000;
  const analysisStarted = performance.now();
  const failed = (
    error: string,
    analysis: Analysis | null,
    judge: { usd: number; s: number } | null = null,
  ): CaseResult => {
    const latencyS = since(analysisStarted) - (judge?.s ?? 0);
    return {
      name: evalCase.name,
      status: "error",
      error,
      problems,
      cost: {
        modelUsd: analysis?.usage.reduce((total, usage) => total + (usage.costUsd ?? 0), 0) ?? 0,
        judgeUsd: judge?.usd ?? 0,
        latencyS,
      },
      score: null,
      verdict: null,
      judgeModels: [],
      analysis,
      timing: analysis === null ? null : timingOf(analysis, latencyS, judge?.s ?? null),
    };
  };

  const result = await analyzeCase(evalCase.fixture, {
    model,
    parser,
    logger,
    timeoutMs: CASE_TIMEOUT_MS,
  });
  if (!result.ok) return failed(result.error, null);
  const { analysis, input } = result.value;
  const latencyS = since(analysisStarted);
  if (analysis.status !== "complete") {
    const error = analysis.error;
    return failed(
      error === null ? "analysis failed" : `${error.stage}: ${error.code}: ${error.message}`,
      analysis,
    );
  }

  if (input === null) return failed("the model never ran, so there's nothing to judge", analysis);
  const judgeStarted = performance.now();
  const judged = await judgeCase(runClaude, input, analysis, evalCase.labels, {
    onPlan: claudeCodeBilling === "plan",
  });
  const judgeS = since(judgeStarted);
  if (!judged.ok) {
    return failed(judged.error.message, analysis, { usd: judged.error.costUsd, s: judgeS });
  }
  const { verdict, costUsd, models } = judged.value;
  return {
    name: evalCase.name,
    status: "scored",
    error: null,
    problems,
    cost: {
      modelUsd: analysis.usage.reduce((total, usage) => total + (usage.costUsd ?? 0), 0),
      judgeUsd: costUsd,
      latencyS,
    },
    score: scoreCase(analysis, evalCase.labels, verdict),
    verdict,
    judgeModels: models,
    analysis,
    timing: timingOf(analysis, latencyS, judgeS),
  } satisfies CaseResult;
};

const startedAt = new Date().toISOString();
const resultsDir = new URL("./results/", import.meta.url);
mkdirSync(resultsDir, { recursive: true });
const resultsFile = new URL(`${startedAt.replaceAll(":", "-")}.json`, resultsDir);

const results: CaseResult[] = [];
let modelVersion = "unknown";
const save = () =>
  writeFileSync(
    resultsFile,
    `${JSON.stringify(
      {
        startedAt,
        modelVersion,
        pipelineVersion: PIPELINE_VERSION,
        judgeVersion: JUDGE_VERSION,
        cases: results,
      },
      null,
      2,
    )}\n`,
  );

// A few cases at a time; each one's passes already run in parallel where the pipeline allows.
const queue = [...selected];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      console.log(`… ${next.name}`);
      let result: CaseResult;
      try {
        result = await runCase(next, (version) => {
          modelVersion = version;
        });
      } catch (error) {
        // An SDK error the adapter didn't map, or the judge's request failing.
        result = {
          name: next.name,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          problems: [],
          cost: { modelUsd: 0, judgeUsd: 0, latencyS: 0 },
          score: null,
          verdict: null,
          judgeModels: [],
          analysis: null,
          timing: null,
        };
      }
      results.push(result);
      save();
      const judgeModel = result.judgeModels.find((model) => model !== JUDGE_MODEL);
      console.log(
        `${result.status === "scored" ? "✓" : "✗"} ${result.name}` +
          ` · $${(result.cost.modelUsd + result.cost.judgeUsd).toFixed(2)}` +
          ` · ${result.timing === null ? `${result.cost.latencyS.toFixed(0)} s` : showTiming(result.timing)}` +
          (result.error === null ? "" : ` · ${result.error}`) +
          (judgeModel === undefined ? "" : ` · judge answered by ${judgeModel}`),
      );
    }
  }),
);

const scores = new Map(
  results.flatMap((result) => (result.score === null ? [] : [[result.name, result.score]])),
);
const costs = new Map(results.map((result) => [result.name, result.cost]));
const summary = summarize(selected.length, [...scores.values()], [...costs.values()]);

const show = (value: Ratio | number | null): string => {
  if (value === null) return "–";
  if (typeof value === "number") return String(value);
  const r = rate(value);
  return r === null ? "–" : `${(r * 100).toFixed(0)}% (${value.hit}/${value.total})`;
};

console.log(`\nScored ${summary.scored} of ${summary.cases} cases.\n`);
const comparison = baseline === null ? null : compareWithBaseline(summary, baseline);
const showDelta = (metric: string, delta: number | null | undefined, worse: boolean): string => {
  if (delta === null || delta === undefined) return "";
  const count = metric === "mismatchFalsePositives";
  const amount = count ? delta.toFixed(0) : `${(delta * 100).toFixed(0)} pts`;
  return `  ${delta >= 0 ? "+" : ""}${amount}${worse ? " worse" : ""}`;
};
for (const metric of COMPARED) {
  const target = isTargetMetric(metric) ? meetsTarget(summary, metric) : null;
  const mark = target === null ? " " : target ? "✓" : "✗";
  const row = comparison?.find((c) => c.metric === metric);
  const delta = showDelta(metric, row?.delta, row?.worse ?? false);
  console.log(`${mark} ${metric.padEnd(24)} ${show(summary[metric]).padEnd(16)}${delta}`);
}
const ratings = countRatings(results.flatMap((result) => result.verdict ?? []));
const tally = (counts: readonly (readonly [string, number])[]) =>
  counts.map(([rating, n]) => `${rating} ${n}`).join(" · ");
console.log(`\nFinding ratings: ${tally(ratings.findings)}`);
console.log(`Decision ratings: ${tally(ratings.decisions)}`);
console.log(
  `\nCost at API prices: $${summary.modelCostUsd.toFixed(2)} model + $${summary.judgeCostUsd.toFixed(2)} judge, the judge's on the Claude plan` +
    ` ($${summary.modelCostPerCaseUsd.toFixed(2)} model per case).` +
    ` Latency: ${summary.latencyS.max.toFixed(0)} s for the slowest case.`,
);
console.log("\nTime, slowest analysis first:");
const width = Math.max(...results.map((result) => result.name.length));
for (const result of [...results].sort((a, b) => b.cost.latencyS - a.cost.latencyS)) {
  const time =
    result.timing === null ? `${result.cost.latencyS.toFixed(0)} s` : showTiming(result.timing);
  console.log(`  ${result.name.padEnd(width)}  ${time}`);
}
if (baseline !== null) {
  if (baseline.modelVersion !== modelVersion) {
    console.log(`Baseline was measured on ${baseline.modelVersion}, this run on ${modelVersion}.`);
  }
  for (const { name, metric } of regressedCases(scores, baseline)) {
    console.log(`Worse than baseline: ${name} on ${metric}`);
  }
}
console.log(`\nResults: ${fileURLToPath(resultsFile)}`);

if (values["write-baseline"]) {
  const out = new URL("./baseline.json", import.meta.url);
  const versions = { modelVersion, pipelineVersion: PIPELINE_VERSION, judgeVersion: JUDGE_VERSION };
  writeFileSync(
    out,
    `${JSON.stringify(toBaseline(versions, startedAt, summary, scores, costs), null, 2)}\n`,
  );
  console.log(`Wrote ${fileURLToPath(out)}`);
}
