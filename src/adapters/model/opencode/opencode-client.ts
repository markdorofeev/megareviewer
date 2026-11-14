import { err, ok, type Result } from "../../../domain/shared/index.ts";
import type { OpencodeServer, ServerProblem } from "./opencode-server.ts";

/** Why a request got no answer it could use. */
export type OpencodeHttpError =
  | { readonly kind: "server"; readonly problem: ServerProblem }
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "status"; readonly status: number; readonly body: string };

export type OpencodeFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OpencodeClient {
  /** The parsed JSON answer, or null for an empty one. Untrusted: the caller parses it. */
  request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options?: { readonly body?: unknown; readonly timeoutMs?: number },
  ): Promise<Result<unknown, OpencodeHttpError>>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Requests to the server megareviewer started, with its password. */
export const createOpencodeClient = (
  server: OpencodeServer,
  fetchImpl: OpencodeFetch = fetch,
): OpencodeClient => ({
  async request(method, path, options = {}) {
    const connection = await server.connect();
    if (!connection.ok) return err({ kind: "server", problem: connection.error });
    const { url, password } = connection.value;
    let response: Response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") return err({ kind: "timeout" });
      return err({ kind: "network", message: error instanceof Error ? error.message : String(error) });
    }
    const text = await response.text();
    if (!response.ok) return err({ kind: "status", status: response.status, body: text });
    if (text === "") return ok(null);
    try {
      return ok(JSON.parse(text));
    } catch {
      return err({ kind: "status", status: response.status, body: text.slice(0, 200) });
    }
  },
});

/** A request's failure, in words for a log or an error message. */
export const describeHttpError = (error: OpencodeHttpError): string => {
  switch (error.kind) {
    case "server":
      return error.problem.message;
    case "network":
      return `opencode's server didn't answer: ${error.message}`;
    case "timeout":
      return "opencode's server didn't answer in time";
    case "status":
      return `opencode's server answered ${error.status}: ${error.body.slice(0, 200)}`;
  }
};
