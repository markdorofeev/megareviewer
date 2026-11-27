import { describe, expect, it } from "vitest";
import { CODEX_MODELS, codexCostUsd, codexModel } from "./models.ts";

const sol61 = codexModel("gpt-6.1-sol")?.price ?? null;

const tokens = (input: number) => ({
  inputTokens: input,
  cacheReadTokens: 100_000,
  cacheWriteTokens: 0,
  outputTokens: 1_000_000,
});

describe("Codex models' prices", () => {
  it("bill a prompt up to 272K tokens at the standard rates", () => {
    expect(codexCostUsd(sol61, tokens(172_000))).toBeCloseTo(0.344 + 0.01 + 10);
  });

  it("bill a longer prompt at the long-prompt rates, its cached tokens counted in it", () => {
    expect(codexCostUsd(sol61, tokens(172_001))).toBeCloseTo(0.688004 + 0.02 + 15);
  });

  it("keep the standard rates for a model without long-prompt ones", () => {
    const astra = codexModel("gpt-6-astra")?.price ?? null;
    expect(codexCostUsd(astra, tokens(400_000))).toBeCloseTo(4 + 0.1 + 50);
  });

  it("write the cache at 1.25 times the input price", () => {
    for (const { price } of CODEX_MODELS) {
      expect(price?.cacheWrite).toBe((price?.input ?? 0) * 1.25);
      if (price?.longPrompt !== undefined) {
        expect(price.longPrompt.cacheWrite).toBe(price.longPrompt.input * 1.25);
      }
    }
  });
});
