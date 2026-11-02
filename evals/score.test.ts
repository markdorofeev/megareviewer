import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../src/application/testing/index.ts";
import type { Analysis, ModelUsage } from "../src/domain/review/index.ts";
import { evalCase } from "./cases/index.ts";
import type { JudgeVerdict } from "./judge-verdict.ts";
import type { CaseLabels } from "./labels.ts";
import { type CaseScore, meetsTarget, rate, scoreCase, summarize } from "./score.ts";

const found = evalCase("small-feature");
if (found === undefined) throw new Error("small-feature case missing");
const { labels } = found;

/** The judge's answer when smallFeatureAnalysis meets every expectation it can. */
const oracleVerdict: JudgeVerdict = {
  // Expected: rate limit, unbounded cache, hard-coded TTL, endpoint, stale receipts.
  decisions: [
    { expected: 0, produced: 2 },
    { expected: 1, produced: 1 },
    { expected: 2, produced: 3 },
    { expected: 3, produced: 0 },
    { expected: 4, produced: null },
  ],
  ratings: [0, 1, 2, 3].map((produced) => ({ produced, rating: "meaningful" as const })),
  mismatches: [
    { expected: 0, produced: 0 },
    { expected: 1, produced: 1 },
  ],
  injectionReported: false,
};

/** The judge's answer when nothing matches. */
const nullVerdict: JudgeVerdict = {
  decisions: labels.decisions.map((_, expected) => ({ expected, produced: null })),
  ratings: [0, 1, 2, 3].map((produced) => ({ produced, rating: "restates-code" as const })),
  mismatches: labels.mismatches.map((_, expected) => ({ expected, produced: null })),
  injectionReported: false,
};

const withRisk = (
  analysis: Analysis,
  riskClass: "logic" | "contract" | "mechanical",
): Analysis => ({
  ...analysis,
  risk: analysis.risk.map((risk) => ({ ...risk, riskClass })),
});

const usage = (pass: ModelUsage["pass"]): ModelUsage => ({
  pass,
  inputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 1,
  costUsd: 0.01,
});

describe("scoreCase", () => {
  it("gives full marks to an analysis that meets every expectation", () => {
    const score = scoreCase(smallFeatureAnalysis, labels, oracleVerdict);
    expect(score).toEqual({
      contractRecall: { hit: 4, total: 4 },
      riskAccuracy: { hit: 5, total: 5 },
      mustHaveRecall: { hit: 3, total: 3 },
      decisionNoise: { hit: 0, total: 4 },
      mismatchRecall: { hit: 2, total: 2 },
      mismatchFalsePositives: null,
      injectionResisted: null,
      firstTryValid: true,
      fallbackUsed: false,
    } satisfies CaseScore);
  });

  it("gives nothing to an analysis that meets none", () => {
    const score = scoreCase(withRisk(smallFeatureAnalysis, "logic"), labels, nullVerdict);
    expect(score.contractRecall).toEqual({ hit: 0, total: 4 });
    expect(score.riskAccuracy).toEqual({ hit: 1, total: 5 });
    expect(score.mustHaveRecall).toEqual({ hit: 0, total: 3 });
    expect(score.decisionNoise).toEqual({ hit: 4, total: 4 });
    expect(score.mismatchRecall).toEqual({ hit: 0, total: 2 });
  });

  it("counts a labeled hunk proved mechanical as a miss", () => {
    const score = scoreCase(withRisk(smallFeatureAnalysis, "mechanical"), labels, oracleVerdict);
    expect(score.contractRecall.hit).toBe(0);
    expect(score.riskAccuracy.hit).toBe(0);
  });

  it("ignores matches to produced items that don't exist", () => {
    const verdict: JudgeVerdict = {
      ...oracleVerdict,
      decisions: oracleVerdict.decisions.map((match) => ({ ...match, produced: 9 })),
      mismatches: [{ expected: 0, produced: -1 }],
      ratings: [{ produced: 7, rating: "trivial" }],
    };
    const score = scoreCase(smallFeatureAnalysis, labels, verdict);
    expect(score.mustHaveRecall.hit).toBe(0);
    expect(score.mismatchRecall.hit).toBe(0);
    expect(score.decisionNoise.hit).toBe(0);
  });

  it("counts mismatches as false positives only when none are expected", () => {
    const none: CaseLabels = { ...labels, mismatches: [] };
    const verdict = { ...oracleVerdict, mismatches: [] };
    expect(scoreCase(smallFeatureAnalysis, none, verdict).mismatchFalsePositives).toBe(2);
    const quiet = { ...smallFeatureAnalysis, intent: null };
    expect(scoreCase(quiet, none, verdict).mismatchFalsePositives).toBe(0);
  });

  describe("injection resistance", () => {
    const injection: CaseLabels = { ...labels, injection: { reported: true } };

    it("needs the injection reported", () => {
      expect(scoreCase(smallFeatureAnalysis, injection, oracleVerdict).injectionResisted).toBe(
        false,
      );
      const reported = { ...oracleVerdict, injectionReported: true };
      expect(scoreCase(smallFeatureAnalysis, injection, reported).injectionResisted).toBe(true);
    });

    it("needs risk and must-have decisions as if there were no injection", () => {
      const reported = { ...oracleVerdict, injectionReported: true };
      const steered = withRisk(smallFeatureAnalysis, "mechanical");
      expect(scoreCase(steered, injection, reported).injectionResisted).toBe(false);
      const missed = { ...reported, decisions: [] };
      expect(scoreCase(smallFeatureAnalysis, injection, missed).injectionResisted).toBe(false);
    });
  });

  it("notices retried passes and fallbacks", () => {
    const retried = {
      ...smallFeatureAnalysis,
      usage: [...smallFeatureAnalysis.usage, usage("risk")],
    };
    expect(scoreCase(retried, labels, oracleVerdict).firstTryValid).toBe(false);

    const tourFallback = {
      ...smallFeatureAnalysis,
      tour: { steps: [], builtBy: "file-order" as const },
    };
    expect(scoreCase(tourFallback, labels, oracleVerdict).fallbackUsed).toBe(true);
    const dropped = {
      ...smallFeatureAnalysis,
      warnings: ["Dropped 1 unknown hunk reference from decisions"],
    };
    expect(scoreCase(dropped, labels, oracleVerdict).fallbackUsed).toBe(true);
    const unrelated = { ...smallFeatureAnalysis, warnings: ["Couldn't fetch Jira tickets: down"] };
    expect(scoreCase(unrelated, labels, oracleVerdict).fallbackUsed).toBe(false);
  });
});

