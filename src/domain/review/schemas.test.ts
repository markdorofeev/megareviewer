import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../../application/testing/index.ts";
import { HunkId } from "../diff/index.ts";
import {
  Analysis,
  AnalysisId,
  CommentKey,
  DecisionId,
  FlowId,
  GuidanceRef,
  HttpUrl,
  Intent,
  PreferenceId,
  ProposalId,
  PublicationReceipt,
  Sha,
  Timestamp,
} from "./index.ts";

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("ID and primitive schemas", () => {
  it.each([
    [HunkId, "h_0123456789abcdef", true],
    [HunkId, "h_0123456789abcdef-2", true],
    [HunkId, "h_0123456789abcdef-12", true],
    [HunkId, "h_0123456789abcdef-1", false],
    [HunkId, "h_0123456789abcdef-0", false],
    [HunkId, "h_0123456789ABCDEF", false],
    [HunkId, "h_0123456789abcde", false],
    [HunkId, "d1", false],
    [DecisionId, "d1", true],
    [DecisionId, "d12", true],
    [DecisionId, "d0", false],
    [DecisionId, "s1", false],
    [FlowId, "s3", true],
    [FlowId, "d3", false],
    [AnalysisId, "a_0123456789abcdef", true],
    [AnalysisId, "a_0123", false],
    [CommentKey, "summary", true],
    [CommentKey, "decision:d4", true],
    [CommentKey, "decision:h_0123456789abcdef", false],
    [CommentKey, "summary2", false],
    [Sha, "0123456789abcdef0123456789abcdef01234567", true],
    [Sha, "0123456", false],
    [Sha, "0123456789ABCDEF0123456789ABCDEF01234567", false],
    [Timestamp, "2026-10-21T09:30:00Z", true],
    [Timestamp, "2026-10-21T09:30:00.123Z", true],
    [Timestamp, "2026-10-21T09:30:00+04:00", false],
    [Timestamp, "2026-10-21", false],
    [HttpUrl, "https://github.com/acme/shop/pull/1", true],
    [HttpUrl, "http://localhost:8080/x", true],
    [HttpUrl, "javascript:alert(1)", false],
    [HttpUrl, "data:text/html,hi", false],
    [PreferenceId, "pref_0123456789abcdef", true],
    [PreferenceId, "prop_0123456789abcdef", false],
    [ProposalId, "prop_0123456789abcdef", true],
    [ProposalId, "prop_0123", false],
    [GuidanceRef, "p1", true],
    [GuidanceRef, "g12", true],
    [GuidanceRef, "p0", false],
    [GuidanceRef, "f1", false],
  ] as const)("%#: %s", (schema, value, valid) => {
    expect(accepts(schema, value)).toBe(valid);
  });
});

describe("PublicationReceipt", () => {
  it("accepts comment IDs by key and rejects unknown keys", () => {
    const receipt = {
      url: null,
      publishedAt: "2026-10-21T09:30:00Z",
      postedCommentIds: { summary: "1", "decision:d1": "2" },
    };
    expect(PublicationReceipt.parse(receipt)).toEqual(receipt);
    expect(
      accepts(PublicationReceipt, { ...receipt, postedCommentIds: { "decision:x": "3" } }),
    ).toBe(false);
  });
});

describe("Intent", () => {
  it("reads an intent stored before the brief, with no shape and nothing to watch", () => {
    const stored = {
      stated: null,
      inferred: { summary: "Adds receipts.", behaviorChanges: ["GET /receipt"] },
      mismatches: [],
    };
    expect(Intent.parse(stored).inferred).toEqual({
      summary: "Adds receipts.",
      shape: "",
      behaviorChanges: ["GET /receipt"],
      watch: [],
    });
  });
});

describe("Analysis", () => {
  it("reads one stored before guidance: none on the run, no mark on a finding or a risk", () => {
    const { guidance: _, ...analysis } = smallFeatureAnalysis;
    const stored = {
      ...analysis,
      findings: analysis.findings.map(({ guidance: _, ...finding }) => finding),
      risk: analysis.risk.map(({ guidance: _, ...risk }) => risk),
    };

    const parsed = Analysis.parse(JSON.parse(JSON.stringify(stored)));

    expect(parsed).toEqual(smallFeatureAnalysis);
    expect(parsed.guidance).toBeNull();
    expect(parsed.findings.map((finding) => finding.guidance)).toEqual([null]);
    expect(parsed.risk.every((risk) => risk.guidance === null)).toBe(true);
  });
});
