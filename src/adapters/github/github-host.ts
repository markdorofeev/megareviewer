import { Octokit } from "@octokit/rest";
import { z } from "zod";
import type { Clock, FileAt, GitHost, Logger } from "../../application/ports/index.ts";
import type { CommentKey, HostError, HostUser, RepoRef } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { fromOctokitError, invalidResponse, timedOut } from "./errors.ts";
import { byUpdatedAtDesc, toHostUser, toPullRequest, toSummaries } from "./map.ts";
import { matchComments, planReview, SUMMARY } from "./publish.ts";
import {
  GitHubBlobs,
  GitHubCommit,
  GitHubComparison,
  GitHubPullRequest,
  GitHubReview,
  GitHubReviewComment,
  GitHubSearchResult,
  GitHubText,
  GitHubUser,
} from "./schemas.ts";

export interface GitHubHostOptions {
  readonly token: string;
  /** megareviewer's version, for the user-agent. */
  readonly version: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  /** How long a read may take before it fails as a network error. */
  readonly requestTimeoutMs?: number;
}

const DIFF = "application/vnd.github.diff";
const RAW = "application/vnd.github.raw";
/** GitHub's cap on `GET /pulls/{n}/commits`. */
const MAX_COMMITS = 250;
const SEARCH_PAGE_SIZE = 50;
/** Files per GraphQL query: each is an alias, so one request reads them all. */
const FILES_PER_QUERY = 25;
/** A stalled read is abandoned after this, so it can be retried. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Reads `count` files, each named by a "sha:path" variable so paths are never interpolated. */
const blobsQuery = (count: number): string => {
  const indexes = Array.from({ length: count }, (_, i) => i);
  const variables = indexes.map((i) => `$e${i}: String!`).join(", ");
  const objects = indexes
    .map(
      (i) =>
        `f${i}: object(expression: $e${i}) { __typename ... on Blob { text isBinary isTruncated } }`,
    )
    .join("\n    ");
  return `query ($owner: String!, $repo: String!, ${variables}) {\n  repository(owner: $owner, name: $repo) {\n    ${objects}\n  }\n}`;
};

/** Octokit's per-request options: the signal that enforces the deadline. */
interface RequestOptions {
  readonly signal?: AbortSignal;
}

