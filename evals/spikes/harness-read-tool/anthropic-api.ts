// The spike on the Anthropic API: node evals/spikes/harness-read-tool/anthropic-api.ts
// Spends ANTHROPIC_API_KEY (Haiku 5.5): two passes of one PR with one custom tool, each answering
// a tool call the script serves from the fixture directory, and the usage of each request.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { passRequest } from "../../../src/adapters/model/claude/request.ts";
import { PassAnswer } from "../../../src/adapters/model/shared/output-schema.ts";
import { answerJson } from "../../../src/adapters/model/shared/prompted-answer.ts";
import { passMessage } from "../../../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../../../src/adapters/model/shared/render-input.ts";
import { smallFeatureInput } from "../../../src/application/testing/index.ts";
import { makeFixture } from "./fixture.ts";

const TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: "read_harness_file",
  description: "Read one of the repository's harness files (docs/notes.md), whole.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
};
const client = new Anthropic();
const fixture = makeFixture();
// The fixture PR alone may be under the model's cacheable minimum, so it's padded.
const rendered = `${renderInput(smallFeatureInput)}\n<!-- ${Date.now()} ${"filler ".repeat(4000)}-->`;
const log: unknown[] = [];

const run = async (pass: "intent" | "risk", tools: boolean) => {
  const task = `Before answering, call read_harness_file once with path docs/notes.md.\n\n${passMessage(pass, null, undefined)}`;
  const request = passRequest(
    pass,
    rendered,
    tools ? task : passMessage(pass, null, undefined),
    "claude-haiku-5-5",
  );
  const messages = [...request.messages];
  for (let round = 1; round <= 4; round++) {
    const message = await client.beta.messages
      .stream({ ...request, messages, ...(tools ? { tools: [TOOL] } : {}) })
      .finalMessage();
    const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } = message.usage;
    const calls = message.content.filter((block) => block.type === "tool_use");
    const line = {
      pass,
      tools,
      round,
      stop: message.stop_reason,
      input_tokens,
      cache_write: cache_creation_input_tokens,
      cache_read: cache_read_input_tokens,
      calls: calls.map((call) => call.input),
    };
    log.push(line);
    console.log(JSON.stringify(line));
    if (calls.length === 0) {
      const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      const parsed = PassAnswer.safeParse(answerJson(text));
      console.log(`  PassAnswer ${parsed.success ? "ok" : parsed.error.message.slice(0, 200)}`);
      return;
    }
    messages.push(
      { role: "assistant", content: message.content },
      {
        role: "user",
        content: calls.map((call) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: readFileSync(join(fixture.dir, "docs/notes.md"), "utf8"),
        })),
      },
    );
  }
};

await run("intent", true);
await run("risk", true);
// The control: the same PR without the tool is another prefix.
await run("risk", false);
writeFileSync(
  new URL("../../results/harness-read-tool/anthropic-api.json", import.meta.url),
  JSON.stringify(log, null, 1),
);
fixture.remove();
