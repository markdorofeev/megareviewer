import { describe, expect, it } from "vitest";
import { Baseline, compareWithBaseline, regressedCases, toBaseline } from "./baseline.ts";
import { estimateCost, UNMEASURED_COST_PER_CASE_USD } from "./cost.ts";
import { type CaseScore, summarize } from "./score.ts";

const score = (overrides: Partial<CaseScore> = {}): CaseScore => ({
  contractRecall: { hit: 2, total: 2 },
  riskAccuracy: { hit: 4, total: 5 },
  riskNoise: { hit: 1, total: 3 },
  riskPlaced: { hit: 2, total: 2 },
  findingRecall: { hit: 1, total: 1 },
  findingNoise: { hit: 0, total: 2 },
  findingPlaced: { hit: 1, total: 1 },
  decisionRecall: { hit: 1, total: 1 },
  decisionNoise: { hit: 1, total: 4 },
  mismatchRecall: { hit: 1, total: 1 },
  mismatchNamed: { hit: 1, total: 1 },
  mismatchFalsePositives: null,
  injectionResisted: null,
  firstTryValid: true,
  fallbackUsed: false,
  ...overrides,
});

const versions = { modelVersion: "claude-opus-5-5/p1", pipelineVersion: "1", judgeVersion: 1 };

const baselineOf = (scores: Record<string, CaseScore>, costUsd: number) => {
  const map = new Map(Object.entries(scores));
  const costs = new Map(
    Object.keys(scores).map((name) => [name, { modelUsd: costUsd, judgeUsd: 0.1, latencyS: 60 }]),
  );
  return toBaseline(
    versions,
    "2026-10-22T10:00:00.000Z",
    summarize(map.size, [...map.values()], [...costs.values()]),
    map,
    costs,
  );
};

describe("baseline", () => {
  const baseline = baselineOf(
    { a: score(), b: score({ injectionResisted: true, mismatchFalsePositives: 0 }) },
    1,
  );

  it("round-trips through JSON as scores only", () => {
    const parsed = Baseline.parse(JSON.parse(JSON.stringify(baseline)));
    expect(parsed).toEqual(baseline);
    expect(parsed.cases.a?.costUsd).toBeCloseTo(1.1);
    expect(JSON.stringify(parsed)).not.toContain('decisions":[{');
  });

  it("compares each metric, knowing which way is worse", () => {
    const now = summarize(
      2,
      [
        score({
          contractRecall: { hit: 1, total: 2 },
          findingNoise: { hit: 1, total: 2 },
          decisionNoise: { hit: 0, total: 4 },
        }),
        score({ injectionResisted: true, mismatchFalsePositives: 2 }),
      ],
      [],
    );
    const rows = new Map(compareWithBaseline(now, baseline).map((row) => [row.metric, row]));
    expect(rows.get("contractRecall")).toMatchObject({ baseline: 1, current: 0.75, worse: true });
    expect(rows.get("findingNoise")).toMatchObject({ delta: 0.25, worse: true });
    expect(rows.get("decisionNoise")).toMatchObject({ delta: -0.125, worse: false });
    expect(rows.get("mismatchFalsePositives")).toMatchObject({ delta: 2, worse: true });
    expect(rows.get("injectionResistance")).toMatchObject({ delta: 0, worse: false });
  });

  it("names the cases that got worse on a target metric", () => {
    const now = new Map([
      [
        "a",
        score({
          findingRecall: { hit: 0, total: 1 },
          findingNoise: { hit: 1, total: 2 },
          decisionNoise: { hit: 3, total: 4 },
        }),
      ],
      ["b", score({ injectionResisted: false, mismatchFalsePositives: 1 })],
      ["new", score({ contractRecall: { hit: 0, total: 2 } })],
    ]);
    expect(regressedCases(now, baseline)).toEqual([
      { name: "a", metric: "findingRecall" },
      { name: "a", metric: "findingNoise" },
      { name: "a", metric: "decisionNoise" },
      { name: "b", metric: "mismatchFalsePositives" },
      { name: "b", metric: "injectionResistance" },
    ]);
  });
});

describe("estimateCost", () => {
  it("assumes a cost per case before anything was measured", () => {
    expect(estimateCost(["a", "b"], null)).toEqual({
      totalUsd: 2 * UNMEASURED_COST_PER_CASE_USD,
      measured: 0,
      assumed: 2,
      assumedPerCaseUsd: UNMEASURED_COST_PER_CASE_USD,
    });
  });

  it("uses each case's baseline cost, and the baseline's average for new cases", () => {
    const baseline = baselineOf({ a: score(), b: score() }, 2);
    const estimate = estimateCost(["a", "new"], baseline);
    expect(estimate.measured).toBe(1);
    expect(estimate.assumedPerCaseUsd).toBeCloseTo(2.1);
    expect(estimate.totalUsd).toBeCloseTo(4.2);
  });
});
