import { z } from "zod";
import {
  Analysis,
  AnalysisId,
  DecisionId,
  DecisionVerdict,
  HostKind,
  HostUser,
  HunkComment,
  Publication,
  PublicationReceipt,
  PublicationVerdict,
  PullRequestSummary,
  StageName,
  StageStatus,
  Verdict,
} from "../src/domain/review/index.ts";

/** Every /api request carries the session token in this header. */
export const TOKEN_HEADER = "x-megareviewer-token";
/** The events endpoint takes the token in this query parameter: EventSource can't set headers. */
export const TOKEN_QUERY_PARAM = "token";

// Requests and responses

export const HostStatus = z
  .object({
    configured: z.boolean(),
    user: HostUser.nullable(),
    error: z.string().nullable(),
  })
  .readonly();
export type HostStatus = z.infer<typeof HostStatus>;

export const StatusResponse = z
  .object({
    version: z.string(),
    hosts: z.object({ github: HostStatus, bitbucket: HostStatus }).readonly(),
    jira: z.object({ configured: z.boolean() }).readonly(),
    model: z.object({ enabled: z.boolean() }).readonly(),
  })
  .readonly();
export type StatusResponse = z.infer<typeof StatusResponse>;

export const PullRequestListResponse = z
  .object({
    items: z.array(PullRequestSummary).readonly(),
    /** Hosts that failed to list; the others' PRs are still in items. */
    errors: z.array(z.object({ host: HostKind, message: z.string() }).readonly()).readonly(),
  })
  .readonly();
export type PullRequestListResponse = z.infer<typeof PullRequestListResponse>;

export const StartAnalysisRequest = z.object({ url: z.string().min(1) }).readonly();
export type StartAnalysisRequest = z.infer<typeof StartAnalysisRequest>;

export const AnalysisIdResponse = z.object({ analysisId: AnalysisId }).readonly();
export type AnalysisIdResponse = z.infer<typeof AnalysisIdResponse>;

export const AnalysisView = z
  .object({
    analysis: Analysis,
    verdicts: z.array(DecisionVerdict).readonly(),
    publication: PublicationReceipt.nullable(),
    /** The current user opened the PR, so the review can only comment, not approve. */
    isAuthor: z.boolean(),
    /** The PR has new commits since this analysis. */
    stale: z.boolean(),
  })
  .readonly();
export type AnalysisView = z.infer<typeof AnalysisView>;

export const PutVerdictRequest = z.object({ verdict: Verdict, comment: z.string() }).readonly();
export type PutVerdictRequest = z.infer<typeof PutVerdictRequest>;

/** Comments on hunk lines and the reviewer's own verdict; without them, the decisions decide. */
const ReviewFields = {
  hunkComments: z.array(HunkComment).readonly().optional(),
  verdict: PublicationVerdict.nullable().optional(),
};

export const PublicationPreviewRequest = z
  .object({ summary: z.string(), ...ReviewFields })
  .readonly();
export type PublicationPreviewRequest = z.infer<typeof PublicationPreviewRequest>;

export const PublishRequest = z
  .object({
    summary: z.string(),
    /** Publish even though the PR has new commits since the analysis. */
    allowStale: z.boolean(),
    ...ReviewFields,
  })
  .readonly();
export type PublishRequest = z.infer<typeof PublishRequest>;

// Server-sent events. The client refetches the analysis view on each one.

export const AnalysisUpdatedEvent = z.object({ stage: StageName, status: StageStatus }).readonly();
export type AnalysisUpdatedEvent = z.infer<typeof AnalysisUpdatedEvent>;

/** Sent once the analysis is complete or failed. */
export const AnalysisDoneEvent = z.object({}).readonly();
export type AnalysisDoneEvent = z.infer<typeof AnalysisDoneEvent>;

// Errors

export const ErrorCode = z.enum([
  "bad-request",
  "unsupported-url",
  "host-not-configured",
  "unauthorized",
  "not-found",
  "stale-analysis",
  "analysis-not-complete",
  "host-error",
  "model-error",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_STATUS = {
  "bad-request": 400,
  "unsupported-url": 400,
  "host-not-configured": 400,
  unauthorized: 401,
  "not-found": 404,
  "stale-analysis": 409,
  "analysis-not-complete": 409,
  "host-error": 502,
  "model-error": 502,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

/** The body of every non-2xx response. */
export const ErrorResponse = z
  .object({ error: z.object({ code: ErrorCode, message: z.string() }).readonly() })
  .readonly();
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// Routes

const AnalysisParams = z.object({ id: AnalysisId }).readonly();
const VerdictParams = z.object({ id: AnalysisId, decisionId: DecisionId }).readonly();
const NoParams = z.object({}).readonly();

export interface JsonRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly params: z.ZodType<Readonly<Record<string, string>>>;
  /** null for routes without a body. */
  readonly request: z.ZodType | null;
  readonly response: z.ZodType;
}

/** Every JSON route, shared by the server and the web client. */
export const routes = {
  getStatus: {
    method: "GET",
    path: "/api/status",
    params: NoParams,
    request: null,
    response: StatusResponse,
  },
  listPullRequests: {
    method: "GET",
    path: "/api/pull-requests",
    params: NoParams,
    request: null,
    response: PullRequestListResponse,
  },
  /** Starts an analysis, or returns the existing one for the same PR, head SHA and pipeline. */
  startAnalysis: {
    method: "POST",
    path: "/api/analyses",
    params: NoParams,
    request: StartAnalysisRequest,
    response: AnalysisIdResponse,
  },
  getAnalysis: {
    method: "GET",
    path: "/api/analyses/:id",
    params: AnalysisParams,
    request: null,
    response: AnalysisView,
  },
  /** Re-runs a failed analysis; a new head SHA gives a new analysis ID. */
  retryAnalysis: {
    method: "POST",
    path: "/api/analyses/:id/retry",
    params: AnalysisParams,
    request: null,
    response: AnalysisIdResponse,
  },
  putVerdict: {
    method: "PUT",
    path: "/api/analyses/:id/verdicts/:decisionId",
    params: VerdictParams,
    request: PutVerdictRequest,
    response: DecisionVerdict,
  },
  /** Exactly what publishing would post. */
  previewPublication: {
    method: "POST",
    path: "/api/analyses/:id/publication/preview",
    params: AnalysisParams,
    request: PublicationPreviewRequest,
    response: Publication,
  },
  publish: {
    method: "POST",
    path: "/api/analyses/:id/publication",
    params: AnalysisParams,
    request: PublishRequest,
    response: PublicationReceipt,
  },
} as const satisfies Record<string, JsonRoute>;

export type RouteName = keyof typeof routes;

/** The server-sent events stream of one analysis. */
export const analysisEventsRoute = {
  method: "GET",
  path: "/api/analyses/:id/events",
  params: AnalysisParams,
  events: { updated: AnalysisUpdatedEvent, done: AnalysisDoneEvent },
} as const;

/** Fills a route path's `:name` segments with URL-encoded params. */
export const routePath = (path: string, params: Readonly<Record<string, string>>): string =>
  path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path param ${name} for ${path}`);
    return encodeURIComponent(value);
  });
