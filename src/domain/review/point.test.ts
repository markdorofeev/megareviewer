import { describe, expect, it } from "vitest";
import { fileChange, hunk, smallFeatureAnalysis } from "../../application/testing/index.ts";
import { HunkId } from "../diff/index.ts";
import { type Finding, FindingId, pointsOf, validateFindings } from "./index.ts";

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
});

describe("pointsOf", () => {
  it("orders findings, then mismatches, then the model's risks, then decisions", () => {
    // config/app.yaml's three contract hunks are the path rules' too, so only the route's is a point.
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
      ["risk", `r:${smallFeatureAnalysis.risk[4]?.hunkId}`],
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
      },
      {
        id: "m2",
        kind: "finding",
        title: "Hard-codes the lifetime.",
        explanation: "Contradicts what was asked.",
        path: "src/services/receipts.ts",
        lines: { hunkId: receiptsHunk.id, side: "new", startLine: 1, line: 20 },
        hunkIds: [receiptsHunk.id],
      },
    ]);
  });

  it("leaves out a contract hunk the path rules raised, and the model's logic", () => {
    const auth = fileChange(
      { path: "src/auth/session.ts", status: "modified", language: "typescript" },
      [hunk("src/auth/session.ts", "@@ -1,1 +1,1 @@", ["-const ttl = 1;", "+const ttl = 2;"])],
    );
    const authHunk = auth.hunks[0];
    if (authHunk === undefined) throw new Error("built with a hunk");
    const points = pointsOf({
      files: [auth, ...smallFeatureAnalysis.files],
      proofs: [],
      intent: null,
      findings: [],
      decisions: [],
      risk: [
        { hunkId: authHunk.id, riskClass: "contract", reason: "Session TTL.", source: "model" },
        { hunkId: receiptsHunk.id, riskClass: "logic", reason: "Renders.", source: "model" },
      ],
    });
    expect(points).toEqual([]);
  });

  it("lands a deletion-only hunk on its old lines", () => {
    const removed = fileChange({ path: "src/a.ts", status: "modified", language: "typescript" }, [
      hunk("src/a.ts", "@@ -4,3 +4,1 @@", [" keep();", "-check();", "-guard();"]),
    ]);
    const removedHunk = removed.hunks[0];
    if (removedHunk === undefined) throw new Error("built with a hunk");
    const [point] = pointsOf({
      files: [removed],
      proofs: [],
      intent: null,
      findings: [],
      decisions: [],
      risk: [{ hunkId: removedHunk.id, riskClass: "contract", reason: "x", source: "model" }],
    });
    expect(point?.lines).toEqual({ hunkId: removedHunk.id, side: "old", startLine: 5, line: 6 });
  });
});

describe("validateFindings", () => {
  const hunks = new Map([[receiptsHunk.id, receiptsHunk]]);

  it("accepts a finding on lines its hunk shows", () => {
    expect(validateFindings([finding()], hunks)).toEqual([]);
  });

  it("names an unknown hunk, lines the hunk doesn't show, and text that doesn't fit", () => {
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
      { kind: "too-long", index: 3, field: "explanation" },
      { kind: "too-long", index: 4, field: "title" },
    ]);
  });
});
