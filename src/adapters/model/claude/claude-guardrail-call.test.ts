import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import { guardrailAnswer, guardrailInput } from "../shared/fixtures/guardrail-call.ts";
import { GUARDRAIL_ANSWER_FORMAT } from "../shared/guardrail-call.ts";
import { GUARDRAILS_SYSTEM_PROMPT } from "../shared/prompts/guardrails.ts";
import { createClaudeAdvisor } from "./claude-one-call.ts";
import {
  createAnthropicFetch,
  type FixtureAnswer,
  type FixtureMessage,
} from "./fixtures/anthropic-fetch.ts";
import errors from "./fixtures/errors.synthetic.json" with { type: "json" };
import smallFeature from "./fixtures/small-feature.synthetic.json" with { type: "json" };

/** Synthetic, as the passes' are: a final message in the API's shape, saying `answer`. */
const saying = (answer: unknown): FixtureMessage => ({
  ...smallFeature.passes.intent,
  id: "msg_synthetic_advise",
  content: smallFeature.passes.intent.content.map((block) =>
    block.type === "text" ? { ...block, text: JSON.stringify(answer) } : block,
  ),
});

const advisorWith = (answer: FixtureAnswer = saying(guardrailAnswer)) => {
  const { fetch, requests } = createAnthropicFetch({ guardrails: answer });
  const logger = new RecordingLogger();
  const client = new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });
  const advisor = createClaudeAdvisor({ client, logger, model: "claude-haiku-5-5" });
  return { advisor, requests, logger };
};

describe("ClaudeAdvisor's guardrail call", () => {
  it("returns the marks, billed to the API", async () => {
    const result = await advisorWith().advisor.advise(guardrailInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value).toEqual(guardrailAnswer);
    expect(result.value.usage.billing).toBe("api");
  });

  it("sends one request with no tools: its own prompt and schema, the signals as data", async () => {
    const { advisor, requests } = advisorWith();
    await advisor.advise(guardrailInput);
    expect(requests).toHaveLength(1);
    const body = requests[0]?.body;
    expect(body).toMatchObject({
      output_config: { effort: "medium", format: GUARDRAIL_ANSWER_FORMAT },
      system: GUARDRAILS_SYSTEM_PROMPT,
    });
    expect(body).not.toHaveProperty("tools");
    const text = body?.messages[0]?.content[0]?.text ?? "";
    expect(text.startsWith("<guardrail_data>")).toBe(true);
  });

  it("fails an answer outside the schema as invalid output, and a refusal in its words", async () => {
    const wrong = await advisorWith(saying({ groups: [] })).advisor.advise(guardrailInput);
    expect(wrong.ok || wrong.error.kind).toBe("invalid-output");
    const refused = await advisorWith(errors.messages.refusal).advisor.advise(guardrailInput);
    if (refused.ok) throw new Error("expected the call to fail");
    expect(refused.error).toEqual({
      kind: "refusal",
      message: "The model declined to say which points a check could catch.",
    });
  });
});
