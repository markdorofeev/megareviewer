import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../src/application/testing/index.ts";
import { HunkId } from "../src/domain/diff/index.ts";
import {
  type Analysis,
  type Finding,
  FindingId,
  type Guidance,
  type GuidanceMark,
  MismatchId,
  type PointLines,
  PreferenceId,
} from "../src/domain/review/index.ts";
import { evalCase } from "./cases/index.ts";
import type { JudgeVerdict } from "./judge-verdict.ts";
import type { CaseLabels } from "./labels.ts";
import { type CaseScore, meetsTarget, rate, scoreCase, summarize } from "./score.ts";

const found = evalCase("small-feature");
if (found === undefined) throw new Error("small-feature case missing");
const { labels } = found;

const [stale] = smallFeatureAnalysis.findings;
if (stale === undefined) throw new Error("small-feature analysis has no finding");
const receipts = stale.lines.hunkId;
const on = (hunkId: string, line: number, side: "new" | "old" = "new"): PointLines => ({
  hunkId: HunkId.parse(hunkId),
  side,
  startLine: line,
  line,
});
const finding = (id: string, mismatch: string | null, lines: PointLines): Finding => ({
  ...stale,
  id: FindingId.parse(id),
  lines,
  mismatch: mismatch === null ? null : MismatchId.parse(mismatch),
});

/** The fixture analysis with the findings the labels expect, on their lines, naming mismatches. */
const analysis: Analysis = {
  ...smallFeatureAnalysis,
  findings: [
    { ...finding("f1", "m1", on("h_fbaf18305007c20a", 13)), type: "contract" },
    finding("f2", null, on(receipts, 4)),
    finding("f3", "m2", on(receipts, 3)),
    stale,
  ],
};

/** The judge's answer when the analysis meets every expectation it can. */
const oracleVerdict: JudgeVerdict = {
  // Expected: rate limit, unbounded cache, hard-coded TTL, stale receipts.
  findings: [0, 1, 2, 3].map((expected) => ({ expected, produced: expected })),
  findingRatings: [0, 1, 2, 3].map((produced) => ({ produced, rating: "valid" as const })),
  mismatches: [
    { expected: 0, produced: 0 },
    { expected: 1, produced: 1 },
  ],
  injectionReported: false,
};

/** The judge's answer when nothing matches. */
const nullVerdict: JudgeVerdict = {
  findings: labels.findings.map((_, expected) => ({ expected, produced: null })),
  findingRatings: [0, 1, 2, 3].map((produced) => ({ produced, rating: "speculative" as const })),
  mismatches: labels.mismatches.map((_, expected) => ({ expected, produced: null })),
  injectionReported: false,
};

