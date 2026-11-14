import type Anthropic from "@anthropic-ai/sdk";
import type { ModelPass } from "../../../domain/review/index.ts";
import { type Effort, PASS_EFFORT } from "../shared/effort.ts";
import { PASS_ANSWER_FORMAT } from "../shared/output-schema.ts";
import { SYSTEM_PROMPT } from "../shared/prompts/system.ts";
import { claudeModel, DEFAULT_MODEL, effortFor } from "./models.ts";

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

/**
 * The request for one pass. Everything up to and including the PR data block is identical for
 * every pass of the same input, so passes after the first read it from the prompt cache.
 */
export const passRequest = (
  pass: ModelPass,
  renderedInput: string,
  message: string,
  model: string = MODEL,
): Omit<PassRequest, "stream"> => ({
  model,
  max_tokens: apiLimits(model).maxTokens,
  betas: [...BETAS],
  thinking: { type: "adaptive" },
  output_config: { effort: effortFor(claudeModel(model), BASE_EFFORT), format: PASS_ANSWER_FORMAT },
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
    { role: "user", content: [{ type: "text", text: message }] },
  ],
});

/** The same request without what token counting doesn't take. */
export const countTokensRequest = (
  request: Omit<PassRequest, "stream">,
): Anthropic.Beta.Messages.MessageCountTokensParams => {
  const { model, betas, thinking, output_config, system, messages } = request;
  return { model, betas, thinking, output_config, system, messages };
};
