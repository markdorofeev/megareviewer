import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODELS,
  type ClaudeModel,
  claudeModel,
  DEFAULT_MODEL,
  effortFor,
} from "./models.ts";

const only = (efforts: ClaudeModel["efforts"]): ClaudeModel => {
  const [haiku] = CLAUDE_MODELS;
  if (haiku === undefined) throw new Error("no models");
  return { ...haiku, efforts };
};

describe("Claude's models", () => {
  it("list Haiku, Sonnet and Opus 5.5, and Sonnet is the default", () => {
    expect(CLAUDE_MODELS.map((model) => model.name)).toEqual([
      "Haiku 5.5",
      "Sonnet 5.5",
      "Opus 5.5",
    ]);
    expect(claudeModel(DEFAULT_MODEL)?.name).toBe("Sonnet 5.5");
    expect(claudeModel("claude-nothing")).toBeUndefined();
  });

  it("run a pass at its own effort when the model accepts it", () => {
    for (const model of CLAUDE_MODELS) expect(effortFor(model, "high")).toBe("high");
    expect(effortFor(undefined, "low")).toBe("low");
  });

  it("run a pass at the nearest effort the model accepts, the lower on a tie", () => {
    expect(effortFor(only(["medium", "high"]), "low")).toBe("medium");
    expect(effortFor(only(["low"]), "high")).toBe("low");
    expect(effortFor(only(["low", "high"]), "medium")).toBe("low");
  });
});