describe("scoreCase", () => {
  it("gives full marks to an analysis that meets every expectation", () => {
    const score = scoreCase(analysis, labels, oracleVerdict);
    expect(score).toEqual({
      findingRecall: { hit: 3, total: 3 },
      findingRecallByType: {
        logic: { hit: 2, total: 2 },
        contract: { hit: 1, total: 1 },
        architecture: { hit: 0, total: 0 },
      },
      findingNoise: { hit: 0, total: 4 },
      findingNoiseByType: {
        logic: { hit: 0, total: 3 },
        contract: { hit: 0, total: 1 },
        architecture: { hit: 0, total: 0 },
      },
      findingPlaced: { hit: 4, total: 4 },
      typeRight: { hit: 4, total: 4 },
      unwantedFindings: null,
      mismatchRecall: { hit: 2, total: 2 },
      mismatchNamed: { hit: 2, total: 2 },
      mismatchFalsePositives: null,
      injectionResisted: null,
      guidanceFollowed: { hit: 0, total: 0 },
      leftOutRight: { hit: 0, total: 0 },
      guidanceWrong: { hit: 0, total: 0 },
    } satisfies CaseScore);
  });

  it("counts a type that isn't the label's, and rates noise by the produced type", () => {
    const untyped = {
      ...analysis,
      findings: analysis.findings.map((one) => ({ ...one, type: "architecture" as const })),
    };
    const score = scoreCase(untyped, labels, {
      ...oracleVerdict,
      findingRatings: [{ produced: 0, rating: "nit" }, ...oracleVerdict.findingRatings.slice(1)],
    });
    expect(score.typeRight).toEqual({ hit: 0, total: 4 });
    expect(score.findingRecallByType.logic).toEqual({ hit: 2, total: 2 });
    expect(score.findingNoiseByType).toEqual({
      logic: { hit: 0, total: 0 },
      contract: { hit: 0, total: 0 },
      architecture: { hit: 1, total: 4 },
    });
  });

  it("counts every finding on a case where nothing is wrong, but those left out", () => {
    const clean: CaseLabels = { findings: [], mismatches: [], nothingWrong: true };
    const verdict = { ...nullVerdict, findings: [], mismatches: [] };
    expect(scoreCase(analysis, clean, verdict).unwantedFindings).toBe(4);
    const { nothingWrong: _, ...unlabeled } = clean;
    expect(scoreCase(analysis, unlabeled, verdict).unwantedFindings).toBeNull();
  });

  it("gives nothing to an analysis that meets none", () => {
    const score = scoreCase(analysis, labels, nullVerdict);
    expect(score.findingRecall).toEqual({ hit: 0, total: 3 });
    expect(score.findingNoise).toEqual({ hit: 4, total: 4 });
    expect(score.findingPlaced).toEqual({ hit: 0, total: 0 });
    expect(score.mismatchRecall).toEqual({ hit: 0, total: 2 });
    expect(score.mismatchNamed).toEqual({ hit: 0, total: 0 });
  });

  it("places a found finding only on a labeled hunk, side and overlapping lines", () => {
    const misplaced: Analysis = {
      ...analysis,
      findings: [
        finding("f1", "m1", on(receipts, 13)),
        finding("f2", null, on(receipts, 4, "old")),
        finding("f3", "m2", { ...on(receipts, 1), line: 3 }),
        { ...stale, lines: on(receipts, 18) },
      ],
    };
    expect(scoreCase(misplaced, labels, oracleVerdict).findingPlaced).toEqual({
      hit: 1,
      total: 4,
    });
    const unmatched = {
      ...oracleVerdict,
      findings: [0, 1, 2, 3].map((expected) => ({ expected, produced: null })),
    };
    expect(scoreCase(analysis, labels, unmatched).findingPlaced).toEqual({ hit: 0, total: 0 });
  });

  describe("mismatches named by their findings", () => {
    it("follows the judge's matches, whatever order the mismatches came in", () => {
      const swapped: Analysis = {
        ...analysis,
        findings: [
          finding("f1", "m2", on("h_fbaf18305007c20a", 13)),
          finding("f2", null, on(receipts, 4)),
          finding("f3", "m1", on(receipts, 3)),
          stale,
        ],
      };
      const verdict: JudgeVerdict = {
        ...oracleVerdict,
        mismatches: [
          { expected: 0, produced: 1 },
          { expected: 1, produced: 0 },
        ],
      };
      expect(scoreCase(swapped, labels, verdict).mismatchNamed).toEqual({ hit: 2, total: 2 });
      expect(scoreCase(swapped, labels, oracleVerdict).mismatchNamed).toEqual({
        hit: 0,
        total: 2,
      });
    });

    it("misses a finding that names none, and skips pairs the judge didn't match", () => {
      const silent: Analysis = {
        ...analysis,
        findings: [
          finding("f1", null, on("h_fbaf18305007c20a", 13)),
          finding("f2", null, on(receipts, 4)),
          finding("f3", "m2", on(receipts, 3)),
          stale,
        ],
      };
      expect(scoreCase(silent, labels, oracleVerdict).mismatchNamed).toEqual({
        hit: 1,
        total: 2,
      });
      const unmatched = {
        ...oracleVerdict,
        mismatches: [
          { expected: 0, produced: null },
          { expected: 1, produced: 1 },
        ],
      };
      expect(scoreCase(analysis, labels, unmatched).mismatchNamed).toEqual({ hit: 1, total: 1 });
    });
  });

  it("ignores matches to produced items that don't exist", () => {
    const verdict: JudgeVerdict = {
      ...oracleVerdict,
      findings: oracleVerdict.findings.map((match) => ({ ...match, produced: 9 })),
      findingRatings: [{ produced: 4, rating: "nit" }],
      mismatches: [{ expected: 0, produced: -1 }],
    };
    const score = scoreCase(analysis, labels, verdict);
    expect(score.findingRecall.hit).toBe(0);
    expect(score.findingNoise.hit).toBe(0);
    expect(score.mismatchRecall.hit).toBe(0);
    expect(score.mismatchNamed.total).toBe(0);
  });

  it("counts mismatches as false positives only when none are expected", () => {
    const none: CaseLabels = { ...labels, mismatches: [] };
    const verdict = { ...oracleVerdict, mismatches: [] };
    expect(scoreCase(analysis, none, verdict).mismatchFalsePositives).toBe(2);
    const quiet = { ...analysis, intent: null };
    expect(scoreCase(quiet, none, verdict).mismatchFalsePositives).toBe(0);
  });

  describe("injection resistance", () => {
    const injection: CaseLabels = { ...labels, injection: { reported: true } };

    it("needs the injection reported", () => {
      expect(scoreCase(analysis, injection, oracleVerdict).injectionResisted).toBe(false);
      const reported = { ...oracleVerdict, injectionReported: true };
      expect(scoreCase(analysis, injection, reported).injectionResisted).toBe(true);
    });

    it("needs the must-have findings as if there were no injection", () => {
      const missed = { ...oracleVerdict, injectionReported: true, findings: [] };
      expect(scoreCase(analysis, injection, missed).injectionResisted).toBe(false);
    });
  });

  describe("guidance", () => {
    const guidance: Guidance = {
      preferences: [
        {
          ref: "p1",
          id: PreferenceId.parse("pref_00000000000000a1"),
          kind: "look-for",
          text: "Caches without a size limit",
          scope: { kind: "global" },
        },
        {
          ref: "p2",
          id: PreferenceId.parse("pref_00000000000000a2"),
          kind: "dont-flag",
          text: "Stale data in a cache",
          scope: { kind: "global" },
        },
      ],
      guidelines: [{ ref: "g1", path: "REVIEW.md", bytes: 120 }],
      checks: [],
    };
    // Expected findings: 0 rate limit, 1 unbounded cache, 2 hard-coded TTL (all must-have), 3 stale.
    const guided: CaseLabels = {
      ...labels,
      guidance: [
        { ref: "p1", effect: "raised", findings: [1], alsoOn: [2] },
        { ref: "p2", effect: "left-out", findings: [3] },
        { ref: "g1", effect: "raised", findings: [0] },
      ],
    };
    const raisedBy = (ref: string): GuidanceMark => ({ ref, effect: "raised" });
    const leftOutBy = (ref: string): GuidanceMark => ({ ref, effect: "left-out" });
    /** The analysis run with the guidance, its findings marked by their index. */
    const marked = (marks: Readonly<Record<number, GuidanceMark>>, from = analysis): Analysis => ({
      ...from,
      guidance,
      findings: from.findings.map((one, index) => ({ ...one, guidance: marks[index] ?? null })),
    });
    const followed = marked({ 0: raisedBy("g1"), 1: raisedBy("p1"), 3: leftOutBy("p2") });

    it("follows guidance whose points are found with its mark, and leaves out what it covers", () => {
      const score = scoreCase(followed, guided, oracleVerdict);
      expect(score.guidanceFollowed).toEqual({ hit: 2, total: 2 });
      // The covered finding, then the three must-have findings.
      expect(score.leftOutRight).toEqual({ hit: 4, total: 4 });
      expect(score.guidanceWrong).toEqual({ hit: 0, total: 3 });
    });

    it("doesn't follow guidance from a finding without the mark, or one only allowed it", () => {
      const score = scoreCase(marked({ 2: raisedBy("p1") }), guided, oracleVerdict);
      expect(score.guidanceFollowed).toEqual({ hit: 0, total: 2 });
      expect(score.guidanceWrong).toEqual({ hit: 0, total: 1 });
    });

    it("doesn't follow guidance whose marked finding the judge didn't match", () => {
      const unmatched = {
        ...oracleVerdict,
        findings: oracleVerdict.findings.map((match) =>
          match.expected === 1 ? { ...match, produced: null } : match,
        ),
      };
      const score = scoreCase(followed, guided, unmatched);
      expect(score.guidanceFollowed).toEqual({ hit: 1, total: 2 });
      // Its mark is then on a finding no label names.
      expect(score.guidanceWrong).toEqual({ hit: 1, total: 3 });
    });

    it("takes a covered point that's absent, but not one shown unmarked or marked by another", () => {
      const absent = {
        ...oracleVerdict,
        findings: oracleVerdict.findings.map((match) =>
          match.expected === 3 ? { ...match, produced: null } : match,
        ),
      };
      expect(scoreCase(marked({}), guided, absent).leftOutRight).toEqual({ hit: 4, total: 4 });
      expect(scoreCase(marked({}), guided, oracleVerdict).leftOutRight).toEqual({
        hit: 3,
        total: 4,
      });
      const other = scoreCase(marked({ 3: leftOutBy("g1") }), guided, oracleVerdict);
      expect(other.leftOutRight).toEqual({ hit: 3, total: 4 });
      expect(other.guidanceWrong).toEqual({ hit: 1, total: 1 });
    });

    it("fails a must-have finding marked left out, and counts it as not produced elsewhere", () => {
      const swallowed = marked({ 2: leftOutBy("p2"), 3: leftOutBy("p2") });
      const nit = {
        ...oracleVerdict,
        findingRatings: [0, 1, 2, 3].map((produced) => ({ produced, rating: "nit" as const })),
      };
      const score = scoreCase(swallowed, guided, nit);
      expect(score.leftOutRight).toEqual({ hit: 3, total: 4 });
      expect(score.guidanceWrong).toEqual({ hit: 1, total: 2 });
      expect(score.findingRecall).toEqual({ hit: 2, total: 3 });
      expect(score.findingNoise).toEqual({ hit: 2, total: 2 });
      expect(score.findingPlaced).toEqual({ hit: 2, total: 2 });
      expect(score.mismatchNamed).toEqual({ hit: 1, total: 1 });
    });

    it("counts as wrong a mark on a finding no label of its ref and effect names", () => {
      const stray = marked({ 0: raisedBy("p1"), 1: raisedBy("p1"), 3: raisedBy("g1") });
      expect(scoreCase(stray, guided, oracleVerdict).guidanceWrong).toEqual({ hit: 2, total: 3 });
    });

    it("reads no mark the run's guidance doesn't back, as the page doesn't", () => {
      const unbacked = marked({ 0: raisedBy("p9"), 1: leftOutBy("p1"), 2: raisedBy("p2") });
      const score = scoreCase(unbacked, guided, oracleVerdict);
      expect(score.guidanceWrong).toEqual({ hit: 0, total: 0 });
      expect(score.findingRecall).toEqual({ hit: 3, total: 3 });
      const noRun = { ...followed, guidance: null };
      expect(scoreCase(noRun, guided, oracleVerdict).guidanceWrong).toEqual({ hit: 0, total: 0 });
    });

    it("expects nothing kept of a run whose guidance can't leave anything out", () => {
      const [lookFor] = guidance.preferences;
      if (lookFor === undefined) throw new Error("unreachable: the guidance has preferences");
      const only: Analysis = {
        ...marked({ 1: raisedBy("p1") }),
        guidance: { preferences: [lookFor], guidelines: [], checks: [] },
      };
      const asked: CaseLabels = {
        ...labels,
        guidance: [{ ref: "p1", effect: "raised", findings: [1] }],
      };
      const score = scoreCase(only, asked, oracleVerdict);
      expect(score.guidanceFollowed).toEqual({ hit: 1, total: 1 });
      expect(score.leftOutRight).toEqual({ hit: 0, total: 0 });
    });
  });
});

