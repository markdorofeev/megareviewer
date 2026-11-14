import { CLAUDE_MODELS, type ModelPrice } from "./models.ts";

export type { ModelPrice, RateCard } from "./models.ts";

/** Each listed model's price, by its ID. */
export const PRICES: Readonly<Record<string, ModelPrice>> = Object.fromEntries(
  CLAUDE_MODELS.map((model) => [model.id, model.price]),
);

const rateCards = Object.values(PRICES).flatMap((price) =>
  price.longPrompt === undefined ? [price] : [price, price.longPrompt.rates],
);

/** For a model missing from the table: the highest known prices, so cost is never understated. */
export const HIGHEST_PRICE: ModelPrice = {
  input: Math.max(...rateCards.map((rates) => rates.input)),
  output: Math.max(...rateCards.map((rates) => rates.output)),
  cacheRead: Math.max(...rateCards.map((rates) => rates.cacheRead)),
  cacheWrite: Math.max(...rateCards.map((rates) => rates.cacheWrite)),
};

export interface TokenCounts {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

/** One request's cost. Its prompt is everything it sent: uncached, read from and written to cache. */
export const costUsd = (price: ModelPrice, tokens: TokenCounts): number => {
  const prompt = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
  const rates =
    price.longPrompt !== undefined && prompt > price.longPrompt.aboveTokens
      ? price.longPrompt.rates
      : price;
  return (
    (tokens.inputTokens * rates.input +
      tokens.cacheReadTokens * rates.cacheRead +
      tokens.cacheWriteTokens * rates.cacheWrite +
      tokens.outputTokens * rates.output) /
    1_000_000
  );
};
