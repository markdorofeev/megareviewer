import { z } from "zod";
import {
  Analysis,
  AnalysisId,
  GuidelineFile,
  GuidelinePath,
  HostKind,
  HostUser,
  HunkComment,
  ModelOptionId,
  ModelOptions,
  PointId,
  PointReview,
  PointState,
  Preference,
  PreferenceId,
  PreferenceKind,
  PreferenceProposal,
  PreferenceScope,
  PreferenceText,
  ProposalId,
  Publication,
  PublicationId,
  PublicationReceipt,
  PublicationVerdict,
  PullRequestStatus,
  PullRequestSummary,
  RepoRef,
  ReviewActivity,
  StageName,
  StageStatus,
  ThreadComment,
  ThreadId,
  ThreadList,
} from "../src/domain/review/index.ts";

/** Every /api request carries the session token in this header. */
export const TOKEN_HEADER = "x-megareviewer-token";
/** The events endpoint takes the token in this query parameter: EventSource can't set headers. */
export const TOKEN_QUERY_PARAM = "token";

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
    /**
     * The models "Request AI review" can run on, enabled or not: each one's `via` says what runs
     * it and who pays ("Claude Code, on your Pro plan"), `reason` why it can't.
     */
    model: ModelOptions,
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

/** The option to run the passes on; the server's default without one, or without a body. */
export const RunModelRequest = z
  .object({ optionId: ModelOptionId.optional() })
  .readonly()
  .optional();
export type RunModelRequest = z.infer<typeof RunModelRequest>;

export const AnalysisIdResponse = z.object({ analysisId: AnalysisId }).readonly();
export type AnalysisIdResponse = z.infer<typeof AnalysisIdResponse>;

export const AnalysisView = z
  .object({
    analysis: Analysis,
    pointReviews: z.array(PointReview).readonly(),
    publication: PublicationReceipt.nullable(),
    /** The current user opened the PR, so the review can only comment, not approve. */
    isAuthor: z.boolean(),
    /** The current user's ID on the host, as its reviewers are named; null when unknown. */
    currentUserId: z.string().nullable(),
    /** The PR has new commits since this analysis. */
    stale: z.boolean(),
  })
  .readonly();
export type AnalysisView = z.infer<typeof AnalysisView>;

/** An analysis without its model run: what the code made, and no states of points left. */
export const RemovedModelRun = z
  .object({ analysis: Analysis, pointReviews: z.array(PointReview).readonly() })
  .readonly();
export type RemovedModelRun = z.infer<typeof RemovedModelRun>;

export const PutPointStateRequest = z.object({ state: PointState }).readonly();
export type PutPointStateRequest = z.infer<typeof PutPointStateRequest>;

/** Comments on hunk lines, raised points among them, and the verdict; a comment without one. */
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
    /** Chosen when the reviewer opens the dialog; a retry sends the same, a new review a new one. */
    publicationId: PublicationId,
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

/** A changed file at the PR's base or head commit; null when it isn't there. */
export const FileContentResponse = z.object({ content: z.string().nullable() }).readonly();
export type FileContentResponse = z.infer<typeof FileContentResponse>;

/** The PR's review threads, read live from the host. */
export const ThreadsResponse = ThreadList;
export type ThreadsResponse = z.infer<typeof ThreadsResponse>;

export const ReplyRequest = z.object({ body: z.string().trim().min(1) }).readonly();
export type ReplyRequest = z.infer<typeof ReplyRequest>;

/** What posting one comment on its own answers: nothing; the threads are read again. */
export const CommentPosted = z.object({}).readonly();
export type CommentPosted = z.infer<typeof CommentPosted>;

export const ApprovalRevoked = z.object({}).readonly();
export type ApprovalRevoked = z.infer<typeof ApprovalRevoked>;

export const ResolveRequest = z.object({ resolved: z.boolean() }).readonly();
export type ResolveRequest = z.infer<typeof ResolveRequest>;
export const ResolveResponse = ResolveRequest;
export type ResolveResponse = z.infer<typeof ResolveResponse>;

