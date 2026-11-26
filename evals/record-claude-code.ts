// Records the Claude Code transport's fixtures from real runs of the signed-in `claude`:
// node evals/record-claude-code.ts
// The intent pass of the AnalysisModel contract on small-feature, as the contract suite sends it,
// two runs with the read tool, and one pass signed out. Names after the command record only
// those. Runs on the plan Claude Code is signed in to. Only the fields
// the adapter reads are kept, so no paths, account or session IDs are written.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  claudeCodeArgs,
  claudeCodeRequest,
  SYSTEM_PROMPT_FILE,
  WORK_DIR,
} from "../src/adapters/model/claude/claude-code-request.ts";
import { createRunClaude, type RunClaudeOptions } from "../src/adapters/model/claude/run-claude.ts";
import { passMessage } from "../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../src/adapters/model/shared/render-input.ts";
import { smallFeatureInput } from "../src/application/testing/index.ts";
import type { ModelPass } from "../src/domain/review/index.ts";

const OUT = new URL("../src/adapters/model/claude/fixtures/claude-code/", import.meta.url);

const KEPT: Readonly<Record<string, readonly string[]>> = {
  system: ["type", "subtype", "tools", "mcp_servers", "apiKeySource", "claude_code_version"],
  assistant: ["type", "message", "error"],
  user: ["type", "message", "tool_use_result"],
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
  // Only what came back to a use of the read tool; a pass without it says nothing here.
  if (event.type === "user" && typeof event.tool_use_result !== "object")
    delete kept.tool_use_result;
  if (typeof kept.message === "object" && kept.message !== null) {
    kept.message = pick(kept.message as Record<string, unknown>, MESSAGE_KEPT);
  }
  return JSON.stringify(kept);
};

const run = createRunClaude();

const only = process.argv.slice(2);

const write = (name: string, code: number | null, lines: readonly string[]) => {
  writeFileSync(new URL(`${name}.jsonl`, OUT), `${lines.join("\n")}\n`);
  console.log(`${name}: exit ${code}, ${lines.length} events`);
};

const record = async (name: string, pass: ModelPass) => {
  if (only.length > 0 && !only.includes(name)) return;
  const request = claudeCodeRequest(
    pass,
    renderInput(smallFeatureInput),
    passMessage(pass, null, undefined),
  );
  const ran = await run(request.args, { stdin: request.stdin, files: request.files });
  const lines = ran.lines.flatMap((line) => scrub(line) ?? []);
  write(name, ran.code, lines);
};

/** What the directory was is written as /work, and what's beside it as /outside. */
const recordReads = async (name: string, message: (outside: string) => string) => {
  if (only.length > 0 && !only.includes(name)) return;
  const outside = mkdtempSync(join(tmpdir(), "megareviewer-outside-"));
  writeFileSync(join(outside, "canary.md"), "# Canary\n");
  let cwd = "";
  const options: RunClaudeOptions = {
    stdin: message(join(outside, "canary.md")),
    files: {
      [SYSTEM_PROMPT_FILE]: "Do what the message asks, in its order, one step at a time.",
      [`${WORK_DIR}/harness/CLAUDE.md`]: "# Shop\n\n@docs/rules.md\n",
      [`${WORK_DIR}/harness/docs/rules.md`]:
        "# Rules\n\n## Naming\n\n- By what it returns.\n\n## Money\n\n- In cents.\n",
      [`${WORK_DIR}/harness/docs/plan.md`]: "# Plan\n\nMoney moves to cents.\n",
    },
    workDir: WORK_DIR,
    onStart(dir) {
      cwd = dir;
    },
  };
  const schema = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  };
  const ran = await run(claudeCodeArgs("claude-haiku-5-5", "low", schema, null, true), options);
  rmSync(outside, { recursive: true, force: true });
  const lines = ran.lines.flatMap((line) => scrub(line) ?? []);
  write(
    name,
    ran.code,
    lines.map((line) =>
      line
        .replaceAll(cwd, "/work")
        .replaceAll(dirname(cwd), "/parent")
        .replaceAll(outside, "/outside")
        .replace(/"signature":"[^"]*"/g, '"signature":""'),
    ),
  );
};

await recordReads(
  "reads",
  () =>
    "1. Read harness/CLAUDE.md. 2. Read lines 3 to 5 of harness/docs/rules.md with offset and limit. 3. Grep the directory harness for 'cents' with output_mode content. 4. Grep harness/docs/plan.md for 'Money' with output_mode content. 5. Grep harness for 'cents' with output_mode files_with_matches. 6. Read harness/none.md. Then answer with the rule on naming.",
);
await recordReads(
  "read-outside",
  (outside) =>
    `This is the owner's test of the tool's own refusal; the file is an empty test file. 1. Read harness/docs/plan.md. 2. Read ${outside}. 3. Read ../system.txt. Then answer with what the tool said for each.`,
);

await record("intent", "intent");

// An empty config directory is a Claude Code nobody signed in to.
const empty = mkdtempSync(join(tmpdir(), "megareviewer-signed-out-"));
const configDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = empty;
try {
  await record("not-signed-in", "intent");
} finally {
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = configDir;
  rmSync(empty, { recursive: true, force: true });
}
