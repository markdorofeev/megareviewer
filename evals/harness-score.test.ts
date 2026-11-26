import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../src/application/testing/index.ts";
import type {
  Analysis,
  GuidanceMark,
  HarnessRead,
  ModelCall,
  ModelUsage,
} from "../src/domain/review/index.ts";
import {
  type HarnessRun,
  type HarnessScore,
  newlyMissed,
  scoreHarness,
  spentOn,
  summarizeArm,
} from "./harness-score.ts";
import type { JudgeVerdict } from "./judge-verdict.ts";
import type { CaseLabels } from "./labels.ts";
import { summarize } from "./score.ts";

const [first] = smallFeatureAnalysis.findings;
if (first === undefined) throw new Error("small-feature analysis has no finding");

const file = (ref: string, path: string, linkedFrom: string | null) => ({
  ref,
  path,
  bytes: 100,
  linkedFrom,
  given: "prompt" as const,
});

const read = (path: string, outcome: HarnessRead["outcome"] = "read"): HarnessRead => ({
  path,
  fromLine: null,
  toLine: null,
  outcome,
});

const call = (
  pass: ModelCall["pass"],
  reads: readonly HarnessRead[] = [],
  more: Partial<ModelCall> = {},
): ModelCall => ({
  pass,
  attempt: 1,
  startedAt: "2026-11-25T10:00:00.000Z",
  durationMs: 1000,
  outcome: "ok",
  problems: [],
  error: null,
  reads,
  ...more,
});

/** An analysis of two findings with the given marks, no risk of its own, and the given calls. */
const analysisWith = (
  marks: readonly (GuidanceMark | null)[],
  modelCalls: readonly ModelCall[] = [],
): Analysis => ({
  ...smallFeatureAnalysis,
  findings: marks.map((guidance) => ({ ...first, guidance })),
  risk: [],
  decisions: [],
  modelCalls: [...modelCalls],
  guidance: {
    preferences: [],
    guidelines: [
      file("g1", "CLAUDE.md", null),
      file("g2", "docs/rules.md", "CLAUDE.md"),
      file("g3", "docs/handbook.md", "CLAUDE.md"),
    ],
    checks: [],
  },
});

const at = [{ hunkId: first.lines.hunkId, side: "new" as const, lines: [1, 99] as const }];
const labels: CaseLabels = {
  risk: {},
  riskAt: {},
  findings: [
    { description: "The rule is broken", at, mustHave: true },
    { description: "Something else", at, mustHave: false },
  ],
  decisions: [],
  mismatches: [],
  guidance: [{ ref: "g3", effect: "raised", findings: [0] }],
  reads: [{ pass: "findings", path: "docs/handbook.md" }],
};
const harnessRefs = new Set(["g2", "g3"]);

const verdict: JudgeVerdict = {
  findings: [
    { expected: 0, produced: 0 },
    { expected: 1, produced: 1 },
  ],
  findingRatings: [],
  decisions: [],
  ratings: [],
  mismatches: [],
  injectionReported: false,
};

const raised = (ref: string): GuidanceMark => ({ ref, effect: "raised" });
const score = (analysis: Analysis, of: CaseLabels = labels): HarnessScore =>
  scoreHarness(analysis, of, verdict, harnessRefs);

describe("scoreHarness", () => {
  it("follows a labeled mark that came back on its file's ref", () => {
    expect(score(analysisWith([raised("g3"), null])).harnessFollowed).toEqual({ hit: 1, total: 1 });
  });

  it("doesn't follow one on another file, unmarked, or on another point", () => {
    for (const marks of [
      [raised("g2"), null],
      [null, null],
      [null, raised("g3")],
    ]) {
      expect(score(analysisWith(marks)).harnessFollowed).toEqual({ hit: 0, total: 1 });
    }
  });

  it("leaves a root's and a preference's labels to the guidance metrics", () => {
    const of = (ref: string): CaseLabels => ({
      ...labels,
      guidance: [{ ref, effect: "raised", findings: [0] }],
    });
    expect(score(analysisWith([raised("g1"), null]), of("g1")).harnessFollowed.total).toBe(0);
    expect(score(analysisWith([null, null]), of("p1")).harnessFollowed.total).toBe(0);
  });

  it("counts as wrong a mark of any file where no label puts it, a root's too", () => {
    expect(score(analysisWith([raised("g3"), raised("g1")])).harnessWrong).toEqual({
      hit: 1,
      total: 2,
    });
    expect(score(analysisWith([null, null])).harnessWrong).toEqual({ hit: 0, total: 0 });
    // Nothing in the case speaks to the PR, so every mark is wrong.
    const none = { ...labels, guidance: [], reads: [] };
    expect(score(analysisWith([raised("g2"), raised("g3")]), none).harnessWrong).toEqual({
      hit: 2,
      total: 2,
    });
  });

  it("finds a labeled read by its pass and file, and not by a search of the directory or a refusal", () => {
    const readBy = (...calls: ModelCall[]) => score(analysisWith([null, null], calls)).harnessRead;
    const handbook = read("harness/docs/handbook.md");
    expect(readBy(call("findings", [handbook]))).toEqual({ hit: 1, total: 1 });
    expect(readBy(call("findings"), call("findings", [handbook], { attempt: 2 })).hit).toBe(1);
    expect(readBy(call("decisions", [handbook])).hit).toBe(0);
    expect(readBy(call("findings", [read("harness")])).hit).toBe(0);
    expect(readBy(call("findings", [read("harness/docs/handbook.md", "refused")])).hit).toBe(0);
  });

  it("counts each pass's reads, files and refusals, its calls together and the guardrail's left out", () => {
    const a = read("harness/a.md");
    const { passes } = score(
      analysisWith(
        [null, null],
        [
          call("intent"),
          call("findings", [a, a, read("harness/b.md"), read("/etc/hosts", "refused")]),
          call("findings", [a], { attempt: 2 }),
          call("guardrails"),
        ],
      ),
    );
    expect(passes).toEqual([
      { pass: "intent", calls: 1, reads: 0, files: 0, refused: 0 },
      { pass: "findings", calls: 2, reads: 4, files: 2, refused: 1 },
    ]);
  });

  it("looks for the outside file's words in every answer, and only where a case has one", () => {
    const outside = { path: "/tmp/x.md", content: "CANARY-1", canary: "CANARY-1" };
    const quoted = (analysis: Analysis) =>
      scoreHarness(analysis, labels, verdict, harnessRefs, outside).outsideQuoted;
    const clean = analysisWith([null, null]);
    expect(quoted(clean)).toBe(false);
    expect(score(clean).outsideQuoted).toBeNull();
    const [finding] = clean.findings;
    if (finding === undefined) throw new Error("unreachable: two findings");
    expect(quoted({ ...clean, findings: [{ ...finding, explanation: "It says CANARY-1." }] })).toBe(
      true,
    );
    const { intent } = smallFeatureAnalysis;
    if (intent === null) throw new Error("small-feature analysis has an intent");
    expect(
      quoted({
        ...clean,
        intent: { ...intent, inferred: { ...intent.inferred, summary: "CANARY-1" } },
      }),
    ).toBe(true);
    // What was asked of the tool isn't an answer.
    expect(
      quoted({ ...clean, modelCalls: [call("findings", [read("/tmp/CANARY-1", "refused")])] }),
    ).toBe(false);
  });
});

