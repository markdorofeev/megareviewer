import type { AnalysisView } from "../../../contracts/index.ts";
import {
  type AnalysisKey,
  analysisId,
  type Guidance,
  type GuidanceMark,
  PreferenceId,
  pullRequestUrl,
} from "../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks } from "./analysis.ts";

// The fixture PR after a run that read the reviewer's guidance: its first finding was raised by a
// preference, its third is one a preference says not to flag, and the dependency's risk comes from
// the repository's REVIEW.md.

const { analysis } = fixtureAnalysisView;
const ref = { ...analysis.key.ref, number: 904 };
const key: AnalysisKey = { ...analysis.key, ref };

export const fixtureGuidance: Guidance = {
  preferences: [
    {
      ref: "p1",
      id: PreferenceId.parse("pref_00000000000000a1"),
      kind: "look-for",
      text: "Lookups that aren't scoped to the signed-in user",
      scope: { kind: "global" },
    },
    {
      ref: "p2",
      id: PreferenceId.parse("pref_00000000000000a2"),
      kind: "dont-flag",
      text: "Retries without backoff",
      scope: { kind: "repo", repo: ref.repo },
    },
  ],
  guidelines: [{ ref: "g1", path: "REVIEW.md", linkedFrom: null, bytes: 1_240 }],
  checks: [],
};

const MARKS: Readonly<Record<string, GuidanceMark>> = {
  f1: { ref: "p1", effect: "raised" },
  f3: { ref: "p2", effect: "left-out" },
};

export const guidedAnalysisView: AnalysisView = {
  ...fixtureAnalysisView,
  analysis: {
    ...analysis,
    id: analysisId(key),
    key,
    pullRequest:
      analysis.pullRequest === null
        ? null
        : { ...analysis.pullRequest, ref, url: pullRequestUrl(ref) },
    guidance: fixtureGuidance,
    findings: analysis.findings.map((finding) => ({
      ...finding,
      guidance: MARKS[finding.id] ?? null,
    })),
    risk: analysis.risk.map((risk) =>
      risk.source === "model" && risk.hunkId === fixtureHunks.dependency
        ? { ...risk, guidance: { ref: "g1", effect: "raised" as const } }
        : risk,
    ),
  },
};
