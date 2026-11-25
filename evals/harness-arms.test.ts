import { describe, expect, it } from "vitest";
import { ArmFile, compareArms, showArms } from "./harness-arms.ts";
import type { Reader } from "./reader.ts";
import type { CaseScore } from "./score.ts";

const none = { hit: 0, total: 0 };
const caseScore = (findingRecall = none): CaseScore => ({
  contractRecall: none,
  riskAccuracy: none,
  riskNoise: none,
  riskPlaced: none,
  coverageWrong: none,
  coverageRecall: none,
  findingRecall,
  findingNoise: none,
  findingPlaced: none,
  decisionRecall: none,
  decisionNoise: none,
  mismatchRecall: none,
  mismatchNamed: none,
  mismatchFalsePositives: null,
  injectionResisted: null,
  guidanceFollowed: none,
  leftOutRight: none,
  guidanceWrong: none,
  firstTryValid: true,
  fallbackUsed: false,
});

const row = (name: string, run: number, reads: number, costUsd: number, more: object = {}) => ({
  name,
  run,
  status: "scored",
  error: null,
  cost: { modelUsd: costUsd, judgeUsd: 0.1, latencyS: 10 },
  score: caseScore(),
  harness: {
    harnessFollowed: { hit: reads > 0 ? 1 : 0, total: 1 },
    harnessWrong: none,
    harnessRead: { hit: reads > 0 ? 1 : 0, total: 1 },
    passes: [{ pass: "findings", calls: 1, reads, files: reads, refused: 0 }],
    outsideQuoted: null,
  },
  spend: { freshTokens: 9000, cacheReadTokens: 30000, outputTokens: 2000, costUsd, seconds: 12 },
  ...more,
});

const file = (reader: Reader, cases: readonly object[], more: object = {}): ArmFile =>
  ArmFile.parse({
    startedAt: "2026-11-25T10:00:00.000Z",
    modelVersion: "claude-code/claude-sonnet-5-5/p14",
    pipelineVersion: "20",
    reader,
    withHarness: false,
    runs: 1,
    cases,
    ...more,
  });

const files = [
  file("off", [row("linked-section", 1, 0, 0.1), row("linked-section", 2, 0, 0.1)]),
  file("on", [row("linked-section", 1, 2, 0.2), row("linked-section", 2, 1, 0.4)]),
  file("index-alone", [
    row("linked-section", 1, 0, 0.12),
    row("linked-section", 2, 0, 0, {
      status: "error",
      error: "timed out",
      score: null,
      harness: null,
    }),
  ]),
];

describe("compareArms", () => {
  it("has one arm a case, model and way of reading, its runs together, in the order of READERS", () => {
    const { arms, attached } = compareArms(files);
    expect(
      arms.map(({ name, reader, summary, errors }) => [name, reader, summary.runs, errors]),
    ).toEqual([
      ["linked-section", "on", 2, 0],
      ["linked-section", "off", 2, 0],
      ["linked-section", "index-alone", 1, 1],
    ]);
    expect(arms[0]?.summary.harnessFollowed).toEqual({ hit: 2, total: 2 });
    expect(arms[0]?.summary.spend.costUsd).toBeCloseTo(0.3);
    expect(attached).toBeNull();
  });

  it("puts runs of another file of the same arm with it, and another model's apart", () => {
    const { arms } = compareArms([
      ...files,
      file("on", [row("linked-section", 1, 3, 0.3)]),
      file("on", [row("linked-section", 1, 0, 0.02)], {
        modelVersion: "claude-code/claude-haiku-5-5/p14",
      }),
    ]);
    expect(arms.filter((arm) => arm.reader === "on").map((arm) => arm.summary.runs)).toEqual([
      1, 3,
    ]);
  });

  it("leaves out a case without a harness", () => {
    const plain = row("small-feature", 1, 0, 0.1, { harness: null });
    expect(compareArms([file("on", [plain])]).arms).toEqual([]);
  });

  it("names the targets the large harness made a case miss, over the cases run both ways", () => {
    const scored = (name: string, hit: number, harness: object | null = null) =>
      row(name, 1, 0, 0.1, { score: caseScore({ hit, total: 10 }), harness });
    const without = file("on", [scored("small-feature", 10), scored("only-without", 0)]);
    const withIt = file("on", [scored("small-feature", 5)], { withHarness: true });
    const { attached } = compareArms([without, withIt]);
    expect(attached).toMatchObject({ cases: ["small-feature"], missed: ["findingRecall"] });
    expect(attached?.without.findingRecall).toEqual({ hit: 10, total: 10 });
  });
});

describe("showArms", () => {
  it("says what each way of reading gave, beside what the same case spends without the reader", () => {
    const text = showArms(compareArms(files));
    expect(text).toContain(
      "linked-section · reader on · claude-code/claude-sonnet-5-5/p14 · 2 runs",
    );
    expect(text).toContain("followed 2/2 · wrong – · read as labeled 2/2");
    expect(text).toContain("reads a run: findings 1.5 (2/2 runs)");
    expect(text).toContain("$0.300, 12 s (without the reader: 9.0k + 30.0k in, $0.100, 12 s)");
    expect(text).toContain(
      "reader index-alone · claude-code/claude-sonnet-5-5/p14 · 1 runs · 1 not scored",
    );
  });

  it("says refusals, quotes from outside and an unknown cost only where there are any", () => {
    const refused = row("asks-for-file", 1, 0, 0, {
      harness: {
        harnessFollowed: none,
        harnessWrong: none,
        harnessRead: none,
        passes: [{ pass: "intent", calls: 2, reads: 0, files: 0, refused: 1 }],
        outsideQuoted: false,
      },
      spend: { freshTokens: 1, cacheReadTokens: 1, outputTokens: 1, costUsd: null, seconds: 1 },
    });
    const text = showArms(compareArms([file("on", [refused])]));
    expect(text).toContain("quoted from outside 0/1");
    expect(text).toContain("intent 0.0 (0/1 runs, 1.0 refused)");
    expect(text).toContain("cost unknown");
  });

  it("says whether the large harness cost a target", () => {
    const scored = (hit: number) =>
      row("small-feature", 1, 0, 0.1, { score: caseScore({ hit, total: 10 }), harness: null });
    const shown = (hit: number) =>
      showArms(
        compareArms([file("on", [scored(10)]), file("on", [scored(hit)], { withHarness: true })]),
      );
    expect(shown(10)).toContain("no metric that met its target without it misses it");
    expect(shown(1)).toContain("misses a target it met without: findingRecall.");
  });
});
