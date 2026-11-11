import type { z } from "zod";
import type { Logger } from "../../application/ports/index.ts";
import type { HostError } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import {
  type CallKind,
  fromErrorResponse,
  invalidResponse,
  networkError,
  timedOut,
} from "./errors.ts";
import { BitbucketPage } from "./schemas.ts";

export const API = "https://api.bitbucket.org/2.0";
const API_ORIGIN = new URL(API).origin;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
/** Pages followed per list before giving up and logging, so a huge list can't stall a call. */
export const MAX_PAGES = 10;
/** A call, request and body together, is abandoned after this, so a stalled one can be retried. */
export const REQUEST_TIMEOUT_MS = 60_000;

export interface ClientOptions {
  readonly username: string;
  readonly password: string;
  readonly logger: Logger;
  readonly fetch: typeof fetch;
  readonly requestTimeoutMs?: number;
}

export interface JsonRequest {
  readonly method?: "GET" | "POST" | "DELETE";
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Sent as a form instead, for the endpoints that take one. */
  readonly form?: URLSearchParams;
  readonly call?: CallKind;
}

/** Bitbucket's REST API over plain fetch: Basic auth, redirects, errors and pagination. */
export interface BitbucketClient {
  json<T>(
    what: string,
    schema: z.ZodType<T>,
    url: string,
    request?: JsonRequest,
  ): Promise<Result<T, HostError>>;
  /** A raw response (a diff, a file), decoded as UTF-8. */
  text(url: string, accept: string): Promise<Result<string, HostError>>;
  /** Every item of a paginated list, following `next` for at most MAX_PAGES pages. */
  pages<T>(what: string, item: z.ZodType<T>, url: string): Promise<Result<T[], HostError>>;
  /** A write whose answer has no body worth reading: its Location header, if any. */
  send(url: string, request: JsonRequest): Promise<Result<string | null, HostError>>;
}

export const createBitbucketClient = (options: ClientOptions): BitbucketClient => {
  const { logger } = options;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;

  /**
   * Follows redirects itself so the credentials only ever go to Bitbucket's API: a redirect
   * elsewhere (an LFS file's media URL) is followed without them.
   */
  const send = async (
    url: string,
    accept: string,
    request: JsonRequest,
    signal: AbortSignal,
  ): Promise<Result<Response, HostError>> => {
    let target = url;
    for (let hop = 0; ; hop += 1) {
      const toApi = new URL(target).origin === API_ORIGIN;
      const hasBody = request.body !== undefined || request.form !== undefined;
      let response: Response;
      try {
        response = await options.fetch(target, {
          method: request.method ?? "GET",
          redirect: "manual",
          signal,
          headers: {
            accept,
            ...(toApi ? { authorization } : {}),
            ...(request.form !== undefined
              ? { "content-type": "application/x-www-form-urlencoded" }
              : request.body !== undefined
                ? { "content-type": "application/json" }
                : {}),
          },
          ...(request.form !== undefined
            ? { body: request.form.toString() }
            : request.body !== undefined
              ? { body: JSON.stringify(request.body) }
              : {}),
        });
      } catch (error) {
        // fetch throws a TypeError when it can't connect. Anything else is a bug.
        if (error instanceof TypeError) return err(networkError(error));
        throw error;
      }
      const location = response.headers.get("location");
      if (
        !REDIRECTS.has(response.status) ||
        location === null ||
        hasBody ||
        hop === MAX_REDIRECTS
      ) {
        return ok(response);
      }
      target = new URL(location, target).href;
    }
  };

  /**
   * Sends, turns a non-2xx answer into a HostError, and reads a 2xx one with `read`, all within
   * the timeout. A connection that drops mid-body is a network error too.
   */
  const call = async <T>(
    url: string,
    accept: string,
    request: JsonRequest,
    read: (response: Response) => Promise<Result<T, HostError>>,
  ): Promise<Result<T, HostError>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(url, accept, request, controller.signal);
      if (!response.ok) return response;
      if (!response.value.ok) {
        const { status, headers } = response.value;
        const body = await response.value.text();
        return err(fromErrorResponse({ status, headers, body }, request.call ?? "read"));
      }
      return await read(response.value);
    } catch (error) {
      if (controller.signal.aborted) return err(timedOut(timeoutMs));
      if (error instanceof TypeError) return err(networkError(error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const json = async <T>(
    what: string,
    schema: z.ZodType<T>,
    url: string,
    request: JsonRequest = {},
  ): Promise<Result<T, HostError>> =>
    call(url, "application/json", request, async (response) => {
      const text = await response.text();
      let data: unknown;
      try {
        data = text === "" ? null : JSON.parse(text);
      } catch {
        return err(invalidResponse(what, "the body isn't JSON"));
      }
      const parsed = schema.safeParse(data);
      return parsed.success ? ok(parsed.data) : err(invalidResponse(what, parsed.error));
    });

  const pages = async <T>(
    what: string,
    item: z.ZodType<T>,
    url: string,
  ): Promise<Result<T[], HostError>> => {
    const page = BitbucketPage(item);
    const items: T[] = [];
    let next: string | undefined = url;
    for (let count = 0; next !== undefined; count += 1) {
      if (count === MAX_PAGES) {
        logger.warn(`Stopped after ${MAX_PAGES} pages of ${what}; later ones are missing`, { url });
        break;
      }
      const result: Result<z.infer<typeof page>, HostError> = await json(what, page, next);
      if (!result.ok) return result;
      items.push(...result.value.values);
      next = result.value.next;
    }
    return ok(items);
  };

  return {
    json,
    pages,

    send: (url, request) =>
      call(url, "application/json", request, async (response) => {
        await response.arrayBuffer();
        return ok(response.headers.get("location"));
      }),

    text: (url, accept) =>
      // Bitbucket sends files and diffs in the repository's encoding, with no charset.
      call(url, accept, {}, async (response) =>
        ok(new TextDecoder().decode(await response.arrayBuffer())),
      ),
  };
};
