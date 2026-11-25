import type {
  AnalysisInput,
  AnalysisModel,
  FindingDraft,
  ModelRisk,
  PreferenceStore,
} from "../../application/ports/index.ts";
import { type PullRequestFixture, smallFeature } from "../../application/testing/index.ts";
import {
  type GuidanceMark,
  type Preference,
  type PreferenceKind,
  preferenceId,
  pullRequestUrl,
  type Timestamp,
} from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";
import { hunkWith, lineOf } from "./receipts-tested.ts";

const repo = { ...smallFeature.pullRequest.ref.repo, repo: "storefront" };
const ref = { repo, number: 7 };

const REVIEW_MD = `# Reviewing storefront

- A change to a rate limit says who asked for it and how it was load tested.
- A new endpoint that returns customer data is scoped to the signed-in user.
`;

const CONTRIBUTING_MD = `# Contributing

Open a pull request against \`main\`. Keep it small, and link the ticket it's for.
`;

/** Over the 64 KB a prompt holds of guideline files, so the page says it's too large to send. */
const CLAUDE_MD = `# Working on storefront\n\n${"- Keep route handlers thin; put the logic in a service.\n".repeat(1300)}`;

/**
 * small-feature in a repository of its own, on the fake server only: the shared fixture is every
 * test's and every eval's. Its repository has guideline files, and the reviewer two preferences
 * for it, so its AI review, below, has a finding a preference raised, one a preference says not to
 * flag, and a risk from REVIEW.md.
 */
export const receiptsGuided: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-guided",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, with guidance`,
  },
  baseFiles: {
    ...smallFeature.baseFiles,
    "REVIEW.md": REVIEW_MD,
    "CLAUDE.md": CLAUDE_MD,
    "CONTRIBUTING.md": CONTRIBUTING_MD,
  },
};

const LOOK_FOR = "Caches with nothing that invalidates them";
const DONT_FLAG = "Naming";

/** The reviewer's preferences for the guided PR's repository, which its AI review is shaped by. */
export const guidedPreferences = (at: Timestamp): Preference[] => {
  const taken = new Set<string>();
  return (
    [
      ["look-for", LOOK_FOR],
      ["dont-flag", DONT_FLAG],
    ] as const
  ).map(([kind, text]: readonly [PreferenceKind, string]) => {
    const fields = { kind, text, scope: { kind: "repo" as const, repo }, createdAt: at };
    const id = preferenceId(fields, taken);
    taken.add(id);
    return { id, ...fields, source: "written" as const, enabled: true, updatedAt: at };
  });
};

/** Saves the guided PR's preferences, as `pnpm dev:fake` starts with them. */
export const seedGuidedPreferences = async (store: PreferenceStore, at: Timestamp) => {
  for (const preference of guidedPreferences(at)) await store.savePreference(preference);
};

/**
 * The mark for a preference or a guideline file the run was given, by its text or its path: a run
 * numbers them itself, and the reviewer may have switched one off, which leaves the point unmarked.
 */
const markOf = (
  input: AnalysisInput,
  named: string,
  effect: GuidanceMark["effect"],
): GuidanceMark | null => {
  const { preferences, guidelines } = input.guidance;
  const found =
    preferences.find((preference) => preference.text === named) ??
    guidelines.find((file) => file.path === named);
  return found === undefined ? null : { ref: found.ref, effect };
};

/** The fake model's findings on the guided PR: one a preference asks for, one it says to leave out. */
const findingsOf = (input: AnalysisInput): FindingDraft[] => {
  const receipts = hunkWith(input, "src/services/receipts.ts", "renderReceipt");
  if (receipts === undefined) return [];
  return [
    {
      title: "Serves a receipt rendered before a refund for up to an hour",
      explanation:
        "`cache` is keyed by the order's ID and only expires by time, so a refunded or edited order keeps its old receipt until the hour is up.",
      lines: {
        hunkId: receipts.id,
        side: "new",
        startLine: lineOf(receipts, "cache.get(order.id)"),
        line: lineOf(receipts, "return cached.text"),
      },
      severity: "major",
      suggestion: null,
      mismatch: null,
      guidance: markOf(input, LOOK_FOR, "raised"),
    },
    {
      title: "`lines` could say what the lines are of",
      explanation: "The receipt's item lines read as any lines here; `itemLines` would say it.",
      lines: {
        hunkId: receipts.id,
        side: "new",
        startLine: lineOf(receipts, "const lines = "),
        line: lineOf(receipts, "const lines = "),
      },
      severity: "minor",
      suggestion: null,
      mismatch: null,
      guidance: markOf(input, DONT_FLAG, "left-out"),
    },
  ];
};

/** Its risks: the rate limit, which REVIEW.md asks about, and nothing else. */
const risksOf = (input: AnalysisInput): ModelRisk[] => {
  const limit = hunkWith(input, "config/app.yaml", "perMinute: 600");
  return input.files.flatMap((file) =>
    file.hunks.map((hunk): ModelRisk => {
      if (hunk.id !== limit?.id) {
        return {
          hunkId: hunk.id,
          riskClass: "logic",
          reason: "",
          lines: null,
          checkedBy: null,
          guidance: null,
        };
      }
      const line = lineOf(hunk, "perMinute");
      return {
        hunkId: hunk.id,
        riskClass: "contract",
        reason:
          "Every client can send ten times as many requests a minute, and nothing says who asked for it or how it was load tested.",
        lines: { hunkId: hunk.id, side: "new", startLine: line, line },
        checkedBy: null,
        guidance: markOf(input, "REVIEW.md", "raised"),
      };
    }),
  );
};

/** The model, but the guided PR's findings and risk passes answer the above, after its own time. */
export const withGuidance = (model: AnalysisModel, url: string): AnalysisModel => ({
  version: model.version,
  checkSize: (input) => model.checkSize(input),
  intent: (input, options) => model.intent(input, options),
  async findings(input, intent, options) {
    const answer = await model.findings(input, intent, options);
    if (!answer.ok || input.pullRequest.url !== url) return answer;
    return ok({ ...answer.value, value: findingsOf(input) });
  },
  async risk(input, options) {
    const answer = await model.risk(input, options);
    if (!answer.ok || input.pullRequest.url !== url) return answer;
    return ok({ ...answer.value, value: risksOf(input) });
  },
  decisions: (input, options) => model.decisions(input, options),
  steps: (input, options) => model.steps(input, options),
});
