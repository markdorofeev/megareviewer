import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../../application/testing/index.ts";
import { HunkId } from "../diff/index.ts";
import {
  Finding,
  FindingId,
  type Guidance,
  MismatchId,
  PreferenceId,
  pointsOf,
  type Severity,
  strippable,
  validateFindings,
} from "./index.ts";

const receipts = smallFeatureAnalysis.files.find(
  (file) => file.path === "src/services/receipts.ts",
);
const receiptsHunk = receipts?.hunks[0];
if (receiptsHunk === undefined) throw new Error("small-feature changes receipts.ts");

const finding = (lines: Partial<Finding["lines"]> = {}): Finding => ({
  id: FindingId.parse("f1"),
  title: "Serves a stale receipt",
  explanation: "Keyed by order ID alone.",
  lines: { hunkId: receiptsHunk.id, side: "new", startLine: 9, line: 11, ...lines },
  type: "logic",
  severity: "major",
  suggestion: null,
  mismatch: null,
  guidance: null,
});

describe("pointsOf", () => {
  it("orders findings by severity, the model's order within one, then mismatches", () => {
    const of = (id: string, severity: Severity): Finding => ({
      ...finding(),
      id: FindingId.parse(id),
      severity,
    });
    const points = pointsOf({
      ...smallFeatureAnalysis,
      findings: [
        of("f1", "minor"),
        of("f2", "major"),
        of("f3", "blocking"),
        of("f4", "major"),
        of("f5", "blocking"),
      ],
      intent: smallFeatureAnalysis.intent && {
        ...smallFeatureAnalysis.intent,
        mismatches: [{ kind: "unrequested", description: "Raises the rate limit.", hunkIds: [] }],
      },
    });
    expect(points.map((point) => point.id)).toEqual(["f3", "f5", "f2", "f4", "f1", "m1"]);
  });

  it("orders findings, then mismatches", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      intent: smallFeatureAnalysis.intent && {
        ...smallFeatureAnalysis.intent,
        mismatches: [{ kind: "unrequested", description: "Raises the rate limit.", hunkIds: [] }],
      },
    });
    expect(points.map((point) => point.id)).toEqual(["f1", "m1"]);
  });

  it("lands a finding on its own lines", () => {
    const [point] = pointsOf({ ...smallFeatureAnalysis, findings: [finding()] });
    expect(point).toMatchObject({
      path: "src/services/receipts.ts",
      lines: { hunkId: receiptsHunk.id, side: "new", startLine: 9, line: 11 },
      hunkIds: [receiptsHunk.id],
    });
  });

  describe("guidance", () => {
    const tenant = PreferenceId.parse("pref_00000000000000a1");
    const naming = PreferenceId.parse("pref_00000000000000a2");
    const guidance: Guidance = {
      preferences: [
        {
          ref: "p1",
          id: tenant,
          kind: "look-for",
          text: "Tenant isolation",
          scope: { kind: "global" },
        },
        { ref: "p2", id: naming, kind: "dont-flag", text: "Naming", scope: { kind: "global" } },
      ],
      guidelines: [{ ref: "g1", path: "REVIEW.md", linkedFrom: null, given: "prompt", bytes: 120 }],
      checks: [],
    };
    it("says which preference raised a finding or left it out, and which file one is from", () => {
      const points = pointsOf({
        ...smallFeatureAnalysis,
        intent: null,
        guidance,
        findings: [
          { ...finding(), guidance: { ref: "p1", effect: "raised" } },
          { ...finding(), id: FindingId.parse("f2"), guidance: { ref: "p2", effect: "left-out" } },
          { ...finding(), id: FindingId.parse("f3") },
          { ...finding(), id: FindingId.parse("f4"), guidance: { ref: "g1", effect: "raised" } },
        ],
      });

      expect(points.map((point) => [point.id, point.guidance])).toEqual([
        ["f1", { effect: "raised", label: "Tenant isolation", preferenceId: tenant }],
        ["f2", { effect: "left-out", label: "Naming", preferenceId: naming }],
        ["f3", undefined],
        ["f4", { effect: "raised", label: "REVIEW.md", preferenceId: null }],
      ]);
    });

    it("drops a mark that doesn't check out and keeps its point", () => {
      const points = pointsOf({
        ...smallFeatureAnalysis,
        intent: null,
        guidance,
        findings: [
          { ...finding(), guidance: { ref: "p9", effect: "raised" } },
          { ...finding(), id: FindingId.parse("f2"), guidance: { ref: "p1", effect: "left-out" } },
        ],
      });

      expect(points.map((point) => point.id)).toEqual(["f1", "f2"]);
      expect(points.every((point) => !("guidance" in point))).toBe(true);
    });

    it("keeps no mark on an analysis without the run's guidance", () => {
      const marked = { ...finding(), guidance: { ref: "p1", effect: "raised" as const } };
      for (const without of [{ guidance: null }, {}]) {
        const [point] = pointsOf({
          files: smallFeatureAnalysis.files,
          intent: null,
          findings: [marked],
          ...without,
        });
        expect(point?.id).toBe("f1");
        expect(point?.guidance).toBeUndefined();
      }
    });
  });

  it("makes a mismatch a finding, landed on its first hunk's changed lines, or nowhere", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      findings: [],
      intent: smallFeatureAnalysis.intent && {
        ...smallFeatureAnalysis.intent,
        mismatches: [
          { kind: "missing", description: "The lifetime isn't configurable.", hunkIds: [] },
          {
            kind: "contradicts",
            description: "Hard-codes the lifetime.",
            hunkIds: [HunkId.parse("h_ffffffffffffffff"), receiptsHunk.id],
          },
        ],
      },
    });
    expect(points).toEqual([
      {
        id: "m1",
        title: "The lifetime isn't configurable.",
        explanation: "Asked for, not done.",
        path: null,
        lines: null,
        hunkIds: [],
        type: null,
        severity: null,
        suggestion: null,
        mismatch: null,
      },
      {
        id: "m2",
        title: "Hard-codes the lifetime.",
        explanation: "Contradicts what was asked.",
        path: "src/services/receipts.ts",
        lines: { hunkId: receiptsHunk.id, side: "new", startLine: 1, line: 20 },
        hunkIds: [receiptsHunk.id],
        type: null,
        severity: null,
        suggestion: null,
        mismatch: null,
      },
    ]);
  });

  it("folds a mismatch a finding names into that finding, and keeps the others", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      findings: [{ ...finding(), mismatch: MismatchId.parse("m2") }],
      intent: smallFeatureAnalysis.intent && {
        ...smallFeatureAnalysis.intent,
        mismatches: [
          { kind: "missing", description: "The lifetime isn't configurable.", hunkIds: [] },
          { kind: "contradicts", description: "Hard-codes the lifetime.", hunkIds: [] },
        ],
      },
    });
    expect(points.map((point) => point.id)).toEqual(["f1", "m1"]);
    expect(points[0]?.mismatch).toEqual({
      kind: "contradicts",
      description: "Hard-codes the lifetime.",
    });
  });

  it("carries a finding's type, which a mismatch doesn't have", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      findings: [{ ...finding(), type: "contract" }],
      intent: smallFeatureAnalysis.intent && {
        ...smallFeatureAnalysis.intent,
        mismatches: [{ kind: "unrequested", description: "Raises the rate limit.", hunkIds: [] }],
      },
    });
    expect(points.map((point) => point.type)).toEqual(["contract", null]);
  });

  it("reads a finding stored before findings had a type as logic", () => {
    const { type: _, ...stored } = finding();
    expect(Finding.parse(stored)).toEqual(finding());
  });

  it("carries a finding's severity and suggestion, but no suggestion for old-side lines", () => {
    const suggested = { ...finding(), severity: "blocking" as const, suggestion: ["x();"] };
    const [onNew] = pointsOf({ ...smallFeatureAnalysis, findings: [suggested] });
    expect(onNew).toMatchObject({ severity: "blocking", suggestion: ["x();"], mismatch: null });
    const onOld = { ...suggested, lines: { ...suggested.lines, side: "old" as const } };
    expect(pointsOf({ ...smallFeatureAnalysis, findings: [onOld] })[0]?.suggestion).toBeNull();
  });

  it("carries a finding's guardrail, and nothing on one without", () => {
    const guardrail = {
      is: "rule",
      tool: "biome",
      rule: "noFloatingPromises",
      configPath: "biome.json",
    } as const;
    const [marked, plain] = pointsOf({
      ...smallFeatureAnalysis,
      findings: [
        { ...finding(), guardrail },
        { ...finding(), id: FindingId.parse("f2") },
      ],
    });
    expect(marked?.guardrail).toEqual(guardrail);
    expect(plain && "guardrail" in plain).toBe(false);
  });

  it("reads a finding stored with an earlier version's guardrail or repetition without it", () => {
    for (const stored of [
      { guardrail: { tool: "biome", rule: "noFloatingPromises", configPath: "biome.json" } },
      {
        guardrail: {
          is: "configured",
          tool: "biome",
          rule: "noFloatingPromises",
          configPath: "biome.json",
        },
      },
      { repeated: { says: "Promises nobody awaits", pullRequests: 3, guardrail: null } },
    ]) {
      const parsed = Finding.parse({ ...finding(), ...stored });
      expect(parsed.guardrail).toBeUndefined();
      expect("repeated" in parsed).toBe(false);
    }
  });
});

