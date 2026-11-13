import { z } from "zod";
import type { HostError, HostErrorKind } from "../../domain/review/index.ts";
import { BitbucketErrorBody, MissingScopesDetail } from "./schemas.ts";

export interface BitbucketErrorResponse {
  readonly status: number;
  readonly headers: Headers;
  /** The body as text: JSON for most errors, plain text for some (a missing PR, a rate limit). */
  readonly body: string;
}

/** Publishing calls get `rejected` for 400 and 409, which on reads would be our bug. */
export type CallKind = "read" | "publish";

/** Bitbucket doesn't document a delay. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;
/** Bitbucket's documented status for a diff too large to produce in time. */
const DIFF_TIMED_OUT = 555;

const hostError = (
  kind: HostErrorKind,
  message: string,
  retryAfterSeconds: number | null = null,
): HostError => ({ kind, message, retryAfterSeconds });

const seconds = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value);
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Bitbucket's message, plus the scopes a 403 says the token lacks. null when it gave none. */
const bitbucketMessage = (response: BitbucketErrorResponse): string | null => {
  const body = BitbucketErrorBody.safeParse(parseJson(response.body));
  if (!body.success) {
    // Some errors are plain text ("Not Found"). Anything long or HTML is a proxy's page.
    const text = response.body.trim();
    return text === "" || text.length > 200 || text.startsWith("<") ? null : text;
  }
  const { message, detail } = body.data.error;
  if (typeof detail === "string" && detail !== "") return `${message}: ${detail}`;
  const scopes = MissingScopesDetail.safeParse(detail);
  if (scopes.success) return `${message} Needed: ${scopes.data.required.join(", ")}.`;
  return message;
};

const withMessage = (prefix: string, message: string | null): string =>
  message === null ? prefix : `${prefix}: ${message}`;

/**
 * `retry-after` in seconds, else `x-ratelimit-reset`, which Bitbucket sends on a 429 as the
 * seconds until the window resets (seen live; it's undocumented), else a minute.
 */
const retryAfterSeconds = (headers: Headers): number =>
  seconds(headers.get("retry-after")) ??
  seconds(headers.get("x-ratelimit-reset")) ??
  DEFAULT_RETRY_AFTER_SECONDS;

export const fromErrorResponse = (response: BitbucketErrorResponse, call: CallKind): HostError => {
  const { status } = response;
  const message = bitbucketMessage(response);

  if (status === 401) {
    return hostError(
      "unauthorized",
      "Bitbucket rejected the credentials. Check BITBUCKET_EMAIL and BITBUCKET_API_TOKEN, or BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD.",
    );
  }
  if (status === 429) {
    return hostError(
      "rate-limited",
      withMessage("Bitbucket rate limit reached", message),
      retryAfterSeconds(response.headers),
    );
  }
  if (status === 403) {
    return hostError("forbidden", withMessage("Bitbucket refused the request", message));
  }
  if (status === 404) {
    return hostError(
      "not-found",
      "Not found on Bitbucket. If the repository is private, the credentials may lack access to it.",
    );
  }
  if (status === DIFF_TIMED_OUT) {
    return hostError("too-large", "Bitbucket timed out producing this diff; it's too large.");
  }
  if (call === "publish" && (status === 400 || status === 409)) {
    return hostError("rejected", message ?? `Bitbucket rejected the request (${status})`);
  }
  return hostError("unexpected", withMessage(`Bitbucket answered ${status}`, message));
};

/** What `fetch` throws when it can't reach the host: a TypeError, usually with a cause. */
export const networkError = (error: TypeError): HostError => {
  const cause = error.cause instanceof Error ? error.cause.message : error.message;
  return hostError("network", `Can't reach Bitbucket: ${cause}`);
};

export const timedOut = (timeoutMs: number): HostError =>
  hostError("network", `Bitbucket didn't answer within ${timeoutMs / 1000} seconds`);

export const invalidResponse = (what: string, error: z.ZodError | string): HostError =>
  hostError(
    "invalid-response",
    `Unexpected response from Bitbucket for ${what}: ${
      typeof error === "string" ? error : z.prettifyError(error)
    }`,
  );
