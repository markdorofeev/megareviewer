import { useSyncExternalStore } from "react";
import {
  AnalysisId,
  HostKind,
  type PullRequestRef,
  parsePullRequestUrl,
  pullRequestUrl,
} from "../../../src/domain/review/index.ts";

export type Route =
  | { readonly page: "picker" }
  | { readonly page: "review"; readonly analysisId: AnalysisId }
  /** A PR before its analysis exists, so a link to it can open in a new tab. */
  | { readonly page: "open"; readonly ref: PullRequestRef }
  | { readonly page: "not-found" };

const NOT_FOUND: Route = { page: "not-found" };

const decoded = (part: string | undefined): string | null => {
  if (part === undefined) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

const segment = (pathname: string, prefix: string): string | null =>
  decoded(new RegExp(`^/${prefix}/([^/]+)/?$`).exec(pathname)?.[1]);

export const matchRoute = (pathname: string): Route => {
  if (pathname === "/") return { page: "picker" };
  const review = segment(pathname, "review");
  if (review !== null) {
    const analysisId = AnalysisId.safeParse(review);
    return analysisId.success ? { page: "review", analysisId: analysisId.data } : NOT_FOUND;
  }
  const pr = /^\/pr\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (pr !== null) {
    const host = HostKind.safeParse(pr[1]);
    const owner = decoded(pr[2]);
    const repo = decoded(pr[3]);
    const number = decoded(pr[4]);
    if (!host.success || owner === null || repo === null || number === null) return NOT_FOUND;
    // The host's own parser, so the route takes exactly the PRs a pasted link does.
    const ref = parsePullRequestUrl(
      pullRequestUrl({ repo: { host: host.data, owner, repo }, number: Number(number) }),
    );
    return ref.ok && String(ref.value.number) === number
      ? { page: "open", ref: ref.value }
      : NOT_FOUND;
  }
  return NOT_FOUND;
};

/** Where a PR opens: it starts the analysis, then goes on to the review. */
export const pullRequestPath = ({ repo, number }: PullRequestRef): string =>
  `/pr/${repo.host}/${[repo.owner, repo.repo].map(encodeURIComponent).join("/")}/${number}`;

export const reviewPath = (analysisId: AnalysisId): string =>
  `/review/${encodeURIComponent(analysisId)}`;

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

export const usePathname = (): string =>
  useSyncExternalStore(subscribe, () => window.location.pathname);

export const navigate = (path: string): void => {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/** Goes to `path` in place of the current entry, so Back skips the page that redirected. */
export const redirect = (path: string): void => {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
