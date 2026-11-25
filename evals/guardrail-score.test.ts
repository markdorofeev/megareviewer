import { describe, expect, it } from "vitest";
import { type Guardrail, guardrailOf } from "../src/domain/review/index.ts";
import { guardrailCases } from "./guardrail-cases.ts";
import { meetsTargets, scoreGuardrailCase, sumScores } from "./guardrail-score.ts";

const biome: Guardrail = {
  is: "rule",
  tool: "biome",
  rule: "noFloatingPromises",
  configPath: "biome.json",
};
const labels = {
  f1: [{ is: "rule", tool: "biome", rules: ["noFloatingPromises"] }],
  f2: null,
  f3: [{ is: "suggested", kinds: ["architecture-rule"] }],
} as const;

describe("scoreGuardrailCase", () => {
  it("counts a labeled guardrail returned as one the label accepts", () => {
    const score = scoreGuardrailCase(
      new Map<string, Guardrail>([
        ["f1", biome],
        [
          "f3",
          {
            is: "suggested",
            kind: "architecture-rule",
            engine: "ArchUnit",
            does: "Services never import a controller.",
          },
        ],
      ]),
      labels,
    );
    expect(score).toEqual({
      guardrailRight: { hit: 2, total: 2 },
      guardrailWrong: { hit: 0, total: 2 },
    });
    expect(meetsTargets(score)).toEqual({ guardrailRight: true, guardrailWrong: true });
  });

  it("counts a mark on a point labeled none, or a rule no label lists, as wrong", () => {
    const score = scoreGuardrailCase(
      new Map<string, Guardrail>([
        ["f1", { ...biome, rule: "noMisusedPromises" }],
        ["f2", biome],
        ["f3", { is: "suggested", kind: "pattern-rule", engine: "Semgrep", does: "x." }],
      ]),
      labels,
    );
    expect(score).toEqual({
      guardrailRight: { hit: 0, total: 2 },
      guardrailWrong: { hit: 2, total: 3 },
    });
    expect(meetsTargets(score)).toEqual({ guardrailRight: false, guardrailWrong: false });
  });

  it("adds cases up", () => {
    const none = scoreGuardrailCase(new Map(), { f1: null });
    expect(sumScores([none, none])).toEqual({
      guardrailRight: { hit: 0, total: 0 },
      guardrailWrong: { hit: 0, total: 0 },
    });
  });
});

describe("the guardrail call's cases", () => {
  it.each(guardrailCases)("$name labels every point it has, and only those", (evalCase) => {
    expect(Object.keys(evalCase.labels).sort()).toEqual(
      evalCase.input.points.map((point) => point.ref).sort(),
    );
  });

  it.each(
    guardrailCases.flatMap((evalCase) =>
      Object.entries(evalCase.labels).flatMap(([ref, accepted]) =>
        (accepted ?? []).flatMap((one) =>
          one.is === "rule" ? one.rules.map((rule) => ({ evalCase, ref, one, rule })) : [],
        ),
      ),
    ),
  )(
    "verifies $rule against its case's config, so a right answer can be right",
    ({ evalCase, one, rule }) => {
      if (one.is !== "rule") throw new Error("unreachable");
      const guardrail = guardrailOf(
        {
          kind: "lint-rule",
          tool: one.tool,
          engine: one.tool,
          rule,
          on: false,
          does: "Reports it.",
        },
        evalCase.input.configs,
        evalCase.changedPaths,
      );
      expect(guardrail).toMatchObject({ is: "rule", rule });
    },
  );

  it("says nothing of the Python case's mutable default, whose rule the config selects", () => {
    const python = guardrailCases.find((evalCase) => evalCase.name === "python-except-and-default");
    expect(
      guardrailOf(
        {
          kind: "lint-rule",
          tool: "ruff",
          engine: "Ruff",
          rule: "B006",
          on: false,
          does: "Reports a mutable default argument.",
        },
        python?.input.configs ?? [],
        python?.changedPaths ?? [],
      ),
    ).toBeNull();
  });
});
