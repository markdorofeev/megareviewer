import { stoppedReason, type Walk } from "../adapters/git/index.ts";
import type { HostKind, RepoRef } from "../domain/review/index.ts";

const HOST_DOMAINS: Readonly<Record<HostKind, string>> = {
  github: "github.com",
  bitbucket: "bitbucket.org",
};

export const repoName = ({ host, owner, repo }: RepoRef): string =>
  `${HOST_DOMAINS[host]}/${owner}/${repo}`;

/** What the search for clones did; null when it's off. */
export const clonesSummary = (walk: Walk | null): string => {
  if (walk === null) return "not searched for, with --no-search";
  const count = walk.clones.length === 1 ? "1 clone" : `${walk.clones.length} clones`;
  const stopped = walk.stopped === null ? "" : `. The search stopped early: ${stoppedReason(walk)}`;
  return `your home folder is searched for a PR's repository: ${count} found${stopped}. --no-search turns this off`;
};
