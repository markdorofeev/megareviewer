import type { HostError } from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";
import type { GitHost, Logger, PullRequestStatusSource, ReviewThreads } from "../ports/index.ts";

/** The wait before each retry: three retries, so four attempts in all. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export interface RetryOptions {
  readonly sleep: (ms: number) => Promise<void>;
  readonly logger: Logger;
}

/**
 * Retries reads that fail on the network. Publishing isn't retried: a post that failed may still
 * have landed.
 */
const retrier =
  (host: string, { sleep, logger }: RetryOptions) =>
  async <T>(
    what: string,
    attempt: () => Promise<Result<T, HostError>>,
  ): Promise<Result<T, HostError>> => {
    let result = await attempt();
    for (const delayMs of RETRY_DELAYS_MS) {
      if (result.ok || result.error.kind !== "network") return result;
      logger.warn(`Retrying ${what} after a network error`, {
        host,
        error: result.error.message,
        delayMs,
      });
      await sleep(delayMs);
      result = await attempt();
    }
    return result;
  };

export const retryingGitHost = (host: GitHost, options: RetryOptions): GitHost => {
  const retried = retrier(host.host, options);

  return {
    host: host.host,
    currentUser: () => retried("the current user", () => host.currentUser()),
    getPullRequest: (ref) => retried("the pull request", () => host.getPullRequest(ref)),
    getFiles: (repo, files) => retried(`${files.length} files`, () => host.getFiles(repo, files)),
    listPullRequests: () => retried("the pull request list", () => host.listPullRequests()),
    getOpenPullRequests: (refs) =>
      retried("the opened pull requests", () => host.getOpenPullRequests(refs)),
    publish: (ref, publication, options) => host.publish(ref, publication, options),
  };
};

/**
 * Retries reading threads after a network failure, as for the host's other reads. Replying,
 * resolving and committing are passed through untouched: each may have happened anyway.
 */
export const retryingReviewThreads = (
  threads: ReviewThreads,
  options: RetryOptions,
): ReviewThreads => {
  const retried = retrier(threads.host, options);
  return {
    host: threads.host,
    getThreads: (ref) => retried("the review threads", () => threads.getThreads(ref)),
    getAttachment: (url) => retried("an attachment", () => threads.getAttachment(url)),
    reply: (ref, threadId, body) => threads.reply(ref, threadId, body),
    comment: (ref, comment) => threads.comment(ref, comment),
    setResolved: (ref, threadId, resolved) => threads.setResolved(ref, threadId, resolved),
  };
};

/** Retries reading a PR's status after a network failure, as for the host's other reads. */
export const retryingStatusSource = (
  source: PullRequestStatusSource,
  options: RetryOptions,
): PullRequestStatusSource => {
  const retried = retrier(source.host, options);
  return {
    host: source.host,
    getStatus: (ref, headSha) =>
      retried("the pull request's status", () => source.getStatus(ref, headSha)),
  };
};
