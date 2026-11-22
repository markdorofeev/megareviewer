// Runs the guardrail call's golden set through a signed-in Claude Code on Sonnet 5.5, keeps what
// the server would keep, and scores it: node evals/run-guardrails.ts [--yes]
// It spends the plan's usage limits, so without --yes it says what it would run and stops.

import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  claudeCodeStatus,
  createClaudeCodeAdvisor,
  createRunClaude,
} from "../src/adapters/model/index.ts";
import { type Guardrail, guardrailOf } from "../src/domain/review/index.ts";
import { guardrailCases } from "./guardrail-cases.ts";
import {
  type GuardrailCallScore,
  meetsTargets,
  scoreGuardrailCase,
  sumScores,
} from "./guardrail-score.ts";
import { quietLogger } from "./harness.ts";

const MODEL = "claude-sonnet-5-5";

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });
console.log(
  `${guardrailCases.length} cases, the guardrail call on Claude Code with ${MODEL}: one call each, out of the plan's usage limits.`,
);
if (!values.yes) {
  console.log("Nothing was run. Pass --yes to run it.");
  process.exit(1);
}

const run = createRunClaude();
const status = await claudeCodeStatus(run);
if (status.state !== "signed-in") {
  console.error(`Claude Code needs to be signed in; it's ${status.state}.`);
  process.exit(1);
}
const advisor = createClaudeCodeAdvisor({
  run,
  billing: status.billing,
  model: MODEL,
  logger: quietLogger((line) => console.error(line)),
});

const now = new Date().toISOString();
interface CaseResult {
  readonly name: string;
  readonly seconds: number;
  readonly costUsd: number | null;
  readonly answer: unknown;
  /** What the server kept, by point ref. */
  readonly kept: Readonly<Record<string, Guardrail>>;
  readonly score: GuardrailCallScore | null;
  readonly error: string | null;
}
const results: CaseResult[] = [];
for (const evalCase of guardrailCases) {
  const started = Date.now();
  const answered = await advisor.advise(evalCase.input);
  const seconds = (Date.now() - started) / 1000;
  if (!answered.ok) {
    console.log(`${evalCase.name}: failed, ${answered.error.message}`);
    results.push({
      name: evalCase.name,
      seconds,
      costUsd: null,
      answer: null,
      kept: {},
      score: null,
      error: answered.error.message,
    });
    continue;
  }
  // As the run does: the first mark on a point that exists stands, if the server can stand behind it.
  const refs = new Set(evalCase.input.points.map((point) => point.ref));
  const kept = new Map<string, Guardrail>();
  for (const mark of answered.value.value.marks) {
    const ref = mark.point.trim();
    if (!refs.has(ref) || kept.has(ref)) continue;
    const guardrail = guardrailOf(mark.guardrail, evalCase.input.configs, evalCase.changedPaths);
    if (guardrail !== null) kept.set(ref, guardrail);
  }
  const score = scoreGuardrailCase(kept, evalCase.labels);
  const { marks } = answered.value.value;
  console.log(
    `${evalCase.name}: ${marks.length} marks, ${kept.size} kept, ${seconds.toFixed(1)} s, ` +
      `$${(answered.value.usage.costUsd ?? 0).toFixed(3)} at API prices`,
  );
  console.log(JSON.stringify({ marks, kept: Object.fromEntries(kept) }, null, 2));
  results.push({
    name: evalCase.name,
    seconds,
    costUsd: answered.value.usage.costUsd,
    answer: answered.value.value,
    kept: Object.fromEntries(kept),
    score,
    error: null,
  });
}

const total = sumScores(results.flatMap((result) => (result.score === null ? [] : [result.score])));
const met = meetsTargets(total);
console.log("\nmetric | hit / total | target met");
for (const name of ["guardrailRight", "guardrailWrong"] as const) {
  console.log(`${name} | ${total[name].hit} / ${total[name].total} | ${met[name] ? "yes" : "no"}`);
}

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
const file = new URL(`./results/guardrail-call-${now.replace(/:/g, "-")}.json`, import.meta.url);
writeFileSync(
  file,
  `${JSON.stringify({ measuredAt: now, model: MODEL, results, total }, null, 2)}\n`,
);
console.log(`\nWrote ${file.pathname}`);