/** A repository the preferences page lists, with the guideline files it has. */
export const RepositoryPreferences = z
  .object({
    repo: RepoRef,
    /** Null when they couldn't be looked for, with why in `guidelineNote`. */
    guidelineFiles: z.array(GuidelineFile).readonly().nullable(),
    guidelineNote: z.string().nullable(),
  })
  .readonly();
export type RepositoryPreferences = z.infer<typeof RepositoryPreferences>;

export const PreferencesView = z
  .object({
    preferences: z.array(Preference).readonly(),
    /** The proposals the reviewer hasn't decided on. */
    proposals: z.array(PreferenceProposal).readonly(),
    /** The repositories analyzed lately, then the others that have a preference. */
    repositories: z.array(RepositoryPreferences).readonly(),
    /** Review signals recorded since preferences were last suggested from them. */
    signalsSinceSuggestion: z.number().int().nonnegative(),
  })
  .readonly();
export type PreferencesView = z.infer<typeof PreferencesView>;

export const AddPreferenceRequest = z
  .object({
    kind: PreferenceKind,
    text: PreferenceText,
    scope: PreferenceScope,
    /** learned: a rule saved from a point, with "Don't flag things like this". Else written. */
    source: z.enum(["written", "learned"]).optional(),
  })
  .readonly();
export type AddPreferenceRequest = z.infer<typeof AddPreferenceRequest>;

export const UpdatePreferenceRequest = z
  .object({
    kind: PreferenceKind.optional(),
    text: PreferenceText.optional(),
    scope: PreferenceScope.optional(),
    enabled: z.boolean().optional(),
  })
  .readonly();
export type UpdatePreferenceRequest = z.infer<typeof UpdatePreferenceRequest>;

export const PreferenceDeleted = z.object({}).readonly();
export type PreferenceDeleted = z.infer<typeof PreferenceDeleted>;

/** The option to make the call on; the server's default without one, or without a body. */
export const SuggestPreferencesRequest = RunModelRequest;
export type SuggestPreferencesRequest = z.infer<typeof SuggestPreferencesRequest>;

export const SuggestedPreferences = z
  .object({
    /** The proposals this call added: none when the model had nothing new to say. */
    proposals: z.array(PreferenceProposal).readonly(),
    /** How many review signals it read. */
    signals: z.number().int().nonnegative(),
  })
  .readonly();
export type SuggestedPreferences = z.infer<typeof SuggestedPreferences>;

export const ImportPreferencesRequest = z
  .object({ repo: RepoRef, optionId: ModelOptionId.optional() })
  .readonly();
export type ImportPreferencesRequest = z.infer<typeof ImportPreferencesRequest>;

export const ImportedPreferences = z
  .object({
    proposals: z.array(PreferenceProposal).readonly(),
    /** The reviewer's comments it read, from this many pull requests. */
    comments: z.number().int().nonnegative(),
    pullRequests: z.number().int().nonnegative(),
  })
  .readonly();
export type ImportedPreferences = z.infer<typeof ImportedPreferences>;

/** Accepting a proposal, with what the reviewer changed in it, or rejecting it. */
export const DecideProposalRequest = z
  .object({
    decision: z.enum(["accept", "reject"]),
    kind: PreferenceKind.optional(),
    text: PreferenceText.optional(),
    scope: PreferenceScope.optional(),
  })
  .readonly();
export type DecideProposalRequest = z.infer<typeof DecideProposalRequest>;

/** The preference an accepted proposal became; null for a rejected one. */
export const ProposalDecided = z.object({ preference: Preference.nullable() }).readonly();
export type ProposalDecided = z.infer<typeof ProposalDecided>;

export const GuidelineSwitchRequest = z
  .object({ repo: RepoRef, path: GuidelinePath, enabled: z.boolean() })
  .readonly();
export type GuidelineSwitchRequest = z.infer<typeof GuidelineSwitchRequest>;

