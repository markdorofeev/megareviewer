import { describe, expect, it } from "vitest";
import { fileChange, hunk, smallFeatureAnalysis } from "../../application/testing/index.ts";
import { HunkId } from "../diff/index.ts";
import {
  type Finding,
  FindingId,
  MismatchId,
  pointsOf,
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
  severity: "major",
  suggestion: null,
  mismatch: null,
});

describe("pointsOf", () => {
  it("orders findings, then mismatches, then the model's risks, then decisions", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      intent: smallFeatureAnalysis.intent && {
        ...smallFeatureAnalysis.intent,
        mismatches: [{ kind: "unrequested", description: "Raises the rate limit.", hunkIds: [] }],
      },
    });
    expect(points.map((point) => [point.kind, point.id])).toEqual([
      ["finding", "f1"],
      ["finding", "m1"],
      ...[0, 1, 2, 4].map((at) => ["risk", `r:${smallFeatureAnalysis.risk[at]?.hunkId}`]),
      ["decision", "d1"],
      ["decision", "d2"],
      ["decision", "d3"],
      ["decision", "d4"],
    ]);
  });

  it("lands a finding on its own lines", () => {
    const [point] = pointsOf({ ...smallFeatureAnalysis, findings: [finding()] });
    expect(point).toMatchObject({
      path: "src/services/receipts.ts",
      lines: { hunkId: receiptsHunk.id, side: "new", startLine: 9, line: 11 },
      hunkIds: [receiptsHunk.id],
    });
  });

  it("makes a mismatch a finding, landed on its first hunk's changed lines, or nowhere", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      findings: [],
      risk: [],
      decisions: [],
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
        kind: "finding",
        title: "The lifetime isn't configurable.",
        explanation: "Asked for, not done.",
        path: null,
        lines: null,
        hunkIds: [],
        severity: null,
        suggestion: null,
        mismatch: null,
      },
      {
        id: "m2",
        kind: "finding",
        title: "Hard-codes the lifetime.",
        explanation: "Contradicts what was asked.",
        path: "src/services/receipts.ts",
        lines: { hunkId: receiptsHunk.id, side: "new", startLine: 1, line: 20 },
        hunkIds: [receiptsHunk.id],
        severity: null,
        suggestion: null,
        mismatch: null,
      },
    ]);
  });

  it("folds a mismatch a finding names into that finding, and keeps the others", () => {
    const points = pointsOf({
      ...smallFeatureAnalysis,
      risk: [],
      decisions: [],
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

  it("carries a finding's severity and suggestion, but no suggestion for old-side lines", () => {
    const suggested = { ...finding(), severity: "blocking" as const, suggestion: ["x();"] };
    const [onNew] = pointsOf({ ...smallFeatureAnalysis, findings: [suggested] });
    expect(onNew).toMatchObject({ severity: "blocking", suggestion: ["x();"], mismatch: null });
    const onOld = { ...suggested, lines: { ...suggested.lines, side: "old" as const } };
    expect(pointsOf({ ...smallFeatureAnalysis, findings: [onOld] })[0]?.suggestion).toBeNull();
  });

  it("puts a decision on its own line when one of its hunks shows it, else its hunk's", () => {
    const [decision] = smallFeatureAnalysis.decisions;
    if (decision === undefined) throw new Error("small-feature has decisions");
    const onLine = {
      ...decision,
      hunkIds: [receiptsHunk.id],
      lines: { hunkId: receiptsHunk.id, side: "new" as const, startLine: 10, line: 10 },
    };
    const outside = { ...onLine, lines: { ...onLine.lines, startLine: 99, line: 99 } };
    const decided = (one: typeof onLine) =>
      pointsOf({
        ...smallFeatureAnalysis,
        intent: null,
        findings: [],
        risk: [],
        decisions: [one],
      })[0]?.lines;
    expect(decided(onLine)).toEqual(onLine.lines);
    expect(decided(outside)).toEqual({
      hunkId: receiptsHunk.id,
      side: "new",
      startLine: 1,
      line: 20,
    });
  });

  it("makes the model's contract a risk on a path the rules mark too, and leaves out its logic", () => {
    const auth = fileChange(
      { path: "src/auth/session.ts", status: "modified", language: "typescript" },
      [hunk("src/auth/session.ts", "@@ -1,1 +1,1 @@", ["-const ttl = 1;", "+const ttl = 2;"])],
    );
    const authHunk = auth.hunks[0];
    if (authHunk === undefined) throw new Error("built with a hunk");
    const points = pointsOf({
      files: [auth, ...smallFeatureAnalysis.files],
      intent: null,
      findings: [],
      decisions: [],
      risk: [
        {
          hunkId: authHunk.id,
          riskClass: "contract",
          reason: "Session TTL.",
          source: "model",
          lines: null,
        },
        {
          hunkId: receiptsHunk.id,
          riskClass: "logic",
          reason: "Renders.",
          source: "model",
          lines: null,
        },
        {
          hunkId: receiptsHunk.id,
          riskClass: "contract",
          reason: "A path rule.",
          source: "rule",
          lines: null,
        },
      ],
    });
    expect(points.map((point) => [point.id, point.title])).toEqual([
      [`r:${authHunk.id}`, "Session TTL."],
    ]);
  });

  it("lands a deletion-only hunk on its old lines", () => {
    const removed = fileChange({ path: "src/a.ts", status: "modified", language: "typescript" }, [
      hunk("src/a.ts", "@@ -4,3 +4,1 @@", [" keep();", "-check();", "-guard();"]),
    ]);
    const removedHunk = removed.hunks[0];
    if (removedHunk === undefined) throw new Error("built with a hunk");
    const [point] = pointsOf({
      files: [removed],
      intent: null,
      findings: [],
      decisions: [],
      risk: [
        {
          hunkId: removedHunk.id,
          riskClass: "contract",
          reason: "x",
          source: "model",
          lines: null,
        },
      ],
    });
    expect(point?.lines).toEqual({ hunkId: removedHunk.id, side: "old", startLine: 5, line: 6 });
  });

  it("lands a risk on the lines the model names, or on its hunk's changes when it shows none of them", () => {
    const routes = fileChange(
      { path: "src/routes.ts", status: "modified", language: "typescript" },
      [
        hunk("src/routes.ts", "@@ -1,1 +1,4 @@", [
          " const router = Router();",
          '+import { save } from "./tokens";',
          "+",
          '+router.put("/token", save);',
        ]),
      ],
    );
    const routeHunk = routes.hunks[0];
    if (routeHunk === undefined) throw new Error("built with a hunk");
    const riskOn = (startLine: number, line: number) =>
      pointsOf({
        files: [routes],
        intent: null,
        findings: [],
        decisions: [],
        risk: [
          {
            hunkId: routeHunk.id,
            riskClass: "contract",
            reason: "Accepts a token.",
            source: "model",
            lines: { hunkId: routeHunk.id, side: "new", startLine, line },
          },
        ],
      })[0]?.lines;
    expect(riskOn(4, 4)).toEqual({ hunkId: routeHunk.id, side: "new", startLine: 4, line: 4 });
    expect(riskOn(4, 9)).toEqual({ hunkId: routeHunk.id, side: "new", startLine: 2, line: 4 });
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
