import { z } from "zod";
import type { ReviewHistory } from "../../application/ports/index.ts";
import type { HostError, PastComment, RepoRef } from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import { createGitHubClient, type GitHubClientOptions } from "./client.ts";
import { GitHubPullRequestComment, GitHubReviewedPullRequests, GitHubUser } from "./schemas.ts";

/** One page of search results, so the most pull requests a read covers. */
export const MAX_PULL_REQUESTS = 100;
/** The most comments a read answers, the newest. */
export const MAX_PAST_COMMENTS = 300;
/** Pull requests whose comments are asked for at once, as files are. */
const CONCURRENCY = 6;

/** The pull requests of a repository the token's user reviewed and didn't write. */
export const reviewedQuery = ({ owner, repo }: RepoRef): string =>
  `repo:${owner}/${repo} is:pr reviewed-by:@me -author:@me`;

const newestFirst = (a: PastComment, b: PastComment): number => Date.parse(b.at) - Date.parse(a.at);

export const createGitHubReviewHistory = (options: GitHubClientOptions): ReviewHistory => {
  const { logger } = options;
  const { octokit, read } = createGitHubClient(options);

  let login: string | null = null;
  const currentLogin = async (): Promise<Result<string, HostError>> => {
    if (login !== null) return ok(login);
    const user = await read("the current user", GitHubUser, async (request) => {
      return (await octokit.request("GET /user", { request })).data;
    });
    if (!user.ok) return user;
    login = user.value.login;
    return ok(login);
  };

  const reviewed = (repo: RepoRef, pullRequests: number) =>
    read("the pull requests you reviewed", GitHubReviewedPullRequests, async (request) => {
      return (
        await octokit.request("GET /search/issues", {
          q: reviewedQuery(repo),
          sort: "updated",
          order: "desc",
          per_page: Math.min(Math.max(pullRequests, 1), MAX_PULL_REQUESTS),
          request,
        })
      ).data;
    });

  /** The user's comments on the code of one pull request, replies among them. */
  const commentsOn = async (
    repo: RepoRef,
    number: number,
    author: string,
  ): Promise<Result<PastComment[], HostError>> => {
    const comments = await read(
      "a pull request's comments",
      z.array(GitHubPullRequestComment),
      (request) =>
        octokit.paginate(octokit.rest.pulls.listReviewComments, {
          owner: repo.owner,
          repo: repo.repo,
          pull_number: number,
          per_page: 100,
          request,
        }),
    );
    if (!comments.ok) return comments;
    return ok(
      comments.value
        .filter((comment) => comment.user?.login === author && comment.body.trim() !== "")
        .map((comment) => ({
          pullRequest: { repo, number },
          path: comment.path,
          body: comment.body,
          at: comment.created_at,
        })),
    );
  };

  /**
   * What a read that failed had already got, by pull request and when it was last updated, so
   * its retry asks only for the rest. Dropped once a read succeeds.
   */
  let kept: { readonly repo: string; readonly comments: Map<string, PastComment[]> } | null = null;

  return {
    host: "github",

    async getReviewerComments(repo, { pullRequests }) {
      const [user, found] = await Promise.all([currentLogin(), reviewed(repo, pullRequests)]);
      if (!user.ok) return user;
      if (!found.ok) return found;
      if (found.value.incomplete_results) {
        logger.warn("GitHub's search returned only some of the pull requests you reviewed", {
          repo: `${repo.owner}/${repo.repo}`,
        });
      }

      const repoKey = `${repo.owner}/${repo.repo}`;
      const got = kept?.repo === repoKey ? kept.comments : new Map<string, PastComment[]>();
      kept = { repo: repoKey, comments: got };

      const { items } = found.value;
      const comments: PastComment[] = [];
      for (let start = 0; start < items.length; start += CONCURRENCY) {
        const results = await Promise.all(
          items.slice(start, start + CONCURRENCY).map(async ({ number, updated_at }) => {
            const key = `${number}@${updated_at}`;
            const before = got.get(key);
            if (before !== undefined) return ok(before);
            const read = await commentsOn(repo, number, user.value);
            if (read.ok) got.set(key, read.value);
            return read;
          }),
        );
        for (const result of results) {
          if (!result.ok) return result;
          comments.push(...result.value);
        }
      }
      if (kept?.comments === got) kept = null;

      if (comments.length > MAX_PAST_COMMENTS) {
        logger.info(`Kept the ${MAX_PAST_COMMENTS} newest of your comments on GitHub`, {
          repo: repoKey,
          found: comments.length,
        });
      }
      return ok({
        comments: comments.sort(newestFirst).slice(0, MAX_PAST_COMMENTS),
        pullRequests: items.length,
      });
    },
  };
};
