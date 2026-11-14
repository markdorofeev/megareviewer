import { err, ok, type Result } from "../shared/index.ts";
import type { HostKind, PullRequestRef } from "./pull-request.ts";

const HOSTS: Readonly<Record<string, { kind: HostKind; pullSegment: string }>> = {
  "github.com": { kind: "github", pullSegment: "pull" },
  "bitbucket.org": { kind: "bitbucket", pullSegment: "pull-requests" },
};

const NAME = /^[A-Za-z0-9._-]+$/;
const NUMBER = /^[1-9][0-9]*$/;

const isName = (segment: string | undefined): segment is string =>
  segment !== undefined && NAME.test(segment) && segment !== "." && segment !== "..";

/** A link pasted without its scheme, "github.com/acme/web/pull/3307", is read as https. */
const withScheme = (url: string): string =>
  /^(github\.com|bitbucket\.org)\//i.test(url) ? `https://${url}` : url;

/**
 * Accepts github.com and bitbucket.org PR URLs, with any trailing path, query or fragment, and
 * with or without `https://`.
 * Owner and repo are lowercased: both hosts treat them case-insensitively, and one PR
 * should map to one analysis however its URL was typed.
 */
export const parsePullRequestUrl = (url: string): Result<PullRequestRef, "unsupported-url"> => {
  let parsed: URL;
  try {
    parsed = new URL(withScheme(url.trim()));
  } catch {
    return err("unsupported-url");
  }
  const host = HOSTS[parsed.hostname];
  if (
    host === undefined ||
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return err("unsupported-url");
  }
  const [root, owner, repo, pullSegment, number] = parsed.pathname.split("/");
  if (
    root !== "" ||
    !isName(owner) ||
    !isName(repo) ||
    pullSegment !== host.pullSegment ||
    number === undefined ||
    !NUMBER.test(number) ||
    !Number.isSafeInteger(Number(number))
  ) {
    return err("unsupported-url");
  }
  return ok({
    repo: { host: host.kind, owner: owner.toLowerCase(), repo: repo.toLowerCase() },
    number: Number(number),
  });
};

export const pullRequestUrl = (ref: PullRequestRef): string => {
  const { host, owner, repo } = ref.repo;
  switch (host) {
    case "github":
      return `https://github.com/${owner}/${repo}/pull/${ref.number}`;
    case "bitbucket":
      return `https://bitbucket.org/${owner}/${repo}/pull-requests/${ref.number}`;
  }
};
