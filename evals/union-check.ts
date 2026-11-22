// Whether Claude Code accepts the answer schema with the steps pass's variant:
// node evals/union-check.ts. One small call on Haiku 5.5; spends a little of the plan, so CI never
// runs it. The API sends no format, since it refused this one and the four's as too large a grammar.

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
