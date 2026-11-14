// Records one run of the model's passes, so the review page can be worked on and tested against
// real answers without spending the plan on every reload. By hand, when prompts change.
//
//   node evals/record-model-run.ts --fixture small-feature --synthetic
//   node evals/record-model-run.ts --url https://github.com/owner/repo/pull/2
//
// --synthetic records the fake model's answers on a fixture, which needs no credentials and is
// marked synthetic in the file name. Without it, the passes run through the reviewer's Claude
// Code, as the review page does.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClaudeCodeAnalysisModel, createRunClaude } from "../src/adapters/model/index.ts";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { AnalysisModel, PassOptions, PassOutput } from "../src/application/ports/index.ts";
import { allFixtures, FakeAnalysisModel } from "../src/application/testing/index.ts";
import type { ModelRecording } from "../src/cli/dev/model-recording.ts";
import type { ModelError, ModelPass, ModelUsage } from "../src/domain/review/index.ts";
import type { Result } from "../src/domain/shared/index.ts";
import { analyzeCase, quietLogger, systemClock } from "./harness.ts";

const { values } = parseArgs({
  options: {
    fixture: { type: "string", default: "small-feature" },
    synthetic: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const fixture = allFixtures.find((one) => one.name === values.fixture);
if (fixture === undefined) {
  throw new Error(
    `No fixture ${values.fixture}. Have: ${allFixtures.map((f) => f.name).join(", ")}`,
  );
}

type Recorded = { answer: unknown; durationMs: number; usage: ModelUsage };

/** Keeps each pass's last answer, duration and usage as the run goes. */
const recording = (model: AnalysisModel) => {
  const passes = new Map<ModelPass, Recorded>();
  const record = async <T>(
    pass: ModelPass,
    call: () => Promise<Result<PassOutput<T>, ModelError>>,
  ): Promise<Result<PassOutput<T>, ModelError>> => {
    const started = Date.now();
    const result = await call();
    if (result.ok) {
      passes.set(pass, {
        answer: result.value.value,
        durationMs: Date.now() - started,
        usage: result.value.usage,
      });
    }
    return result;
  };
  const wrapped: AnalysisModel = {
    version: model.version,
    checkSize: (input) => model.checkSize(input),
    intent: (input, options?: PassOptions) => record("intent", () => model.intent(input, options)),
    findings: (input, options) => record("findings", () => model.findings(input, options)),
    risk: (input, options) => record("risk", () => model.risk(input, options)),
    decisions: (input, options) => record("decisions", () => model.decisions(input, options)),
  };
  return { model: wrapped, passes };
};

const base = values.synthetic
  ? new FakeAnalysisModel()
  : createClaudeCodeAnalysisModel({
      run: createRunClaude(),
      logger: quietLogger(console.error),
      billing: "plan",
    });
const { model, passes } = recording(base);

const analysis = await analyzeCase(fixture, {
  model,
  parser: await createTreeSitterCodeParser({
    grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
  }),
  logger: quietLogger(console.error),
  timeoutMs: 15 * 60_000,
});
if (!analysis.ok) throw new Error(analysis.error);

const missing = (["intent", "findings", "risk", "decisions"] as const).filter(
  (pass) => !passes.has(pass),
);
if (missing.length > 0) throw new Error(`No answer recorded for ${missing.join(", ")}`);
const pass = (name: ModelPass): Recorded => {
  const recorded = passes.get(name);
  if (recorded === undefined) throw new Error(`unreachable: ${name} is recorded`);
  return recorded;
};

const result: ModelRecording = {
  pullRequestUrl: fixture.pullRequest.url,
  headSha: fixture.pullRequest.headSha,
  version: base.version,
  recordedAt: systemClock.now(),
  passes: {
    intent: pass("intent"),
    findings: pass("findings"),
    risk: pass("risk"),
    decisions: pass("decisions"),
  },
};

const out =
  values.out ??
  fileURLToPath(
    new URL(
      `../src/cli/dev/fixtures/model-run-${fixture.name}${values.synthetic ? ".synthetic" : ""}.json`,
      import.meta.url,
    ),
  );
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${out}`);
