import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import {
  analysisEventsRoute,
  attachmentRoute,
  ERROR_STATUS,
  type ErrorResponse,
  TOKEN_HEADER,
  TOKEN_QUERY_PARAM,
} from "../../../contracts/index.ts";
import type { Logger } from "../../application/ports/index.ts";

/** Method, path without the query string (it may hold the token), status and duration. */
export const requestLog =
  (logger: Logger): MiddlewareHandler =>
  async (c, next) => {
    const started = performance.now();
    await next();
    logger.debug("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  };

const SECURITY_HEADERS = {
  // Inline styles: syntax-highlighting colors are set as style attributes.
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'none'",
  // The first page load has the session token in its URL.
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
};

/** Blocks DNS rebinding: a foreign page that resolves its name to 127.0.0.1 still sends its Host. */
export const hostCheck = (allowedHosts: readonly string[]): MiddlewareHandler => {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  return async (c, next) => {
    const host = c.req.header("host")?.toLowerCase();
    if (host === undefined || !allowed.has(host)) return c.text("Forbidden host", 403);
    await next();
  };
};

const pathPattern = (path: string): RegExp =>
  new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
/** Routes the browser loads without a script, which can't send a header. */
const QUERY_TOKEN_PATHS = [
  pathPattern(analysisEventsRoute.path),
  pathPattern(attachmentRoute.path),
];

/**
 * Every /api request carries the session token in a header. Only the events and attachment routes
 * may put it in the query string instead, because EventSource, `<img>` and `<video>` can't set
 * headers.
 */
export const sessionToken = (token: string): MiddlewareHandler => {
  const expected = Buffer.from(token);
  const matches = (given: string | undefined): boolean => {
    if (given === undefined) return false;
    const actual = Buffer.from(given);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  return async (c, next) => {
    const queryAllowed =
      c.req.method === "GET" && QUERY_TOKEN_PATHS.some((path) => path.test(c.req.path));
    if (
      !matches(c.req.header(TOKEN_HEADER)) &&
      !(queryAllowed && matches(c.req.query(TOKEN_QUERY_PARAM)))
    ) {
      const body: ErrorResponse = {
        error: { code: "unauthorized", message: "Missing or wrong session token" },
      };
      return c.json(body, ERROR_STATUS.unauthorized);
    }
    await next();
  };
};