export const createGitHubHost = (options: GitHubHostOptions): GitHost => {
  const { clock, logger } = options;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const octokit = new Octokit({
    auth: options.token,
    userAgent: `megareviewer/${options.version}`,
    request: options.fetch === undefined ? {} : { fetch: options.fetch },
    // Octokit logs every request, failed ones as errors. Failures come back as HostErrors for
    // the caller to report, so only its warnings (deprecated endpoints) are more than detail.
    log: {
      debug: (message) => logger.debug(message),
      info: (message) => logger.debug(message),
      warn: (message) => logger.warn(message),
      error: (message) => logger.debug(message),
    },
  });

  /**
   * Sends a request and parses what it returns. Octokit's errors become HostErrors. A read that
   * takes longer than the timeout fails as a network error; `deadline: false` is for a post,
   * where giving up wouldn't stop GitHub from completing it.
   */
  const read = async <T>(
    what: string,
    schema: z.ZodType<T>,
    send: (request: RequestOptions) => Promise<unknown>,
    { deadline = true }: { deadline?: boolean } = {},
  ): Promise<Result<T, HostError>> => {
    const controller = deadline ? new AbortController() : null;
    const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs);
    let data: unknown;
    try {
      data = await send(controller === null ? {} : { signal: controller.signal });
    } catch (error) {
      if (controller?.signal.aborted) return err(timedOut(timeoutMs));
      return err(fromOctokitError(error, clock.now()));
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const parsed = schema.safeParse(data);
    return parsed.success ? ok(parsed.data) : err(invalidResponse(what, parsed.error));
  };

  /** One file through the REST API, which gives files of any size; null when it isn't there. */
  const fileOverRest = async (
    repo: RepoRef,
    { sha, path }: FileAt,
  ): Promise<Result<string | null, HostError>> => {
    // Octokit would encode the slashes of a {path} parameter, so the path goes in as is.
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const content = await read(`${path} at ${sha}`, GitHubText, async (request) => {
      return (
        await octokit.request(`GET /repos/{owner}/{repo}/contents/${encodedPath}`, {
          owner: repo.owner,
          repo: repo.repo,
          ref: sha,
          headers: { accept: RAW },
          request,
        })
      ).data;
    });
    if (!content.ok && (content.error.kind === "not-found" || content.error.kind === "too-large")) {
      return ok(null);
    }
    return content;
  };

  let cachedUser: HostUser | null = null;

  return {
    host: "github",

    async currentUser() {
      if (cachedUser !== null) return ok(cachedUser);
      const user = await read("the current user", GitHubUser, async (request) => {
        return (await octokit.request("GET /user", { request })).data;
      });
      if (!user.ok) return user;
      cachedUser = toHostUser(user.value);
      return ok(cachedUser);
    },

    async getPullRequest(ref) {
      const { owner, repo } = ref.repo;
      const pull_number = ref.number;
      const pullRequest = await read("the pull request", GitHubPullRequest, async (request) => {
        return (
          await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
            owner,
            repo,
            pull_number,
            request,
          })
        ).data;
      });
      if (!pullRequest.ok) return pullRequest;

      // The diff comes from the PR's own base and head SHAs, not from the PR, so it can't be
      // from a newer push than headSha. It's the same three-dot diff GitHub shows on the PR.
      const basehead = `${pullRequest.value.base.sha}...${pullRequest.value.head.sha}`;
      const [diff, comparison, commits] = await Promise.all([
        read("the diff", GitHubText, async (request) => {
          return (
            await octokit.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
              owner,
              repo,
              basehead,
              headers: { accept: DIFF },
              request,
            })
          ).data;
        }),
        read("the merge base", GitHubComparison, async (request) => {
          return (
            await octokit.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
              owner,
              repo,
              basehead,
              request,
            })
          ).data;
        }),
        read("the commits", z.array(GitHubCommit), (request) =>
          octokit.paginate(octokit.rest.pulls.listCommits, {
            owner,
            repo,
            pull_number,
            per_page: 100,
            request,
          }),
        ),
      ]);
      if (!diff.ok) return diff;
      if (!comparison.ok) return comparison;
      if (!commits.ok) return commits;
      if (commits.value.length >= MAX_COMMITS) {
        logger.warn("GitHub lists at most 250 commits of a pull request; later ones are missing", {
          pullRequest: pullRequest.value.html_url,
        });
      }

      return ok(
        toPullRequest(ref, pullRequest.value, {
          mergeBaseSha: comparison.value.merge_base_commit.sha,
          commits: commits.value,
          diff: diff.value,
        }),
      );
    },

    async getFiles(repo, files) {
      const found: (string | null)[] = [];
      for (let start = 0; start < files.length; start += FILES_PER_QUERY) {
        const chunk = files.slice(start, start + FILES_PER_QUERY);
        const blobs = await read(`${chunk.length} files`, GitHubBlobs, (request) =>
          octokit.graphql(blobsQuery(chunk.length), {
            owner: repo.owner,
            repo: repo.repo,
            ...Object.fromEntries(chunk.map(({ sha, path }, i) => [`e${i}`, `${sha}:${path}`])),
            request,
          }),
        );
        if (!blobs.ok) return blobs;
        for (const [i, file] of chunk.entries()) {
          const object = blobs.value.repository[`f${i}`];
          if (object === null) {
            found.push(null);
          } else if (
            object?.__typename === "Blob" &&
            typeof object.text === "string" &&
            object.isBinary !== true &&
            object.isTruncated !== true
          ) {
            found.push(object.text);
          } else {
            // Large, binary or not a plain file: the REST API gives it whole, as before.
            const content = await fileOverRest(repo, file);
            if (!content.ok) return content;
            found.push(content.value);
          }
        }
      }
      return ok(found);
    },

    async listPullRequests() {
      const search = (qualifier: string) =>
        read("the pull request search", GitHubSearchResult, async (request) => {
          return (
            await octokit.request("GET /search/issues", {
              q: `is:pr is:open archived:false ${qualifier}`,
              per_page: SEARCH_PAGE_SIZE,
              request,
            })
          ).data;
        });
      const [reviewing, authored] = await Promise.all([
        search("review-requested:@me"),
        search("author:@me"),
      ]);
      if (!reviewing.ok) return reviewing;
      if (!authored.ok) return authored;

      for (const [qualifier, result] of [
        ["review-requested:@me", reviewing.value],
        ["author:@me", authored.value],
      ] as const) {
        if (result.incomplete_results || result.total_count > result.items.length) {
          logger.warn("GitHub's search returned only some of the pull requests", {
            qualifier,
            total: result.total_count,
            returned: result.items.length,
          });
        }
      }

      return ok(
        [
          ...toSummaries(reviewing.value, "reviewer"),
          ...toSummaries(authored.value, "author"),
        ].sort(byUpdatedAtDesc),
      );
    },

    async publish(ref, publication, { headSha, alreadyPosted, onPosted }) {
      const plan = planReview(publication, headSha, alreadyPosted);
      if (plan === null) return ok({ url: null, publishedAt: clock.now(), postedCommentIds: {} });

      const { owner, repo } = ref.repo;
      const pull_number = ref.number;
      const review = await read(
        "the new review",
        GitHubReview,
        async () => {
          return (
            await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
              owner,
              repo,
              pull_number,
              ...plan.request,
              comments: [...plan.request.comments],
            })
          ).data;
        },
        { deadline: false },
      );
      if (!review.ok) return review;
      const reviewId = String(review.value.id);

      // The review is posted. From here on nothing may fail, or a retry would post it twice.
      const hostComments =
        plan.comments.length === 0
          ? ok([])
          : await read("the review's comments", z.array(GitHubReviewComment), (request) =>
              octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
                owner,
                repo,
                pull_number,
                review_id: review.value.id,
                per_page: 100,
                request,
              }),
            );
      if (!hostComments.ok) {
        logger.warn("Couldn't read the review's comments back; recording the review's ID", {
          review: review.value.html_url,
          error: hostComments.error.message,
        });
      }

      const posted: [CommentKey, string][] = plan.postsSummary ? [[SUMMARY, reviewId]] : [];
      for (const [key, commentId] of matchComments(
        plan.comments,
        hostComments.ok ? hostComments.value : [],
      )) {
        if (commentId === null && hostComments.ok) {
          logger.warn("A posted comment didn't come back from GitHub; recording the review's ID", {
            review: review.value.html_url,
            key,
          });
        }
        posted.push([key, commentId ?? reviewId]);
      }
      for (const [key, hostCommentId] of posted) await onPosted(key, hostCommentId);

      return ok({
        url: review.value.html_url,
        publishedAt: review.value.submitted_at ?? clock.now(),
        postedCommentIds: Object.fromEntries(posted),
      });
    },
  };
};