export const GuidelineSwitched = z.object({}).readonly();
export type GuidelineSwitched = z.infer<typeof GuidelineSwitched>;

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
  "model-unavailable",
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
  "model-unavailable": 503,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

/** The body of every non-2xx response. */
export const ErrorResponse = z
  .object({ error: z.object({ code: ErrorCode, message: z.string() }).readonly() })
  .readonly();
export type ErrorResponse = z.infer<typeof ErrorResponse>;

const AnalysisParams = z.object({ id: AnalysisId }).readonly();
const PointParams = z.object({ id: AnalysisId, pointId: PointId }).readonly();
const FileParams = z
  .object({ id: AnalysisId, side: z.enum(["base", "head"]), path: z.string().min(1) })
  .readonly();
const ThreadParams = z.object({ id: AnalysisId, threadId: ThreadId }).readonly();
const PreferenceParams = z.object({ preferenceId: PreferenceId }).readonly();
const ProposalParams = z.object({ proposalId: ProposalId }).readonly();
const NoParams = z.object({}).readonly();

export interface JsonRoute {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
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
  /**
   * The reviews and comments posted from megareviewer on this machine in the last 27 weeks: the
   * page shows 26, and sorts them into its own local days.
   */
  getReviewActivity: {
    method: "GET",
    path: "/api/review-activity",
    params: NoParams,
    request: null,
    response: ReviewActivity,
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
  /** A changed file's content, to open the unchanged lines around its changes. */
  getFileContent: {
    method: "GET",
    path: "/api/analyses/:id/files/:side/:path",
    params: FileParams,
    request: null,
    response: FileContentResponse,
  },
  /** Re-runs a failed analysis; a new head SHA gives a new analysis ID. */
  retryAnalysis: {
    method: "POST",
    path: "/api/analyses/:id/retry",
    params: AnalysisParams,
    request: null,
    response: AnalysisIdResponse,
  },
  /**
   * Runs the model's passes on a complete analysis, on the chosen option or the default, adding
   * to it in place; its events follow the run. Answers model-unavailable, with why, when the
   * option can't run, and bad-request for an unknown option or passes that are running or done.
   */
  runModel: {
    method: "POST",
    path: "/api/analyses/:id/model",
    params: AnalysisParams,
    request: RunModelRequest,
    response: AnalysisIdResponse,
  },
  /**
   * Takes the model's run off a complete analysis, for trying the passes again: the model's points
   * and their states go, and what the code made is back. Answers with the analysis as it now is.
   */
  removeModelRun: {
    method: "DELETE",
    path: "/api/analyses/:id/model",
    params: AnalysisParams,
    request: null,
    response: RemovedModelRun,
  },
  /** Raises, dismisses or reopens one of the model's points. */
  putPointState: {
    method: "PUT",
    path: "/api/analyses/:id/points/:pointId",
    params: PointParams,
    request: PutPointStateRequest,
    response: PointReview,
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
  /**
   * Takes back the reviewer's approval of the PR on its host, at once; never retried. Nothing to
   * take back answers the same.
   */
  revokeApproval: {
    method: "DELETE",
    path: "/api/analyses/:id/approval",
    params: AnalysisParams,
    request: null,
    response: ApprovalRevoked,
  },
  /** The PR's review threads, live from the host: not part of the analysis. */
  getThreads: {
    method: "GET",
    path: "/api/analyses/:id/threads",
    params: AnalysisParams,
    request: null,
    response: ThreadsResponse,
  },
  /**
   * Where the PR stands on its host: its state and reviewers now, and the checks on the
   * analysis's head commit. Live, like threads: not part of the analysis.
   */
  getPullRequestStatus: {
    method: "GET",
    path: "/api/analyses/:id/pull-request-status",
    params: AnalysisParams,
    request: null,
    response: PullRequestStatus,
  },
  /** Posts a reply at once; never retried. */
  replyToThread: {
    method: "POST",
    path: "/api/analyses/:id/threads/:threadId/replies",
    params: ThreadParams,
    request: ReplyRequest,
    response: ThreadComment,
  },
  /**
   * Posts one comment on lines of the diff at once, as a thread of its own rather than with the
   * review; never retried. Answers stale-analysis when the PR has new commits since, as
   * publishing does.
   */
  postComment: {
    method: "POST",
    path: "/api/analyses/:id/comments",
    params: AnalysisParams,
    request: HunkComment,
    response: CommentPosted,
  },
  /** Resolves or reopens a thread at once; never retried. */
  resolveThread: {
    method: "PUT",
    path: "/api/analyses/:id/threads/:threadId/resolved",
    params: ThreadParams,
    request: ResolveRequest,
    response: ResolveResponse,
  },
  /**
   * What the reviewer wants an AI review to look for and leave out: their preferences, the
   * proposals waiting for them, and each repository's guideline files.
   */
  getPreferences: {
    method: "GET",
    path: "/api/preferences",
    params: NoParams,
    request: null,
    response: PreferencesView,
  },
  /** Adds a preference, enabled. Answers bad-request when its scope already has 50 enabled. */
  addPreference: {
    method: "POST",
    path: "/api/preferences",
    params: NoParams,
    request: AddPreferenceRequest,
    response: Preference,
  },
  /**
   * Proposes preferences from the review signals recorded here, in one model call on the chosen
   * option or the default: the response is its result, with no events. Answers bad-request when
   * no signal is recorded, and model-unavailable, with why, when the option can't run.
   */
  suggestPreferences: {
    method: "POST",
    path: "/api/preferences/suggestions",
    params: NoParams,
    request: SuggestPreferencesRequest,
    response: SuggestedPreferences,
  },
  /**
   * Proposes preferences for a repository from the reviewer's own comments on its recent pull
   * requests, read from its host, in one model call. No comments is no proposals.
   */
  importPreferences: {
    method: "POST",
    path: "/api/preferences/imports",
    params: NoParams,
    request: ImportPreferencesRequest,
    response: ImportedPreferences,
  },
  /** Switches a repository's guideline file on or off for the model runs on its pull requests. */
  setGuidelineSwitch: {
    method: "PUT",
    path: "/api/preferences/guidelines",
    params: NoParams,
    request: GuidelineSwitchRequest,
    response: GuidelineSwitched,
  },
  /** Accepts a pending proposal, which makes it a preference, or rejects it. */
  decideProposal: {
    method: "PUT",
    path: "/api/preferences/proposals/:proposalId",
    params: ProposalParams,
    request: DecideProposalRequest,
    response: ProposalDecided,
  },
  /** Changes a preference's kind, text, scope or switch. */
  updatePreference: {
    method: "PUT",
    path: "/api/preferences/:preferenceId",
    params: PreferenceParams,
    request: UpdatePreferenceRequest,
    response: Preference,
  },
  deletePreference: {
    method: "DELETE",
    path: "/api/preferences/:preferenceId",
    params: PreferenceParams,
    request: null,
    response: PreferenceDeleted,
  },
} as const satisfies Record<string, JsonRoute>;

export type RouteName = keyof typeof routes;

export const analysisEventsRoute = {
  method: "GET",
  path: "/api/analyses/:id/events",
  params: AnalysisParams,
  events: { updated: AnalysisUpdatedEvent, done: AnalysisDoneEvent },
} as const;

/**
 * An image or video pasted into the PR's comments, served by the local server from the host's
 * own attachment store. The answer is the file, not JSON. `<img>` and `<video>` can't set headers,
 * so this route, like the events one, takes the token in the query.
 */
export const attachmentRoute = {
  method: "GET",
  path: "/api/analyses/:id/attachment",
  params: AnalysisParams,
  query: z.object({ url: z.url({ protocol: /^https$/ }) }).readonly(),
} as const;

/** Fills a route path's `:name` segments with URL-encoded params. */
export const routePath = (path: string, params: Readonly<Record<string, string>>): string =>
  path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path param ${name} for ${path}`);
    return encodeURIComponent(value);
  });
