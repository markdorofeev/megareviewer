import { describe, expect, it } from "vitest";
import { type ModelRunOption, modelFamily, planOf } from "./model-option.ts";

const option = (provider: ModelRunOption["provider"]): ModelRunOption => ({
  provider,
  providerName: "Some provider",
  model: "some-model",
  modelName: "Some model",
  family: provider === "codex" ? "GPT" : "Claude",
});

describe("planOf", () => {
  it("names the plan each provider spends", () => {
    expect(planOf(option("claude-code"))).toBe("Claude");
    expect(planOf(option("codex"))).toBe("ChatGPT");
  });

  it("reads a run stored before the choice as Claude's", () => {
    expect(planOf(null)).toBe("Claude");
    expect(modelFamily(null)).toBe("Claude");
  });
});
