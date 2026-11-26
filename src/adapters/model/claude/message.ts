import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "../../../application/ports/index.ts";
import type { ModelUsage } from "../../../domain/review/index.ts";
import { costUsd, HIGHEST_PRICE, PRICES, type TokenCounts } from "./pricing.ts";
import type { ToolUse } from "./read-file.ts";

export type Message = Anthropic.Beta.Messages.BetaMessage;
export type ApiUsage = Omit<ModelUsage, "pass">;

const tokenCounts = ({ usage }: Message): TokenCounts => ({
  inputTokens: usage.input_tokens,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  outputTokens: usage.output_tokens,
});

export const answerText = (message: Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

export const toolUses = (message: Message): ToolUse[] =>
  message.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));

/** What a message used, at the price of the model that answered it, billed to the API. */
export const apiUsage = (message: Message, logger: Logger): ApiUsage => {
  const price = PRICES[message.model];
  if (price === undefined) {
    logger.warn("No price for model, using the highest known", { model: message.model });
  }
  const tokens = tokenCounts(message);
  return { ...tokens, costUsd: costUsd(price ?? HIGHEST_PRICE, tokens), billing: "api" };
};

/** Each request is priced on its own, since a longer prompt can have another price. */
export const addUsage = (a: ApiUsage, b: ApiUsage): ApiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd,
  billing: a.billing,
});
