import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "../../../application/ports/index.ts";
import type { ModelUsage } from "../../../domain/review/index.ts";
import { costUsd, HIGHEST_PRICE, PRICES, type TokenCounts } from "./pricing.ts";

export type Message = Anthropic.Beta.Messages.BetaMessage;

const tokenCounts = ({ usage }: Message): TokenCounts => ({
  inputTokens: usage.input_tokens,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  outputTokens: usage.output_tokens,
});

export const answerText = (message: Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

/** What a message used, at the price of the model that answered it, billed to the API. */
export const apiUsage = (message: Message, logger: Logger): Omit<ModelUsage, "pass"> => {
  const price = PRICES[message.model];
  if (price === undefined) {
    logger.warn("No price for model, using the highest known", { model: message.model });
  }
  const tokens = tokenCounts(message);
  return { ...tokens, costUsd: costUsd(price ?? HIGHEST_PRICE, tokens), billing: "api" };
};