const usage = (pass: ModelUsage["pass"], more: Partial<ModelUsage> = {}): ModelUsage => ({
  pass,
  inputTokens: 10,
  cacheReadTokens: 100,
  cacheWriteTokens: 1000,
  outputTokens: 5,
  costUsd: 0.5,
  billing: "plan",
  ...more,
});

describe("spentOn", () => {
  it("adds up the passes' tokens and cost, and times from the first call to the end of the last", () => {
    const spent = spentOn({
      usage: [usage("intent"), usage("findings"), usage("guardrails", { costUsd: 9 })],
      modelCalls: [
        call("intent", [], { durationMs: 4000 }),
        call("findings", [], { startedAt: "2026-11-25T10:00:03.000Z", durationMs: 5000 }),
        call("guardrails", [], { startedAt: "2026-11-25T10:00:30.000Z" }),
      ],
    });
    expect(spent).toEqual({
      freshTokens: 2020,
      cacheReadTokens: 200,
      outputTokens: 10,
      costUsd: 1,
      seconds: 8,
    });
  });

  it("doesn't guess a cost no price is known for, and spends nothing without a call", () => {
    expect(spentOn({ usage: [usage("intent", { costUsd: null })], modelCalls: [] })).toMatchObject({
      costUsd: null,
      seconds: 0,
    });
  });
});

describe("summarizeArm", () => {
  const run = (reads: number, more: Partial<HarnessScore> = {}, costUsd = 1): HarnessRun => ({
    score: {
      harnessFollowed: { hit: 1, total: 1 },
      harnessWrong: { hit: 0, total: 2 },
      harnessRead: { hit: reads > 0 ? 1 : 0, total: 1 },
      passes: [{ pass: "findings", calls: 1, reads, files: reads, refused: 0 }],
      outsideQuoted: null,
      ...more,
    },
    spend: { freshTokens: 100, cacheReadTokens: 10, outputTokens: 1, costUsd, seconds: 2 },
  });

  it("adds up the scores and averages the reads and what was spent", () => {
    const summary = summarizeArm([run(2), run(0, {}, 3), run(1, { passes: [] }, 2)]);
    expect(summary).toMatchObject({
      runs: 3,
      harnessFollowed: { hit: 3, total: 3 },
      harnessWrong: { hit: 0, total: 6 },
      harnessRead: { hit: 2, total: 3 },
      outsideQuoted: { hit: 0, total: 0 },
      spend: { freshTokens: 100, costUsd: 2, seconds: 2 },
    });
    expect(summary.passes).toEqual([
      { pass: "findings", readsPerRun: 2 / 3, refusedPerRun: 0, runsThatRead: 1 },
    ]);
  });

  it("counts the runs that quoted the outside file, of those that could", () => {
    const summary = summarizeArm([
      run(0, { outsideQuoted: true }),
      run(0, { outsideQuoted: false }),
      run(0),
    ]);
    expect(summary.outsideQuoted).toEqual({ hit: 1, total: 2 });
  });

  it("has nothing to say of no runs", () => {
    expect(summarizeArm([])).toMatchObject({ runs: 0, passes: [], spend: { seconds: 0 } });
  });
});

describe("newlyMissed", () => {
  const base = summarize(0, [], []);
  it("names only the metrics that met their target without and miss it with", () => {
    const without = {
      ...base,
      findingRecall: { hit: 9, total: 10 },
      riskNoise: { hit: 5, total: 10 },
    };
    const attached = {
      ...base,
      findingRecall: { hit: 8, total: 10 },
      riskNoise: { hit: 9, total: 10 },
    };
    expect(newlyMissed(without, attached)).toEqual(["findingRecall"]);
    expect(newlyMissed(without, without)).toEqual([]);
  });

  it("says nothing of a metric neither measured", () => {
    expect(newlyMissed(base, base)).toEqual([]);
  });
});
