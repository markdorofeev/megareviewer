import { Octokit } from "@octokit/rest";
import type { z } from "zod";
import type { Clock, Logger } from "../../application/ports/index.ts";
import type { HostError } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { fromOctokitError, invalidResponse, timedOut } from "./errors.ts";

export interface GitHubClientOptions {
  readonly token: string;
  /** megareviewer's version, for the user-agent. */
  readonly version: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  /** How long a read may take before it fails as a network error. */
  readonly requestTimeoutMs?: number;
}

/** A stalled read is abandoned after this, so it can be retried. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Octokit's per-request options: the signal that enforces the deadline. */
export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface GitHubClient {
  readonly octokit: Octokit;
  /**
   * Sends a request and parses what it returns. Octokit's errors become HostErrors. A read that
   * takes longer than the timeout fails as a network error; `deadline: false` is for a post,
   * where giving up wouldn't stop GitHub from completing it.
   */
  read<T>(
    what: string,
    schema: z.ZodType<T>,
    send: (request: RequestOptions) => Promise<unknown>,
    options?: { deadline?: boolean },
  ): Promise<Result<T, HostError>>;
}

export const createGitHubClient = (options: GitHubClientOptions): GitHubClient => {
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

  return { octokit, read };
};
