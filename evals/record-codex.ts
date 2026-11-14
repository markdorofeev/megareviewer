// Records the Codex transport's fixtures from real runs of the signed-in `codex`:
// node evals/record-codex.ts
// The five passes on small-feature, as the AnalysisModel contract suite sends them, on GPT-6 Luna
// and the reviewer's ChatGPT plan, then one pass signed out (an empty CODEX_HOME), which spends
// about a minute on Codex's own retries. Every line is kept: the stream holds no account or path.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexRequest } from "../src/adapters/model/codex/codex-request.ts";
import { createRunCodex } from "../src/adapters/model/codex/run-codex.ts";
import {
  type EarlierResults,
  passMessage,
  renderSkeleton,
} from "../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../src/adapters/model/shared/render-input.ts";
import {
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
  smallFeatureSkeleton,
} from "../src/application/testing/index.ts";
import type { ModelPass } from "../src/domain/review/index.ts";

const OUT = new URL("../src/adapters/model/codex/fixtures/", import.meta.url);
const MODEL = "gpt-6-luna";
mkdirSync(OUT, { recursive: true });

const run = createRunCodex();

const record = async (name: string, pass: ModelPass, earlier: EarlierResults | null) => {
  const request = codexRequest(
    pass,
    renderInput(smallFeatureInput),
    passMessage(pass, earlier, undefined),
    MODEL,
  );
  const ran = await run(request.args, {
    stdin: request.stdin,
    files: request.files,
    dirs: request.dirs,
  });
  writeFileSync(new URL(`${name}.jsonl`, OUT), `${ran.lines.join("\n")}\n`);
  console.log(`${name}: exit ${ran.code}, ${ran.lines.length} events`);
};

// The contract suite's earlier results: the fixture analysis's own, not this model's.
const risk = smallFeatureAnalysis.risk.flatMap(({ hunkId, riskClass, reason }) =>
  riskClass === "mechanical" ? [] : [{ hunkId, riskClass, reason, lines: null }],
);
const { decisions } = smallFeatureAnalysis;
const skeleton = renderSkeleton({ tour: smallFeatureSkeleton, parts: [] }, smallFeatureInput);

await record("intent", "intent", null);
await record("findings", "findings", { intent: smallFeatureIntent });
await record("risk", "risk", { intent: smallFeatureIntent });
await record("decisions", "decisions", { intent: smallFeatureIntent });
await record("tour", "tour", { intent: smallFeatureIntent, risk, decisions, skeleton });

// An empty CODEX_HOME is a Codex nobody signed in to.
const empty = mkdtempSync(join(tmpdir(), "megareviewer-signed-out-"));
const home = process.env.CODEX_HOME;
process.env.CODEX_HOME = empty;
try {
  await record("not-signed-in", "intent", null);
} finally {
  if (home === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = home;
  rmSync(empty, { recursive: true, force: true });
}