describe("validateFindings", () => {
  const hunks = new Map([[receiptsHunk.id, receiptsHunk]]);

  it("accepts a finding on lines its hunk shows", () => {
    expect(validateFindings([finding()], hunks)).toEqual([]);
  });

  it("names an unknown hunk, lines the hunk doesn't show, and a blank title, not long text", () => {
    const unknown = HunkId.parse("h_ffffffffffffffff");
    expect(
      validateFindings(
        [
          finding({ hunkId: unknown }),
          finding({ line: 99 }),
          finding({ side: "old" }),
          { ...finding(), title: " ", explanation: "x".repeat(301) },
          { ...finding(), title: "x".repeat(81) },
        ],
        hunks,
      ),
    ).toEqual([
      { kind: "unknown-hunk", index: 0, hunkId: unknown },
      { kind: "lines-outside", index: 1, hunkId: receiptsHunk.id },
      { kind: "lines-outside", index: 2, hunkId: receiptsHunk.id },
      { kind: "blank", index: 3, field: "title" },
    ]);
  });

  it("names a suggestion on old-side lines and a mismatch the intent doesn't have", () => {
    const onOld = {
      ...finding(),
      lines: { hunkId: receiptsHunk.id, side: "old" as const, startLine: 9, line: 9 },
      suggestion: ["x();"],
    };
    const problems = validateFindings(
      [onOld, { ...finding(), mismatch: MismatchId.parse("m2") }],
      hunks,
      1,
    );
    expect(problems).toContainEqual({ kind: "suggestion-old-side", index: 0 });
    expect(problems).toContainEqual({ kind: "unknown-mismatch", index: 1, mismatch: "m2" });
    expect(problems.filter((problem) => problem.index === 1).every(strippable)).toBe(true);
  });
});
