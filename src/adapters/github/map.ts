import type {
  Commit,
  HostUser,
  PullRequest,
  PullRequestRef,
  PullRequestSummary,
} from "../../domain/review/index.ts";
import type {
  GitHubCommit,
  GitHubOpenPullRequests,
  GitHubPullRequest,
  GitHubSearchResult,
  GitHubUser,
} from "./schemas.ts";

/** GitHub shows deleted accounts as "ghost". */
const GHOST: HostUser = { id: "ghost", name: "ghost" };

const account = (user: { login: string } | null): HostUser =>
  user === null ? GHOST : { id: user.login, name: user.login };

export const toHostUser = (user: GitHubUser): HostUser => ({
  id: user.login,
  name: user.name ?? user.login,
});

export const toCommit = (commit: GitHubCommit): Commit => ({
  sha: commit.sha,
  message: commit.commit.message,
  author: commit.commit.author?.name ?? commit.author?.login ?? "",
});

export const toPullRequest = (
  ref: PullRequestRef,
  pullRequest: GitHubPullRequest,
  details: { mergeBaseSha: string; commits: readonly GitHubCommit[]; diff: string },
): PullRequest => ({
  ref,
  url: pullRequest.html_url,
  title: pullRequest.title,
  description: pullRequest.body ?? "",
  author: account(pullRequest.user),
  sourceBranch: pullRequest.head.ref,
  targetBranch: pullRequest.base.ref,
  baseSha: details.mergeBaseSha,
  headSha: pullRequest.head.sha,
  commits: details.commits.map(toCommit),
  diff: details.diff,
  createdAt: pullRequest.created_at,
  updatedAt: pullRequest.updated_at,
});

export const toSummaries = (
  result: GitHubSearchResult,
  role: PullRequestSummary["role"],
): PullRequestSummary[] =>
  result.items.map((item) => {
    const [owner = "", repo = ""] = item.repository_url.split("/").slice(-2);
    return {
      // Lowercased like parsePullRequestUrl, so a picked PR and a pasted URL are one analysis.
      ref: {
        repo: { host: "github", owner: owner.toLowerCase(), repo: repo.toLowerCase() },
        number: item.number,
      },
      url: item.html_url,
      title: item.title,
      author: account(item.user),
      updatedAt: item.updated_at,
      role,
    };
  });

/** The alias a PR is asked about under, in a query of many. */
export const openAlias = (index: number): string => `p${index}`;

/** The refs whose PRs are open, as PRs to review. */
export const toOpenSummaries = (
  refs: readonly PullRequestRef[],
  data: GitHubOpenPullRequests,
): PullRequestSummary[] =>
  refs.flatMap((ref, index) => {
    const pullRequest = data[openAlias(index)]?.pullRequest;
    if (pullRequest == null || pullRequest.state !== "OPEN") return [];
    return [
      {
        ref,
        url: pullRequest.url,
        title: pullRequest.title,
        author: account(pullRequest.author),
        updatedAt: pullRequest.updatedAt,
        role: "reviewer" as const,
      },
    ];
  });

/** Newest first. ISO-8601 UTC timestamps sort as strings. */
export const byUpdatedAtDesc = (a: PullRequestSummary, b: PullRequestSummary): number =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
