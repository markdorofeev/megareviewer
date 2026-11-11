import type { z } from "zod";
import {
  ErrorResponse,
  type JsonRoute,
  type PublicationPreviewRequest,
  type PublishRequest,
  type PutVerdictRequest,
  type RouteName,
  routePath,
  routes,
  type StartAnalysisRequest,
  TOKEN_HEADER,
} from "../../../contracts/index.ts";
import type { AnalysisId, DecisionId } from "../../../src/domain/review/index.ts";
import { err, ok, type Result } from "../../../src/domain/shared/index.ts";
import type { ApiError } from "./errors.ts";

export interface ApiClientOptions {
  readonly fetch: typeof fetch;
  readonly token: string;
  /** The server rejected the session token, so the app can ask for a fresh link. */
  readonly onUnauthorized: () => void;
}

const VERSION_MISMATCH =
  "The server sent a response this page doesn't understand, so the server and the UI may be different versions. Reload the page.";

const UNREACHABLE = "Can't reach megareviewer. Check that it's still running in your terminal.";

/** One typed function per route of the HTTP API contract. Every response is parsed. */
export const createApiClient = (options: ApiClientOptions) => {
  const send = async <Schema extends z.ZodType>(
    route: JsonRoute & { readonly response: Schema },
    params: Readonly<Record<string, string>>,
    body?: unknown,
  ): Promise<Result<z.output<Schema>, ApiError>> => {
    let response: Response;
    try {
      response = await options.fetch(routePath(route.path, params), {
        method: route.method,
        headers: {
          [TOKEN_HEADER]: options.token,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return err({ code: "unreachable", message: UNREACHABLE });
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized();
      const failure = ErrorResponse.safeParse(json);
      if (failure.success) return err(failure.data.error);
      // Not one of ours: the Vite proxy with no server behind it, or a stray process on the port.
      return err({
        code: response.status >= 500 ? "unreachable" : "internal",
        message: response.status >= 500 ? UNREACHABLE : VERSION_MISMATCH,
      });
    }
    const parsed = route.response.safeParse(json);
    return parsed.success ? ok(parsed.data) : err({ code: "internal", message: VERSION_MISMATCH });
  };

  return {
    getStatus: () => send(routes.getStatus, {}),
    listPullRequests: () => send(routes.listPullRequests, {}),
    startAnalysis: (body: StartAnalysisRequest) => send(routes.startAnalysis, {}, body),
    getAnalysis: (id: AnalysisId) => send(routes.getAnalysis, { id }),
    getFileContent: (id: AnalysisId, side: "base" | "head", path: string) =>
      send(routes.getFileContent, { id, side, path }),
    retryAnalysis: (id: AnalysisId) => send(routes.retryAnalysis, { id }),
    putVerdict: (id: AnalysisId, decisionId: DecisionId, body: PutVerdictRequest) =>
      send(routes.putVerdict, { id, decisionId }, body),
    previewPublication: (id: AnalysisId, body: PublicationPreviewRequest) =>
      send(routes.previewPublication, { id }, body),
    publish: (id: AnalysisId, body: PublishRequest) => send(routes.publish, { id }, body),
  } satisfies Record<RouteName, unknown>;
};

export type ApiClient = ReturnType<typeof createApiClient>;
