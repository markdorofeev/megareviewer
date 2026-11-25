import type {
  GuidelineUse,
  LinkedGuidelineFile,
  PreferencesView,
  RepositoryPreferences,
} from "../../../../contracts/index.ts";
import {
  type Preference,
  type PreferenceId,
  type PreferenceProposal,
  type PreferenceScope,
  type ProposalId,
  type RepoRef,
  sameRepo,
  sameScope,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { GLOBAL, type ScopeOption, scopeKey } from "./rule.tsx";

// What each answer of the API changes in the view the page shows, so nothing is read again.

/** A preference in place of the one with its ID, or after the others. */
export const withPreference = (view: PreferencesView, saved: Preference): PreferencesView => ({
  ...view,
  preferences: view.preferences.some((one) => one.id === saved.id)
    ? view.preferences.map((one) => (one.id === saved.id ? saved : one))
    : [...view.preferences, saved],
});

export const withoutPreference = (view: PreferencesView, id: PreferenceId): PreferencesView => ({
  ...view,
  preferences: view.preferences.filter((one) => one.id !== id),
});

/** New proposals after the ones waiting, each once. */
export const withProposals = (
  view: PreferencesView,
  proposals: readonly PreferenceProposal[],
): PreferencesView => ({
  ...view,
  proposals: [
    ...view.proposals,
    ...proposals.filter((added) => !view.proposals.some((one) => one.id === added.id)),
  ],
});

export const withoutProposal = (view: PreferencesView, id: ProposalId): PreferencesView => ({
  ...view,
  proposals: view.proposals.filter((one) => one.id !== id),
});

/** A repository as a switch of its files left it. */
export const withRepository = (
  view: PreferencesView,
  switched: RepositoryPreferences,
): PreferencesView => ({
  ...view,
  repositories: view.repositories.map((one) =>
    sameRepo(one.repo, switched.repo) ? switched : one,
  ),
});

/** How a review uses a file, in words that name no transport. */
export const USE_WORDS: Readonly<Record<GuidelineUse, string>> = {
  prompt: "In every review",
  "on-request": "Read when the model asks",
};

/** Files by the one that links them, in the order they're first linked. */
export const byLinking = (
  linked: readonly LinkedGuidelineFile[],
): readonly (readonly [string, readonly LinkedGuidelineFile[]])[] => {
  const groups = new Map<string, LinkedGuidelineFile[]>();
  for (const file of linked) {
    groups.set(file.linkedFrom, [...(groups.get(file.linkedFrom) ?? []), file]);
  }
  return [...groups];
};

/** "8 linked files, 71 KB". */
export const linkedTotal = (linked: readonly LinkedGuidelineFile[]): string =>
  `${plural(linked.length, "linked file")}, ${formatBytes(linked.reduce((sum, file) => sum + file.bytes, 0))}`;

/** "2 in every review, 5 on request, 1 ignored". */
export const linkedUses = (linked: readonly LinkedGuidelineFile[]): string =>
  (
    [
      ["prompt", "in every review"],
      ["on-request", "on request"],
      [null, "ignored"],
    ] as const
  )
    .map(([use, words]) => [linked.filter((file) => file.use === use).length, words] as const)
    .filter(([count]) => count > 0)
    .map(([count, words]) => `${count} ${words}`)
    .join(", ");

export const preferencesIn = (
  view: PreferencesView,
  scope: PreferenceScope,
): readonly Preference[] => view.preferences.filter((one) => sameScope(one.scope, scope));

export const proposalsIn = (
  view: PreferencesView,
  scope: PreferenceScope,
): readonly PreferenceProposal[] => view.proposals.filter((one) => sameScope(one.scope, scope));

/** A repository with nothing yet: no preference and no proposal for it. */
export const isFirstRun = (view: PreferencesView, scope: PreferenceScope): boolean =>
  scope.kind === "repo" &&
  preferencesIn(view, scope).length === 0 &&
  proposalsIn(view, scope).length === 0;

/** The key of the panel that lists every proposal, beside one panel per scope. */
export const SUGGESTIONS = "suggestions";

/** What the page shows: every proposal, or one scope's settings. */
export type Panel =
  | { readonly kind: "suggestions" }
  | { readonly kind: "scope"; readonly option: ScopeOption };

/** The panel a key names, or Everywhere's when it names none, as a repository no longer listed. */
export const panelFor = (key: string | null, options: readonly ScopeOption[]): Panel => {
  if (key === SUGGESTIONS) return { kind: "suggestions" };
  const option =
    options.find((one) => one.key === key) ??
    options.find((one) => one.key === scopeKey(GLOBAL)) ??
    options[0];
  return option === undefined ? { kind: "suggestions" } : { kind: "scope", option };
};

/** Each scope's proposals, in the scopes' order, leaving out the scopes that have none. */
export const proposalGroups = (
  view: PreferencesView,
  options: readonly ScopeOption[],
): readonly { readonly option: ScopeOption; readonly proposals: readonly PreferenceProposal[] }[] =>
  options
    .map((option) => ({ option, proposals: proposalsIn(view, option.scope) }))
    .filter((group) => group.proposals.length > 0);

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/** Where new proposals went: "for acme/shop", or "1 for Everywhere and 2 for acme/shop". */
export const whereAdded = (
  added: readonly PreferenceProposal[],
  options: readonly ScopeOption[],
): string => {
  const counts = options
    .map((option) => ({
      label: option.label,
      count: added.filter((one) => sameScope(one.scope, option.scope)).length,
    }))
    .filter((one) => one.count > 0);
  const [only] = counts;
  if (counts.length === 1 && only !== undefined) return `for ${only.label}`;
  return AND.format(counts.map(({ count, label }) => `${count} for ${label}`));
};

/**
 * What a suggestion read and came to, as the line under the panel's title says it: the host's
 * comments and the actions recorded here, then how many suggestions and `where` they went.
 */
export const suggestionSaid = (
  read: { readonly signals: number; readonly comments: number; readonly pullRequests: number },
  added: number,
  where: string,
): string => {
  const parts = [
    ...(read.comments > 0
      ? [`${plural(read.comments, "comment")} from ${plural(read.pullRequests, "pull request")}`]
      : []),
    ...(read.signals > 0 ? [`${plural(read.signals, "action")} recorded here`] : []),
  ];
  if (parts.length === 0) {
    return read.pullRequests === 0
      ? "Found nothing to suggest from: no comment of yours on its pull requests, and nothing you did here."
      : `Found no comment of yours on its last ${plural(read.pullRequests, "pull request")}, and nothing you did here.`;
  }
  const from = `Read ${AND.format(parts)}`;
  return added === 0
    ? `${from}: nothing new to suggest.`
    : `${from}: ${plural(added, "suggestion")}, ${where}.`;
};

/**
 * What the scope list calls a repository: its name, with its owner only where another repository
 * listed has the same name, since the full name is in its tooltip.
 */
export const listName = (
  repo: RepoRef,
  repos: readonly RepoRef[],
): { readonly owner: string | null; readonly name: string } => ({
  owner: repos.some((other) => other.repo === repo.repo && !sameRepo(other, repo))
    ? repo.owner
    : null,
  name: repo.repo,
});

/**
 * The repositories the page has a panel for: the ones the server lists, then any a preference
 * or a proposal is for that it doesn't, so none is out of sight.
 */
export const repositoriesOf = (view: PreferencesView): PreferencesView["repositories"] => {
  const listed = [...view.repositories];
  for (const { scope } of [...view.preferences, ...view.proposals]) {
    if (scope.kind !== "repo" || listed.some((one) => sameRepo(one.repo, scope.repo))) continue;
    listed.push({
      repo: scope.repo,
      guidelineFiles: null,
      guidelineNote: "No pull request of this repository has been analyzed yet",
      harnessCut: null,
      harnessSkipped: [],
      harnessNote: null,
    });
  }
  return listed;
};

/** "1.2 KB", "48 KB", "812 B", "1.1 MB". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
  }
  const megabytes = kilobytes / 1024;
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
};

/** A sentence from a server message, which may lack the final period. */
export const sentence = (text: string): string => {
  const trimmed = text.trim();
  return trimmed === "" || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/** Why a request failed, in the server's own words where they're written for the reviewer. */
export const failureReason = (error: ApiError): string =>
  error.code === "bad-request" ? sentence(error.message) : errorMessage(error);

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;
