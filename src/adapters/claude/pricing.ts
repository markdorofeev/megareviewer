/** US dollars per million tokens. */
export interface RateCard {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  /** Writes with the default 5-minute lifetime: 1.25× input. */
  readonly cacheWrite: number;
}

export interface ModelPrice extends RateCard {
  /** A request whose prompt is longer than `aboveTokens` is billed at these rates instead. */
  readonly longPrompt?: { readonly aboveTokens: number; readonly rates: RateCard };
}

/**
 * First-party API prices from the claude-api skill's table (cached 2026-10-06). Check them
 * whenever the model changes.
 */
export const PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPrompt: {
      aboveTokens: 100_000,
      rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
    },
  },
};

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
