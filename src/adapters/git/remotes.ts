import type { HostKind, RepoRef } from "../../domain/review/index.ts";

const HOSTS: Readonly<Record<string, HostKind>> = {
  "github.com": "github",
  "bitbucket.org": "bitbucket",
};

/**
 * The repository a git remote URL names, for the hosts megareviewer supports: over HTTPS, SSH
 * (`git@github.com:owner/repo.git` or `ssh://git@github.com/owner/repo`) or git. Null for any other
 * host, including an SSH alias from ~/.ssh/config, whose real host isn't in the URL.
 */
export const repoOfRemote = (url: string): RepoRef | null => {
  const trimmed = url.trim();
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(trimmed);
  const full = /^(?:https?|ssh|git|git\+ssh):\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/(.+)$/.exec(
    trimmed,
  );
  const match = full ?? (/^[a-z+]+:\/\//.test(trimmed) ? null : scp);
  if (match === null) return null;
  const [, hostName = "", path = ""] = match;
  const host = HOSTS[hostName.toLowerCase()];
  const segments = path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/");
  const [owner, repo] = segments;
  if (host === undefined || segments.length !== 2 || !owner || !repo) return null;
  return { host, owner: owner.toLowerCase(), repo: repo.toLowerCase() };
};

export const sameRepo = (a: RepoRef, b: RepoRef): boolean =>
  a.host === b.host &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.repo.toLowerCase() === b.repo.toLowerCase();

/** The repositories `git remote -v` output names, once each, in its order. */
export const reposOfRemotes = (output: string): RepoRef[] => {
  const repos: RepoRef[] = [];
  for (const line of output.split("\n")) {
    const url = line.split(/\s+/)[1];
    const repo = url === undefined ? null : repoOfRemote(url);
    if (repo !== null && !repos.some((known) => sameRepo(known, repo))) repos.push(repo);
  }
  return repos;
};
