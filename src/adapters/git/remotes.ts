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

/** The repositories remote URLs name, once each, in their order. */
const reposOfUrls = (urls: readonly string[]): RepoRef[] => {
  const repos: RepoRef[] = [];
  for (const url of urls) {
    const repo = repoOfRemote(url);
    if (repo !== null && !repos.some((known) => sameRepo(known, repo))) repos.push(repo);
  }
  return repos;
};

/** The repositories `git remote -v` output names. */
export const reposOfRemotes = (output: string): RepoRef[] =>
  reposOfUrls(output.split("\n").map((line) => line.split(/\s+/)[1] ?? ""));

const SECTION = /^\s*\[\s*([\w.-]+)(?:\s+"[^\n]*")?\s*\]/;
const REMOTE_URL = /^\s*(?:url|pushurl)\s*=\s*(?:"([^"]*)"|([^#;]*))/i;

/**
 * The repositories a `.git/config` file's remotes name, read as text so that finding a clone runs no
 * git in it. Names what it can of a file git wouldn't parse; a file it includes isn't read.
 */
export const reposOfConfig = (text: string): RepoRef[] => {
  let inRemote = false;
  const urls: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const section = SECTION.exec(line);
    if (section !== null) inRemote = /^remote(?:\.|$)/i.test(section[1] ?? "");
    const url = inRemote ? REMOTE_URL.exec(line.slice(section?.[0].length ?? 0)) : null;
    if (url !== null) urls.push(url[1] ?? url[2] ?? "");
  }
  return reposOfUrls(urls);
};
