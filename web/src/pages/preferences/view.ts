import type { PreferencesView } from "../../../../contracts/index.ts";
import {
  type GuidelinePath,
  type Preference,
  type PreferenceId,
  type PreferenceProposal,
  type PreferenceScope,
  type ProposalId,
  type RepoRef,
  sameRepo,
  sameScope,
} from "../../../../src/domain/review/index.ts";

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

export const withGuidelineSwitch = (
  view: PreferencesView,
  repo: RepoRef,
  path: GuidelinePath,
  enabled: boolean,
): PreferencesView => ({
  ...view,
  repositories: view.repositories.map((one) =>
    sameRepo(one.repo, repo) && one.guidelineFiles !== null
      ? {
          ...one,
          guidelineFiles: one.guidelineFiles.map((file) =>
            file.path === path ? { ...file, enabled } : file,
          ),
        }
      : one,
  ),
});

export const preferencesIn = (
  view: PreferencesView,
  scope: PreferenceScope,
): readonly Preference[] => view.preferences.filter((one) => sameScope(one.scope, scope));

/**
 * The repositories the page has a section for: the ones the server lists, then any a preference
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
    });
  }
  return listed;
};

/** "1.2 KB", "48 KB", "812 B". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
};

/** A sentence from a server message, which may lack the final period. */
export const sentence = (text: string): string => {
  const trimmed = text.trim();
  return trimmed === "" || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;
