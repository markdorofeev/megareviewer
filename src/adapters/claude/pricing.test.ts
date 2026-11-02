import { describe, expect, it } from "vitest";
import { costUsd, HIGHEST_PRICE, PRICES } from "./pricing.ts";
import { MODEL } from "./request.ts";

const price = PRICES[MODEL];
if (price === undefined) throw new Error(`no price for ${MODEL}`);

const tokens = (prompt: { input: number; cacheRead: number; cacheWrite: number }) => ({
  inputTokens: prompt.input,
  cacheReadTokens: prompt.cacheRead,
  cacheWriteTokens: prompt.cacheWrite,
  outputTokens: 500_000,
});

describe("costUsd", () => {
  it("prices each kind of token per million", () => {
    // $0.10 input, $0.01 cache read, $0.125 cache write, $0.50 output.
    expect(
      costUsd(price, tokens({ input: 40_000, cacheRead: 50_000, cacheWrite: 10_000 })),
    ).toBeCloseTo(0.004 + 0.0005 + 0.00125 + 0.25, 10);
  });

  it("bills a prompt over 100K tokens, cached parts included, at the long-prompt rates", () => {
    // $0.50 input, $0.05 cache read, $0.625 cache write, $2.50 output.
    expect(
      costUsd(price, tokens({ input: 40_000, cacheRead: 50_001, cacheWrite: 10_000 })),
    ).toBeCloseTo(0.02 + 0.00250005 + 0.00625 + 1.25, 10);
  });

  it("is zero for no tokens", () => {
    const none = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    expect(costUsd(HIGHEST_PRICE, none)).toBe(0);
  });
});

describe("prices", () => {
  it("cover the model the passes run on", () => {
    expect(price).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      longPrompt: {
        aboveTokens: 100_000,
        rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
      },
    });
  });

  it("write the cache at 1.25 times the input price", () => {
    for (const { longPrompt, ...rates } of Object.values(PRICES)) {
      expect(rates.cacheWrite).toBe(rates.input * 1.25);
      if (longPrompt !== undefined) {
        expect(longPrompt.rates.cacheWrite).toBe(longPrompt.rates.input * 1.25);
      }
    }
  });

  it("fall back to the highest of each, long-prompt rates included", () => {
    expect(HIGHEST_PRICE).toEqual({ input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 });
  });
});
