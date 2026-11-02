import type { HostError } from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";
import type { GitHost, Logger } from "../ports/index.ts";

/** The wait before each retry: three retries, so four attempts in all. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export interface RetryOptions {
  readonly sleep: (ms: number) => Promise<void>;
  readonly logger: Logger;
}

/**
 * Retries the host's reads that fail on the network: a dropped connection or a timeout, which
 * a flaky link makes common and a second try usually gets past. Other failures are answers and
 * aren't retried. Publishing is passed through untouched, because a post that failed on the
 * network may still have been posted.
 */
export const retryingGitHost = (host: GitHost, { sleep, logger }: RetryOptions): GitHost => {
  const retried = async <T>(
    what: string,
    attempt: () => Promise<Result<T, HostError>>,
  ): Promise<Result<T, HostError>> => {
    let result = await attempt();
    for (const delayMs of RETRY_DELAYS_MS) {
      if (result.ok || result.error.kind !== "network") return result;
      logger.warn(`Retrying ${what} after a network error`, {
        host: host.host,
        error: result.error.message,
        delayMs,
      });
      await sleep(delayMs);
      result = await attempt();
    }
    return result;
  };

  return {
    host: host.host,
    currentUser: () => retried("the current user", () => host.currentUser()),
    getPullRequest: (ref) => retried("the pull request", () => host.getPullRequest(ref)),
    getFiles: (repo, files) => retried(`${files.length} files`, () => host.getFiles(repo, files)),
    listPullRequests: () => retried("the pull request list", () => host.listPullRequests()),
    publish: (ref, publication, options) => host.publish(ref, publication, options),
  };
};
