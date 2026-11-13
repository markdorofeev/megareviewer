import { z } from "zod";
import type { HostError, HostErrorKind } from "../../domain/review/index.ts";
import { GitHubErrorBody } from "./schemas.ts";

/** What Octokit throws: a RequestError, with no response when fetch itself failed. */
const OctokitError = z.object({
  message: z.string(),
  status: z.number(),
  response: z
    .object({
      status: z.number(),
      headers: z.record(z.string(), z.unknown()),
      data: z.unknown(),
    })
    .optional(),
});

/** What octokit.graphql throws when GitHub answers 200 with errors, e.g. a missing repository. */
const GraphqlResponseError = z.object({
  name: z.literal("GraphqlResponseError"),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).min(1),
});

const GraphqlPartialResponse = GraphqlResponseError.extend({ data: z.unknown() });

/**
 * The data GitHub answered alongside errors, when it did: a query of many aliases answers
 * every alias, with null for those that failed.
 */
export const graphqlPartialData = (error: unknown): unknown => {
  const parsed = GraphqlPartialResponse.safeParse(error);
  return parsed.success ? parsed.data.data : undefined;
};

export interface GitHubErrorResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly data: unknown;
}

const hostError = (
  kind: HostErrorKind,
  message: string,
  retryAfterSeconds: number | null = null,
): HostError => ({ kind, message, retryAfterSeconds });

const header = (response: GitHubErrorResponse, name: string): string | null => {
  const value = response.headers[name];
  return typeof value === "string" ? value : null;
};

const seconds = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value);
};

/** `retry-after` in seconds, else the `x-ratelimit-reset` epoch seconds relative to now. */
const retryAfterSeconds = (response: GitHubErrorResponse, now: string): number | null => {
  const retryAfter = seconds(header(response, "retry-after"));
  if (retryAfter !== null) return retryAfter;
  const reset = seconds(header(response, "x-ratelimit-reset"));
  if (reset === null) return null;
  return Math.max(0, reset - Math.floor(Date.parse(now) / 1000));
};

/** GitHub's message plus its error details, which carry the reason for a 422. */
const githubMessage = (response: GitHubErrorResponse): string => {
  const body = GitHubErrorBody.safeParse(response.data);
  if (!body.success) return `GitHub answered ${response.status}`;
  const details = (body.data.errors ?? [])
    .map((detail) => (typeof detail === "string" ? detail : detail.message))
    .filter((detail) => detail !== undefined && detail !== "");
  return details.length === 0 ? body.data.message : `${body.data.message}: ${details.join("; ")}`;
};

const isDiffTooLarge = (message: string): boolean =>
  /diff/i.test(message) && /too (large|big|long)|exceed/i.test(message);

export const fromErrorResponse = (response: GitHubErrorResponse, now: string): HostError => {
  const { status } = response;
  const message = githubMessage(response);
  const rateLimited =
    status === 429 ||
    (status === 403 &&
      (header(response, "x-ratelimit-remaining") === "0" ||
        header(response, "retry-after") !== null));

  if (status === 401) {
    return hostError("unauthorized", "GitHub rejected the token. Check GITHUB_TOKEN or `gh auth`.");
  }
  if (rateLimited) {
    return hostError(
      "rate-limited",
      `GitHub rate limit reached: ${message}`,
      retryAfterSeconds(response, now),
    );
  }
  if (status === 403) return hostError("forbidden", `GitHub refused the request: ${message}`);
  if (status === 404) {
    return hostError(
      "not-found",
      "Not found on GitHub. If the repository is private, the token may lack access to it.",
    );
  }
  if (status === 406 || (status === 422 && isDiffTooLarge(message))) {
    return hostError("too-large", `GitHub can't produce this diff: ${message}`);
  }
  if (status === 422) return hostError("rejected", message);
  return hostError("unexpected", `GitHub answered ${status}: ${message}`);
};

/**
 * Maps whatever Octokit threw. Anything that isn't an Octokit request error is a bug in
 * this adapter, so it's rethrown.
 */
export const fromOctokitError = (error: unknown, now: string): HostError => {
  const graphql = GraphqlResponseError.safeParse(error);
  if (graphql.success) {
    const { errors } = graphql.data;
    const message = `GitHub answered: ${errors.map((detail) => detail.message).join("; ")}`;
    return hostError(errors[0]?.type === "NOT_FOUND" ? "not-found" : "unexpected", message);
  }
  const parsed = OctokitError.safeParse(error);
  if (!parsed.success) throw error;
  const { response, message } = parsed.data;
  if (response === undefined) return hostError("network", `Can't reach GitHub: ${message}`);
  return fromErrorResponse(response, now);
};

export const timedOut = (timeoutMs: number): HostError =>
  hostError("network", `GitHub didn't answer within ${timeoutMs / 1000} seconds`);

export const invalidResponse = (what: string, error: z.ZodError): HostError =>
  hostError(
    "invalid-response",
    `Unexpected response from GitHub for ${what}: ${z.prettifyError(error)}`,
  );