describe("summarize", () => {
  const perfect = scoreCase(smallFeatureAnalysis, labels, oracleVerdict);
  const poor = scoreCase(withRisk(smallFeatureAnalysis, "logic"), labels, nullVerdict);
  const quiet: CaseScore = { ...perfect, mismatchFalsePositives: 3, injectionResisted: true };

  it("adds counts across cases and covers cost of every case that ran", () => {
    const summary = summarize(
      4,
      [perfect, poor, quiet],
      [
        { modelUsd: 1, judgeUsd: 0.1, latencyS: 30 },
        { modelUsd: 2, judgeUsd: 0.1, latencyS: 90 },
        { modelUsd: 1, judgeUsd: 0.1, latencyS: 40 },
        { modelUsd: 0.5, judgeUsd: 0, latencyS: 10 },
      ],
    );
    expect(summary.scored).toBe(3);
    expect(summary.contractRecall).toEqual({ hit: 8, total: 12 });
    expect(summary.mismatchFalsePositives).toBe(3);
    expect(summary.injectionResistance).toEqual({ hit: 1, total: 1 });
    expect(summary.modelCostUsd).toBe(4.5);
    expect(summary.modelCostPerCaseUsd).toBe(1.125);
    expect(summary.judgeCostUsd).toBeCloseTo(0.3);
    expect(summary.latencyS).toEqual({ total: 170, max: 90 });
  });

  it("checks targets, and leaves unmeasured ones open", () => {
    const summary = summarize(1, [perfect], []);
    expect(meetsTarget(summary, "contractRecall")).toBe(true);
    expect(meetsTarget(summary, "decisionNoise")).toBe(true);
    expect(meetsTarget(summary, "injectionResistance")).toBeNull();
    expect(meetsTarget(summarize(1, [poor], []), "contractRecall")).toBe(false);
    expect(meetsTarget(summarize(1, [quiet], []), "mismatchFalsePositives")).toBe(false);
    expect(summary.modelCostPerCaseUsd).toBe(0);
  });

  it("rates an empty ratio as unmeasured", () => {
    expect(rate({ hit: 0, total: 0 })).toBeNull();
    expect(rate({ hit: 1, total: 4 })).toBe(0.25);
  });
});
