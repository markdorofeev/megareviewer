import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import type { ModelErrorKind } from "../../../domain/review/index.ts";
import { suggestedDrafts, suggestionInput } from "../shared/fixtures/suggestion.ts";
import { SUGGEST_SYSTEM_PROMPT } from "../shared/prompts/suggest.ts";
import { SUGGESTION_ANSWER_FORMAT } from "../shared/suggestion.ts";
import { createClaudeSuggester } from "./claude-suggester.ts";
import {
  createAnthropicFetch,
  type FixtureAnswer,
  type FixtureMessage,
} from "./fixtures/anthropic-fetch.ts";
import errors from "./fixtures/errors.synthetic.json" with { type: "json" };
import smallFeature from "./fixtures/small-feature.synthetic.json" with { type: "json" };
import { costUsd, PRICES } from "./pricing.ts";

/** Synthetic, as the passes' are: a final message in the API's shape, saying `answer`. */
const saying = (answer: unknown): FixtureMessage => ({
  ...smallFeature.passes.intent,
  id: "msg_synthetic_suggest",
  content: smallFeature.passes.intent.content.map((block) =>
    block.type === "text" ? { ...block, text: JSON.stringify(answer) } : block,
  ),
});

const suggesterWith = (suggestion: FixtureAnswer = saying({ proposals: suggestedDrafts })) => {
  const { fetch, requests } = createAnthropicFetch({ suggestion });
  const logger = new RecordingLogger();
  const client = new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });
  // The fixture's message is Haiku 5.5's.
  const suggester = createClaudeSuggester({ client, logger, model: "claude-haiku-5-5" });
  return { suggester, requests, logger };
};

const expectFailure = async (answer: FixtureAnswer, kind: ModelErrorKind, message?: RegExp) => {
  const result = await suggesterWith(answer).suggester.suggest(suggestionInput);
  if (result.ok) throw new Error("expected the call to fail");
  expect(result.error.kind).toBe(kind);
  if (message !== undefined) expect(result.error.message).toMatch(message);
};

describe("ClaudeSuggester", () => {
  it("returns the proposals and what the call used, billed to the API", async () => {
    const result = await suggesterWith().suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    const { usage } = smallFeature.passes.intent;
    const tokens = {
      inputTokens: usage.input_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens,
      outputTokens: usage.output_tokens,
    };
    const price = PRICES["claude-haiku-5-5"];
    if (price === undefined) throw new Error("no price for the model");
    expect(result.value).toEqual({
      value: suggestedDrafts,
      usage: { ...tokens, costUsd: costUsd(price, tokens), billing: "api" },
    });
  });

  it("sends one request with no tools: its own prompt and schema, the history as data", async () => {
    const { suggester, requests } = suggesterWith();
    await suggester.suggest(suggestionInput);
    expect(requests).toHaveLength(1);
    const body = requests[0]?.body;
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      stream: true,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: SUGGESTION_ANSWER_FORMAT },
      system: SUGGEST_SYSTEM_PROMPT,
    });
    expect(body).not.toHaveProperty("tools");
    expect(body?.messages).toHaveLength(1);
    const text = body?.messages[0]?.content[0]?.text ?? "";
    expect(text.startsWith("<review_history>")).toBe(true);
    expect(text).toMatch(/^Task: suggest\.$/m);
  });

  it("fails an answer that isn't JSON, or isn't proposals, as invalid output", async () => {
    await expectFailure(errors.messages.malformed, "invalid-output", /isn't JSON/);
    await expectFailure(smallFeature.passes.intent, "invalid-output", /proposals/);
  });

  it("says a refusal and a cut-off answer in the suggestion's words", async () => {
    await expectFailure(errors.messages.refusal, "refusal", /declined to suggest preferences/);
    await expectFailure(errors.messages.maxTokens, "max-tokens", /64000/);
  });

  it.each([
    ["unauthorized", errors.http.unauthorized, "unauthorized"],
    ["rate-limited", errors.http.rateLimited, "rate-limited"],
    ["overloaded", errors.http.overloaded, "overloaded"],
    ["no network", "no-network", "network"],
  ] as const)("maps %s, and logs it", async (_, answer, kind) => {
    const { suggester, logger } = suggesterWith(answer);
    const result = await suggester.suggest(suggestionInput);
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.error.kind).toBe(kind);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: "warn", fields: expect.objectContaining({ kind }) }),
    );
  });
});
