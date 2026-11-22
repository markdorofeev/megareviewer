// Test support: a reviewer's history as the suggestion call reads it, and the answer recorded for it.

import type { ProposalDraft, SuggestionInput } from "../../../../application/ports/index.ts";
import {
  PreferenceId,
  ProposalId,
  type RepoRef,
  type ReviewSignal,
} from "../../../../domain/review/index.ts";

const api: RepoRef = { host: "github", owner: "acme", repo: "api" };

const signal = (
  kind: ReviewSignal["kind"],
  pointKind: ReviewSignal["pointKind"],
  repo: RepoRef,
  number: number,
  path: string,
  title: string,
  text: string,
): ReviewSignal => ({
  kind,
  at: "2026-11-16T10:00:00.000Z",
  pullRequest: { repo, number },
  pointKind,
  title,
  text,
  path,
});

/**
 * One repository's history: two dismissals of one sort, three signals and two of the reviewer's
 * comments on the host about tenant filters.
 */
export const suggestionInput: SuggestionInput = {
  signals: [
    signal(
      "dismissed",
      "finding",
      api,
      15,
      "src/plugins.ts",
      "Missing JSDoc on `loadPlugins`",
      "`loadPlugins` is exported without a doc comment saying what it returns.",
    ),
    signal(
      "raised",
      "risk",
      api,
      15,
      "src/invoices/queries.ts",
      "Reads another tenant's invoices when `tenantId` is omitted",
      "`listInvoices` drops the `tenant_id` filter when the caller passes no tenant.",
    ),
    signal(
      "comment",
      null,
      api,
      14,
      "src/orders/queries.ts",
      "",
      "This query needs a tenant_id filter, like every other one in this module.",
    ),
    signal(
      "dismissed",
      "finding",
      api,
      12,
      "src/config.ts",
      "Missing JSDoc on `parseConfig`",
      "`parseConfig` is exported without a doc comment.",
    ),
    signal(
      "raised",
      "finding",
      api,
      12,
      "src/orders/queries.ts",
      "Query on orders has no tenant filter",
      "`findOrders` selects by status alone, so it returns every tenant's orders.",
    ),
  ],
  comments: [
    {
      pullRequest: { repo: api, number: 9 },
      path: "src/orders/queries.ts",
      body: "Filter by tenant here too.",
      at: "2026-10-20T10:00:00.000Z",
    },
    {
      pullRequest: { repo: api, number: 7 },
      path: null,
      body: "Same as last time: this reads across tenants.",
      at: "2026-10-12T10:00:00.000Z",
    },
  ],
  preferences: [
    {
      id: PreferenceId.parse("pref_00000000000000a1"),
      kind: "dont-flag",
      text: "Naming of test helpers",
      scope: { kind: "global" },
      source: "written",
      enabled: true,
      createdAt: "2026-11-01T09:00:00.000Z",
      updatedAt: "2026-11-01T09:00:00.000Z",
    },
  ],
  rejected: [
    {
      id: ProposalId.parse("prop_00000000000000b1"),
      kind: "look-for",
      text: "Missing tests for new endpoints",
      scope: { kind: "repo", repo: api },
      source: "learned",
      evidence: [],
      status: "rejected",
      createdAt: "2026-11-02T09:00:00.000Z",
    },
  ],
  repo: api,
};

/**
 * What Sonnet 5.5 answered through Claude Code, as its recording has it, for this history when a
 * suggestion read every repository's signals: it had two of acme/shop's too, and no comments.
 */
export const suggestedDrafts: readonly ProposalDraft[] = [
  {
    kind: "dont-flag",
    text: "Missing JSDoc or doc comments on exported functions",
    scope: "global",
    evidence: [
      "Dismissed: Missing JSDoc on `loadPlugins`, acme/api #15",
      "Dismissed: Missing JSDoc on `parseConfig`, acme/api #12",
      "Dismissed: No doc comment on `retryDelay`, acme/shop #3",
    ],
  },
  {
    kind: "look-for",
    text: "Tenant isolation: every query on tenant data must filter by tenant_id, and never drop the filter when the tenant is omitted",
    scope: "repo",
    evidence: [
      "Raised: Reads another tenant's invoices when `tenantId` is omitted, acme/api #15",
      "Comment: This query needs a tenant_id filter, acme/api #14",
      "Raised: Query on orders has no tenant filter, acme/api #12",
    ],
  },
];
