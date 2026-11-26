import type Anthropic from "@anthropic-ai/sdk";
import type { ModelPass } from "../../../domain/review/index.ts";
import { type Effort, PASS_EFFORT } from "../shared/effort.ts";
import type { OneCall } from "../shared/one-call.ts";
import { passText } from "../shared/prompted-answer.ts";
import { SYSTEM_PROMPT } from "../shared/prompts/system.ts";
import { claudeModel, DEFAULT_MODEL, effortFor } from "./models.ts";
import { READ_FILE } from "./read-file.ts";

/** The model a run uses when none is chosen. */
export const MODEL = DEFAULT_MODEL;
/** The default's limits, for a model missing from the table. */
const DEFAULT_LIMITS = claudeModel(DEFAULT_MODEL);
export const MAX_TOKENS = DEFAULT_LIMITS?.maxOutputTokens.api ?? 64_000;
/** The largest PR, in input tokens, either transport sends. */
export const MAX_INPUT_TOKENS = DEFAULT_LIMITS?.maxInputTokens ?? 400_000;

/** A model's limits on the API path, or the default's for one the table doesn't have. */
export const apiLimits = (model: string) => {
  const known = claudeModel(model);
  return {
    maxInputTokens: known?.maxInputTokens ?? MAX_INPUT_TOKENS,
    maxTokens: known?.maxOutputTokens.api ?? MAX_TOKENS,
  };
};

/**
 * The top-level effort is the same for every pass, because changing it invalidates the cached
 * messages. Each pass sets its own in a system message after the cached PR data instead.
 */
const BASE_EFFORT: Effort = "medium";

export const BETAS = [
  // Effort in a role: "system" message.
  "mid-conversation-output-config-2026-07-01",
] as const;

type PassRequest = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/**
 * The request for one pass. Everything up to and including the PR data block is identical for
 * every pass of a run, the steps pass too, so passes after the first read it from the prompt cache.
 *
 * It has no output format: the API refuses the passes' union as too large a grammar, and a format
 * per pass would miss that cache. Each pass's task ends with its own schema instead.
 *
 * A run with something to read sends the read tool on every pass: tools come before the PR in the
 * prefix, so a pass without it would read nothing from the cache.
 */
export const passRequest = (
  pass: ModelPass,
  renderedInput: string,
  message: string,
  model: string = MODEL,
  reads = false,
): Omit<PassRequest, "stream"> => ({
  model,
  max_tokens: apiLimits(model).maxTokens,
  betas: [...BETAS],
  thinking: { type: "adaptive" },
  output_config: { effort: effortFor(claudeModel(model), BASE_EFFORT) },
  ...(reads ? { tools: [READ_FILE] } : {}),
  system: SYSTEM_PROMPT,
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: renderedInput, cache_control: { type: "ephemeral" } }],
    },
    {
      role: "system",
      content: [],
      output_config: { effort: effortFor(claudeModel(model), PASS_EFFORT[pass]) },
    },
    { role: "user", content: [{ type: "text", text: passText(pass, message) }] },
  ],
});

/** One round of reading: what the model asked for, as it answered it, and what it was given. */
export interface ReadRound {
  readonly asked: readonly ContentBlock[];
  readonly given: readonly ToolResult[];
}

/** The API takes four breakpoints a request, and the PR has one. */
const CACHED_ROUNDS = 3;

/**
 * A pass's request after its rounds of reading, each a user message of every result, the last of
 * which is cached so the next round doesn't pay for the file again. Only the latest rounds keep
 * their breakpoints; what the others wrote is still read through them.
 */
export const afterReading = (
  request: Omit<PassRequest, "stream">,
  rounds: readonly ReadRound[],
): Omit<PassRequest, "stream"> => ({
  ...request,
  messages: [
    ...request.messages,
    ...rounds.flatMap(({ asked, given }, round): PassRequest["messages"] => [
      // Thinking goes back as it came: the API checks it against the conversation.
      { role: "assistant", content: [...asked] },
      {
        role: "user",
        content: given.map((result, index) =>
          round >= rounds.length - CACHED_ROUNDS && index === given.length - 1
            ? { ...result, cache_control: { type: "ephemeral" } }
            : result,
        ),
      },
    ]),
  ],
});

/** The same request without what token counting doesn't take. */
export const countTokensRequest = (
  request: Omit<PassRequest, "stream">,
): Anthropic.Beta.Messages.MessageCountTokensParams => {
  const { model, betas, thinking, output_config, tools, system, messages } = request;
  return {
    model,
    betas,
    thinking,
    output_config,
    ...(tools === undefined ? {} : { tools }),
    system,
    messages,
  };
};

/**
 * A call of its own, the suggestion or the guardrail call: its own instructions and schema, its data in
 * one message. It shares nothing with the passes, so nothing in it is cached.
 */
export const oneCallRequest = (
  call: OneCall<unknown>,
  message: string,
  model: string = MODEL,
): Omit<PassRequest, "stream"> => ({
  model,
  max_tokens: apiLimits(model).maxTokens,
  thinking: { type: "adaptive" },
  output_config: {
    effort: effortFor(claudeModel(model), call.effort),
    format: call.format,
  },
  system: call.systemPrompt,
  messages: [{ role: "user", content: [{ type: "text", text: message }] }],
});
