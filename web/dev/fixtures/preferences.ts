import type { PreferencesView } from "../../../contracts/index.ts";
import {
  type Preference,
  PreferenceId,
  type PreferenceProposal,
  ProposalId,
  type RepoRef,
} from "../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "./analysis.ts";

// What a reviewer who has used megareviewer for a while has: rules for everywhere and for one
// repository, from each source, two proposals waiting, and a repository's guideline files.

const shop: RepoRef = fixtureAnalysisView.analysis.key.ref.repo;
/** A repository with a preference and no analysis yet, on a host without past reviews to read. */
const api: RepoRef = { host: "bitbucket", owner: "acme", repo: "api" };

const preference = (
  n: number,
  fields: Pick<Preference, "kind" | "text" | "scope" | "source"> & { readonly enabled?: boolean },
): Preference => ({
  id: PreferenceId.parse(`pref_${String(n).padStart(16, "0")}`),
  enabled: true,
  createdAt: `2026-10-0${n}T10:00:00.000Z`,
  updatedAt: `2026-10-0${n}T10:00:00.000Z`,
  ...fields,
});

const proposal = (
  n: number,
  fields: Pick<PreferenceProposal, "kind" | "text" | "scope" | "source" | "evidence">,
): PreferenceProposal => ({
  id: ProposalId.parse(`prop_${String(n).padStart(16, "0")}`),
  status: "pending",
  createdAt: "2026-10-20T09:00:00.000Z",
  ...fields,
});

/** What the mock's model proposes from the review signals. */
export const fixtureSuggestions: readonly PreferenceProposal[] = [
  proposal(1, {
    kind: "dont-flag",
    text: "Missing JSDoc on internal helpers",
    scope: { kind: "repo", repo: shop },
    source: "learned",
    evidence: [
      "Dismissed: Missing JSDoc on `parseConfig`, acme/shop #121",
      "Dismissed: Missing JSDoc on `renderReceipt`, acme/shop #128",
    ],
  }),
  proposal(2, {
    kind: "look-for",
    text: "Cached data that outlives a change to what it was made from",
    scope: { kind: "global" },
    source: "learned",
    evidence: [
      "Raised: Keeps serving a receipt rendered before a refund, acme/shop #128",
      'Comment: "What invalidates this when the order is refunded?", acme/shop #128',
    ],
  }),
];

/** What it proposes from the reviewer's past comments on a repository. */
export const fixtureImport: PreferenceProposal = proposal(3, {
  kind: "look-for",
  text: "Lookups that aren't scoped to the signed-in user",
  scope: { kind: "repo", repo: shop },
  source: "imported",
  evidence: ['Comment: "The lookup isn\'t scoped to the signed-in user.", acme/shop #96'],
});

export const fixturePreferencesView: PreferencesView = {
  preferences: [
    preference(1, {
      kind: "look-for",
      text: "Tenant isolation: every query filters by tenant ID",
      scope: { kind: "global" },
      source: "written",
    }),
    preference(2, {
      kind: "dont-flag",
      text: "Naming",
      scope: { kind: "global" },
      source: "learned",
    }),
    preference(3, {
      kind: "look-for",
      text: "Migrations that lock a table",
      scope: { kind: "repo", repo: shop },
      source: "imported",
    }),
    preference(4, {
      kind: "dont-flag",
      text: "Missing tests for changes that only add logging",
      scope: { kind: "repo", repo: shop },
      source: "written",
      enabled: false,
    }),
    preference(5, {
      kind: "look-for",
      text: "Endpoints that answer without checking the caller's workspace",
      scope: { kind: "repo", repo: api },
      source: "written",
    }),
  ],
  proposals: fixtureSuggestions,
  repositories: [
    {
      repo: shop,
      guidelineFiles: [
        { path: "REVIEW.md", bytes: 1_240, enabled: true, tooLarge: false },
        { path: "CLAUDE.md", bytes: 48_900, enabled: false, tooLarge: true },
        { path: "CONTRIBUTING.md", bytes: 6_020, enabled: false, tooLarge: false },
      ],
      guidelineNote: null,
    },
    {
      repo: api,
      guidelineFiles: null,
      guidelineNote: "No pull request of this repository has been analyzed yet",
    },
  ],
  signalsSinceSuggestion: 14,
};

/** A reviewer who hasn't written a preference or reviewed anything yet. */
export const emptyPreferencesView: PreferencesView = {
  preferences: [],
  proposals: [],
  repositories: [],
  signalsSinceSuggestion: 0,
};
