import type Anthropic from "@anthropic-ai/sdk";
import type { ModelPass } from "../../domain/review/index.ts";
import { PASS_ANSWER_FORMAT } from "./output-schema.ts";
import { SYSTEM_PROMPT } from "./prompts/system.ts";

/** The cheapest model, so a review costs cents. ARCHITECTURE.md has the trade-off. */
export const MODEL = "claude-haiku-5-5";
export const MAX_TOKENS = 64_000;

type Effort = "low" | "medium" | "high";

/** ARCHITECTURE.md's pass table. */
export const PASS_EFFORT: Readonly<Record<ModelPass, Effort>> = {
  intent: "medium",
  risk: "low",
  decisions: "high",
  tour: "medium",
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
): Omit<PassRequest, "stream"> => ({
  model: MODEL,
  max_tokens: MAX_TOKENS,
  betas: [...BETAS],
  thinking: { type: "adaptive" },
  output_config: { effort: BASE_EFFORT, format: PASS_ANSWER_FORMAT },
  system: SYSTEM_PROMPT,
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: renderedInput, cache_control: { type: "ephemeral" } }],
    },
    { role: "system", content: [], output_config: { effort: PASS_EFFORT[pass] } },
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