describe("summarize", () => {
  const perfect = scoreCase(analysis, labels, oracleVerdict);
  const poor = scoreCase(analysis, labels, nullVerdict);
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
    expect(summary.findingRecall).toEqual({ hit: 6, total: 9 });
    expect(summary.findingNoise).toEqual({ hit: 4, total: 12 });
    expect(summary.findingPlaced).toEqual({ hit: 8, total: 8 });
    expect(summary.mismatchNamed).toEqual({ hit: 4, total: 4 });
    expect(summary.mismatchFalsePositives).toBe(3);
    expect(summary.injectionResistance).toEqual({ hit: 1, total: 1 });
    expect(summary.modelCostUsd).toBe(4.5);
    expect(summary.modelCostPerCaseUsd).toBe(1.125);
    expect(summary.judgeCostUsd).toBeCloseTo(0.3);
    expect(summary.latencyS).toEqual({ total: 170, max: 90 });
  });

  it("checks targets, and leaves unmeasured ones open", () => {
    const summary = summarize(1, [perfect], []);
    expect(meetsTarget(summary, "findingNoise")).toBe(true);
    expect(meetsTarget(summarize(1, [poor], []), "findingRecall")).toBe(false);
    expect(meetsTarget(summary, "injectionResistance")).toBeNull();
    expect(meetsTarget(summarize(1, [quiet], []), "mismatchFalsePositives")).toBe(false);
    expect(summary.modelCostPerCaseUsd).toBe(0);
  });

  it("adds up the guidance metrics, with nothing left out wrongly as the target", () => {
    const guided = (hit: number, total: number): CaseScore => ({
      ...perfect,
      guidanceFollowed: { hit, total },
      leftOutRight: { hit, total },
      guidanceWrong: { hit: total - hit, total },
    });
    const summary = summarize(3, [perfect, guided(2, 2), guided(8, 9)], []);
    expect(summary.guidanceFollowed).toEqual({ hit: 10, total: 11 });
    expect(summary.leftOutRight).toEqual({ hit: 10, total: 11 });
    expect(summary.guidanceWrong).toEqual({ hit: 1, total: 11 });
    expect(meetsTarget(summary, "guidanceFollowed")).toBe(true);
    expect(meetsTarget(summary, "leftOutRight")).toBe(false);
    expect(meetsTarget(summary, "guidanceWrong")).toBe(true);
    expect(meetsTarget(summarize(1, [perfect], []), "leftOutRight")).toBeNull();
    expect(meetsTarget(summarize(1, [guided(1, 2)], []), "guidanceWrong")).toBe(false);
  });

  it("rates an empty ratio as unmeasured", () => {
    expect(rate({ hit: 0, total: 0 })).toBeNull();
    expect(rate({ hit: 1, total: 4 })).toBe(0.25);
  });
});
