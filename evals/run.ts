// Runs the golden set through the real pipeline and model, scores it and prints a summary:
// node evals/run.ts [--case <name>]... [--via api|claude-code] [--baseline evals/baseline.json]
//   [--write-baseline] --yes
// Spends money: without --yes it prints the estimated cost and stops. Needs Anthropic
// credentials (ANTHROPIC_API_KEY or `ant auth login`) for the judge, and with --via claude-code
// a signed-in Claude Code for the passes. See evals/README.md.

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
} from "../src/adapters/claude/index.ts";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import { PIPELINE_VERSION } from "../src/application/use-cases/index.ts";
import type { Analysis } from "../src/domain/review/index.ts";
import { Baseline, COMPARED, compareWithBaseline, regressedCases, toBaseline } from "./baseline.ts";
import { type EvalCase, evalCases } from "./cases/index.ts";
import { estimateCost } from "./cost.ts";
import { analyzeCase, quietLogger } from "./harness.ts";
import { JUDGE_MODEL, JUDGE_VERSION, judgeCase } from "./judge.ts";
import { countRatings, type JudgeVerdict } from "./judge-verdict.ts";
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

const CASE_TIMEOUT_MS = 20 * 60 * 1000;
const CONCURRENCY = 3;

const { values } = parseArgs({
  options: {
    case: { type: "string", multiple: true },
    baseline: { type: "string" },
    "write-baseline": { type: "boolean", default: false },
    // The API by default, so runs stay comparable with the baseline, which was measured on it.
    via: { type: "string", default: "api" },
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
console.log(
  `${selected.length} case${selected.length === 1 ? "" : "s"}, judged by ${JUDGE_MODEL}: about $${estimate.totalUsd.toFixed(2)} ` +
    `(${estimate.measured} at their baseline cost, ${estimate.assumed} at ` +
    `$${estimate.assumedPerCaseUsd.toFixed(2)} each${baseline === null ? ", not measured yet" : ""}).`,
);
if (!values.yes) {
  console.log("Nothing was run. Pass --yes to run and pay for it.");
  process.exit(1);
}

const client = new Anthropic();
if (client.apiKey === null && client.authToken === null && (await loadConfig()) === null) {
  console.error("No Anthropic credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.");
  process.exit(1);
}

if (values.via !== "api" && values.via !== "claude-code") {
  console.error("--via must be api or claude-code.");
  process.exit(1);
}
const runClaude = createRunClaude();
let claudeCodeBilling: "api" | "plan" = "plan";
if (values.via === "claude-code") {
  const status = await claudeCodeStatus(runClaude);
  if (status.state !== "signed-in") {
    console.error(`--via claude-code needs Claude Code signed in; it's ${status.state}.`);
    process.exit(1);
  }
  claudeCodeBilling = status.billing;
}

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
  > | null;
}

const runCase = async (evalCase: EvalCase, modelVersion: (v: string) => void) => {
  const problems: string[] = [];
  const logger = quietLogger((line) => problems.push(line));
  const model =
    values.via === "claude-code"
      ? createClaudeCodeAnalysisModel({ run: runClaude, billing: claudeCodeBilling, logger })
      : createClaudeAnalysisModel({ client, logger });
  modelVersion(model.version);
  const started = performance.now();
  const latency = () => (performance.now() - started) / 1000;
  const failed = (error: string, analysis: Analysis | null, judgeUsd = 0): CaseResult => ({
    name: evalCase.name,
    status: "error",
    error,
    problems,
    cost: {
      modelUsd: analysis?.usage.reduce((total, usage) => total + usage.costUsd, 0) ?? 0,
      judgeUsd,
      latencyS: latency(),
    },
    score: null,
    verdict: null,
    judgeModels: [],
    analysis,
  });

  const result = await analyzeCase(evalCase.fixture, {
    model,
    parser,
    logger,
    timeoutMs: CASE_TIMEOUT_MS,
  });
  if (!result.ok) return failed(result.error, null);
  const analysis = result.value;
  const latencyS = latency();
  if (analysis.status !== "complete") {
    const error = analysis.error;
    return failed(
      error === null ? "analysis failed" : `${error.stage}: ${error.code}: ${error.message}`,
      analysis,
    );
  }

  const judged = await judgeCase(client, analysis, evalCase.labels);
  if (!judged.ok) return failed(judged.error.message, analysis, judged.error.costUsd);
  const { verdict, costUsd, models } = judged.value;
  return {
    name: evalCase.name,
    status: "scored",
    error: null,
    problems,
    cost: {
      modelUsd: analysis.usage.reduce((total, usage) => total + usage.costUsd, 0),
      judgeUsd: costUsd,
      latencyS,
    },
    score: scoreCase(analysis, evalCase.labels, verdict),
    verdict,
    judgeModels: models,
    analysis,
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
        };
      }
      results.push(result);
      save();
      const judgeModel = result.judgeModels.find((model) => model !== JUDGE_MODEL);
      console.log(
        `${result.status === "scored" ? "✓" : "✗"} ${result.name}` +
          ` · $${(result.cost.modelUsd + result.cost.judgeUsd).toFixed(2)}` +
          ` · ${result.cost.latencyS.toFixed(0)} s` +
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
  `\nCost: $${summary.modelCostUsd.toFixed(2)} model + $${summary.judgeCostUsd.toFixed(2)} judge` +
    ` ($${summary.modelCostPerCaseUsd.toFixed(2)} model per case).` +
    ` Latency: ${summary.latencyS.max.toFixed(0)} s for the slowest case.`,
);
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
