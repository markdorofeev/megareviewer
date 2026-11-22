// Whether Claude Code and the API accept the answer schema with the steps pass's variant:
// node evals/union-check.ts. One small call on each, on Haiku 5.5; spends a little of the plan and
// the API account, so CI never runs it.

import Anthropic from "@anthropic-ai/sdk";
import {
  claudeCodeArgs,
  SYSTEM_PROMPT_FILE,
} from "../src/adapters/model/claude/claude-code-request.ts";
import { createRunClaude } from "../src/adapters/model/claude/run-claude.ts";
import { TOUR_PASS_ANSWER_FORMAT } from "../src/adapters/model/shared/output-schema.ts";

const MODEL = "claude-haiku-5-5";
const SYSTEM =
  "Answer with JSON matching the given schema, with pass set to the task you're asked to do.";
const TASK =
  "Task: steps. This pull request has fewer than 3 hops, so answer the steps task with no steps.";
const print = (text: string) => process.stdout.write(`${text}\n`);

const run = createRunClaude({ timeoutMs: 180_000 });
const code = await run(claudeCodeArgs(MODEL, "low", TOUR_PASS_ANSWER_FORMAT.schema), {
  files: { [SYSTEM_PROMPT_FILE]: SYSTEM },
  stdin: TASK,
});
const result = code.lines.map((line) => JSON.parse(line)).find((event) => event.type === "result");
print(`Claude Code: exit ${code.code}, ${result?.subtype ?? "no result"}`);
print(`  structured_output: ${JSON.stringify(result?.structured_output ?? null)}`);
if (result?.is_error === true || result?.structured_output === undefined) {
  print(`  result: ${JSON.stringify(result ?? null).slice(0, 2000)}`);
  print(`  stderr: ${code.stderr.slice(0, 2000)}`);
}

const client = new Anthropic();
try {
  const message = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2_000,
    output_config: { effort: "low", format: TOUR_PASS_ANSWER_FORMAT },
    system: SYSTEM,
    messages: [{ role: "user", content: TASK }],
  });
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
  print(`API: ${message.stop_reason}, ${text.join("")}`);
} catch (error) {
  print(`API refused: ${error instanceof Error ? error.message : String(error)}`);
}
