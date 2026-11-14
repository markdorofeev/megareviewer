import type { Context, Hono } from "hono";
import type { z } from "zod";
import {
  ERROR_STATUS,
  type ErrorCode,
  type ErrorResponse,
  type JsonRoute,
  type RouteName,
  routes,
} from "../../../contracts/index.ts";
import type {
  ErrorCode as AppErrorCode,
  UseCaseError,
  UseCases,
} from "../../application/use-cases/index.ts";
import type { HunkComment, PublicationVerdict } from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
/** The application repeats the contract's error codes; this stops compiling when they drift. */
export type ErrorCodesMatch = Assert<Same<AppErrorCode, ErrorCode>>;

/** The review fields of a preview or publish request, with what's left out filled in. */
const reviewInput = (body: {
  readonly hunkComments?: readonly HunkComment[] | undefined;
  readonly verdict?: PublicationVerdict | null | undefined;
}) => ({ hunkComments: body.hunkComments ?? [], verdict: body.verdict ?? null });

export const errorResponse = (c: Context, error: UseCaseError): Response => {
  const body: ErrorResponse = { error };
  return c.json(body, ERROR_STATUS[error.code]);
};

export const summarizeIssues = (where: string, error: z.ZodError): string =>
  error.issues
    .map((issue) => `${[where, ...issue.path.map(String)].join(".")}: ${issue.message}`)
    .join("; ");

interface RouteInput<R extends JsonRoute> {
  readonly params: z.output<R["params"]>;
  /** null for routes without a body. */
  readonly body: R["request"] extends z.ZodType ? z.output<R["request"]> : null;
}

/** Returning the contract's response type checks at compile time that use-case types fit it. */
type Handler<R extends JsonRoute> = (
  input: RouteInput<R>,
) => Promise<Result<z.output<R["response"]>, UseCaseError>>;

type Handlers = { readonly [N in RouteName]: Handler<(typeof routes)[N]> };

/** The body as JSON; undefined when there is none, which a route may take as "the default". */
const readJson = async (c: Context): Promise<Result<unknown, null>> => {
  try {
    const text = await c.req.text();
    return ok(text.trim() === "" ? undefined : JSON.parse(text));
  } catch {
    return { ok: false, error: null };
  }
};

/** Parses a request's params and body with the route's schemas. */
const parseRequest = async <R extends JsonRoute>(
  c: Context,
  route: R,
): Promise<Result<RouteInput<R>, string>> => {
  const params = route.params.safeParse(c.req.param());
  if (!params.success) return { ok: false, error: summarizeIssues("params", params.error) };
  if (route.request === null) {
    // Parsing: a route's request schema is null exactly when its input's body is.
    return ok({ params: params.data, body: null } as RouteInput<R>);
  }
  const json = await readJson(c);
  if (!json.ok) return { ok: false, error: "The body isn't valid JSON" };
  const body = route.request.safeParse(json.value);
  if (!body.success) return { ok: false, error: summarizeIssues("body", body.error) };
  return ok({ params: params.data, body: body.data } as RouteInput<R>);
};

const register = <R extends JsonRoute>(app: Hono, route: R, handle: Handler<R>): void => {
  app.on(route.method, route.path, async (c) => {
    const input = await parseRequest(c, route);
    if (!input.ok) return errorResponse(c, { code: "bad-request", message: input.error });
    const result = await handle(input.value);
    return result.ok ? c.json(result.value, 200) : errorResponse(c, result.error);
  });
};

/** Every JSON route of the contract, each calling its use case. */
export const registerApiRoutes = (app: Hono, useCases: UseCases): void => {
  const handlers: Handlers = {
    getStatus: async () => ok(await useCases.getStatus()),
    listPullRequests: async () => ok(await useCases.listPullRequests()),
    getReviewActivity: async () => ok(await useCases.getReviewActivity()),
    startAnalysis: ({ body }) => useCases.startAnalysis(body.url),
    getAnalysis: ({ params }) => useCases.getAnalysisView(params.id),
    getFileContent: ({ params }) => useCases.getFileContent(params.id, params.side, params.path),
    retryAnalysis: ({ params }) => useCases.retryAnalysis(params.id),
    runModel: ({ params, body }) => useCases.runModel(params.id, body?.optionId),
    removeModelRun: ({ params }) => useCases.removeModelRun(params.id),
    putPointState: ({ params, body }) =>
      useCases.recordPointState(params.id, params.pointId, body.state),
    previewPublication: ({ params, body }) =>
      useCases.previewPublication(params.id, body.summary, reviewInput(body)),
    publish: ({ params, body }) =>
      useCases.publishReview(params.id, body.summary, body.allowStale, reviewInput(body)),
    getThreads: ({ params }) => useCases.getThreads(params.id),
    getPullRequestStatus: ({ params }) => useCases.getPullRequestStatus(params.id),
    replyToThread: ({ params, body }) =>
      useCases.replyToThread(params.id, params.threadId, body.body),
    resolveThread: ({ params, body }) =>
      useCases.resolveThread(params.id, params.threadId, body.resolved),
    postComment: async ({ params, body }) => {
      const posted = await useCases.postComment(params.id, body);
      return posted.ok ? ok({}) : posted;
    },
  };
  register(app, routes.getStatus, handlers.getStatus);
  register(app, routes.listPullRequests, handlers.listPullRequests);
  register(app, routes.getReviewActivity, handlers.getReviewActivity);
  register(app, routes.startAnalysis, handlers.startAnalysis);
  register(app, routes.getAnalysis, handlers.getAnalysis);
  register(app, routes.getFileContent, handlers.getFileContent);
  register(app, routes.retryAnalysis, handlers.retryAnalysis);
  register(app, routes.runModel, handlers.runModel);
  register(app, routes.removeModelRun, handlers.removeModelRun);
  register(app, routes.putPointState, handlers.putPointState);
  register(app, routes.previewPublication, handlers.previewPublication);
  register(app, routes.publish, handlers.publish);
  register(app, routes.getThreads, handlers.getThreads);
  register(app, routes.getPullRequestStatus, handlers.getPullRequestStatus);
  register(app, routes.replyToThread, handlers.replyToThread);
  register(app, routes.resolveThread, handlers.resolveThread);
  register(app, routes.postComment, handlers.postComment);
};
