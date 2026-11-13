// Records the Claude Code transport's fixtures from real runs of the signed-in `claude`:
// node evals/record-claude-code.ts
// The four passes of the AnalysisModel contract on small-feature, as the contract suite sends
// them, and one pass signed out. Runs on the plan Claude Code is signed in to. Only the fields
// the adapter reads are kept, so no paths, account or session IDs are written.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeRequest } from "../src/adapters/claude/claude-code-request.ts";
import {
  type EarlierResults,
  passMessage,
  renderSkeleton,
} from "../src/adapters/claude/prompts/passes.ts";
import { renderInput } from "../src/adapters/claude/render-input.ts";
import { createRunClaude } from "../src/adapters/claude/run-claude.ts";
import {
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
  smallFeatureSkeleton,
} from "../src/application/testing/index.ts";
import type { ModelPass } from "../src/domain/review/index.ts";

const OUT = new URL("../src/adapters/claude/fixtures/claude-code/", import.meta.url);

const KEPT: Readonly<Record<string, readonly string[]>> = {
  system: ["type", "subtype", "tools", "mcp_servers", "apiKeySource", "claude_code_version"],
  assistant: ["type", "message", "error"],
  user: ["type"],
  rate_limit_event: ["type", "rate_limit_info"],
  result: [
    "type",
    "subtype",
    "is_error",
    "result",
    "structured_output",
    "stop_reason",
    "terminal_reason",
    "api_error_status",
    "total_cost_usd",
    "usage",
    "num_turns",
  ],
};
const MESSAGE_KEPT = ["model", "role", "content", "stop_reason", "usage"];

const pick = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.flatMap((key) => (key in value ? [[key, value[key]]] : [])));

const scrub = (line: string): string | null => {
  const event = JSON.parse(line) as Record<string, unknown>;
  const keys = KEPT[String(event.type)];
  if (keys === undefined) return null;
  const kept = pick(event, keys);
  if (event.type === "system" && event.subtype !== "init") return null;
  if (typeof kept.message === "object" && kept.message !== null) {
    kept.message = pick(kept.message as Record<string, unknown>, MESSAGE_KEPT);
  }
  return JSON.stringify(kept);
};

const run = createRunClaude();

const record = async (name: string, pass: ModelPass, earlier: EarlierResults | null) => {
  const request = claudeCodeRequest(
    pass,
    renderInput(smallFeatureInput),
    passMessage(pass, earlier, undefined),
  );
  const ran = await run(request.args, { stdin: request.stdin, files: request.files });
  const lines = ran.lines.flatMap((line) => scrub(line) ?? []);
  writeFileSync(new URL(`${name}.jsonl`, OUT), `${lines.join("\n")}\n`);
  console.log(`${name}: exit ${ran.code}, ${lines.length} events`);
};

// The contract suite's earlier results: the fixture analysis's own, not this model's.
const risk = smallFeatureAnalysis.risk.flatMap(({ hunkId, riskClass, reason }) =>
  riskClass === "mechanical" ? [] : [{ hunkId, riskClass, reason }],
);
const { decisions } = smallFeatureAnalysis;
const skeleton = renderSkeleton({ tour: smallFeatureSkeleton, parts: [] }, smallFeatureInput);

await record("intent", "intent", null);
await record("risk", "risk", { intent: smallFeatureIntent });
await record("decisions", "decisions", { intent: smallFeatureIntent });
await record("tour", "tour", { intent: smallFeatureIntent, risk, decisions, skeleton });

// An empty config directory is a Claude Code nobody signed in to.
const empty = mkdtempSync(join(tmpdir(), "megareviewer-signed-out-"));
const configDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = empty;
try {
  await record("not-signed-in", "intent", null);
} finally {
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = configDir;
  rmSync(empty, { recursive: true, force: true });
}
