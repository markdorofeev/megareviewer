import {
  type AnalysisIdResponse,
  type AnalysisUpdatedEvent,
  type AnalysisView,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorResponse,
  type FileContentResponse,
  type RouteName,
  routes,
  TOKEN_HEADER,
  TOKEN_QUERY_PARAM,
} from "../../contracts/index.ts";
import type { FileChange } from "../../src/domain/diff/index.ts";
import {
  type Analysis,
  buildPublication,
  composeBody,
  MODEL_STAGES,
  type PointId,
  type PointReview,
  type PublicationReceipt,
  parsePullRequestUrl,
  pointsOf,
  type ReviewThread,
  StageName,
} from "../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixturePullRequests,
  fixtureStatus,
  fixtureThreads,
  largeAnalysisView,
} from "./fixtures/index.ts";
import { analysisFailed, analysisInProgress } from "./progress.ts";
import { afterModelRun, type Scenario, withoutModel } from "./scenarios.ts";

/** The session token the mock accepts; open the UI with `?token=mock`. */
export const MOCK_TOKEN = "mock";

/** How long each simulated stage takes. */
export const MOCK_STAGE_MS = 600;

/** Starting an analysis for a PR with this number fails it at the prep stage; a retry succeeds. */
export const MOCK_FAILING_PR_NUMBER = 500;

/** Starting an analysis for a PR with this number analyzes a PR with 240 hunks. */
export const MOCK_LARGE_PR_NUMBER = 900;

const FAILING_STAGE: StageName = "prep";
const FAILURE_MESSAGE = "megareviewer hit an internal error during the analysis";

export interface MockRequest {
  readonly method: string;
  /** Without the query string. */
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The parsed JSON body; undefined when there is none. */
  readonly body: unknown;
}

export interface MockResponse {
  readonly status: number;
  readonly body: unknown;
}

export type MockEvent =
  | { readonly event: "updated"; readonly data: AnalysisUpdatedEvent }
  | { readonly event: "done"; readonly data: Record<string, never> };

export interface MockApi {
  handle(request: MockRequest): MockResponse;
  /**
   * Opens an analysis's event stream, as the server does: an error response, or a subscription
   * that gets `done` straight away when the analysis isn't running.
   */
  events(
    request: MockRequest,
    listener: (event: MockEvent) => void,
  ): MockResponse | { readonly unsubscribe: () => void };
  close(): void;
}

const failure = (code: ErrorCode, message: string): MockResponse => {
  const body: ErrorResponse = { error: { code, message } };
  return { status: ERROR_STATUS[code], body };
};

const success = (body: unknown): MockResponse => ({ status: 200, body });

/** Lines the fixtures don't have past a file's last change. */
const MOCK_TAIL_LINES = 30;

/**
 * A file the fixtures only have the diff of: the diff's lines where it has them, and made-up
 * unchanged lines around them.
 */
const mockContent = (file: FileChange, side: "base" | "head"): string => {
  const known = new Map<number, string>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const at = side === "head" ? line.newLine : line.oldLine;
      if (at !== null && (side === "head" ? line.kind !== "del" : line.kind !== "add")) {
        known.set(at, line.text);
      }
    }
  }
  const last = Math.max(0, ...known.keys()) + MOCK_TAIL_LINES;
  return Array.from(
    { length: last },
    (_, index) => known.get(index + 1) ?? `// unchanged line ${index + 1}`,
  ).join("\n");
};

const patternOf = (path: string): RegExp =>
  new RegExp(`^${path.replace(/:([A-Za-z]+)/g, "(?<$1>[^/]+)")}$`);

const ROUTES = Object.keys(routes)
  .filter((name): name is RouteName => name in routes)
  .map((name) => ({
    name,
    method: routes[name].method,
    pattern: patternOf(routes[name].path),
  }));

const EVENTS_PATTERN = patternOf("/api/analyses/:id/events");

const decode = (groups: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(groups).map(([name, value]) => [name, decodeURIComponent(value)]),
  );

const issuesOf = (
  where: string,
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) => issues.map((issue) => `${[where, ...issue.path.map(String)].join(".")}: ${issue.message}`);

/**
 * Every contract route in memory, backed by the fixtures. Starting an analysis replays the
 * fixture's stages one by one, so loading states can be built against it.
 */
export const createMockApi = (
  options: {
    readonly stageMs?: number;
    readonly now?: () => string;
    /** Plays Claude's run as this scenario, starting from the code's review alone. */
    readonly scenario?: Scenario;
  } = {},
): MockApi => {
  const stageMs = options.stageMs ?? MOCK_STAGE_MS;
  const scenario = options.scenario;
  const now = options.now ?? (() => new Date().toISOString());
  /** In a scenario the analysis starts as the code's review alone, before anyone asked Claude. */
  const asked = (analysis: Analysis): Analysis =>
    scenario === undefined ? analysis : withoutModel(analysis);
  let fixtureView = fixtureAnalysisView;
  let fixture = asked(fixtureView.analysis);
  /** The model's stages, stepped through when the reviewer asks Claude in a scenario. */
  let modelStagesDone: number | null = null;

  let stagesDone = StageName.options.length;
  let failAt: StageName | null = null;
  let failed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const pointReviews = new Map<PointId, PointReview>();
  let publication: PublicationReceipt | null = null;
  let threads: ReviewThread[] = structuredClone([...fixtureThreads.threads]);
  let replies = 0;
  const listeners = new Set<(event: MockEvent) => void>();

  const analysis = () => {
    if (failed && failAt !== null) return analysisFailed(fixture, failAt, FAILURE_MESSAGE);
    if (scenario === undefined || modelStagesDone === null) {
      return analysisInProgress(fixture, stagesDone);
    }
    // Claude's run: each pass's results appear as its stage finishes, then the scenario's end.
    const ended = afterModelRun(fixtureView.analysis, scenario);
    return modelStagesDone >= MODEL_STAGES.length
      ? ended
      : analysisInProgress(ended, StageName.options.length - MODEL_STAGES.length + modelStagesDone);
  };
  const view = (): AnalysisView => ({
    ...fixtureView,
    analysis: analysis(),
    pointReviews: [...pointReviews.values()],
    publication,
  });
  const emit = (event: MockEvent) => {
    for (const listener of listeners) listener(event);
  };

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    emit({ event: "done", data: {} });
  };

  const advance = () => {
    const finished = StageName.options[stagesDone];
    if (finished !== undefined && finished === failAt) {
      failed = true;
      emit({ event: "updated", data: { stage: finished, status: "failed" } });
      stop();
      return;
    }
    stagesDone += 1;
    if (finished !== undefined)
      emit({ event: "updated", data: { stage: finished, status: "done" } });
    const next = StageName.options[stagesDone];
    if (next !== undefined) {
      emit({ event: "updated", data: { stage: next, status: "running" } });
      return;
    }
    stop();
  };

  const simulate = (failing: StageName | null) => {
    if (timer !== null) return;
    stagesDone = 0;
    failAt = failing;
    failed = false;
    pointReviews.clear();
    publication = null;
    timer = setInterval(advance, stageMs);
  };

  const findAnalysis = (id: string | undefined): MockResponse | null =>
    id === fixture.id ? null : failure("not-found", `No analysis ${id}`);

  const requireComplete = (): MockResponse | null =>
    analysis().status === "complete"
      ? null
      : failure("analysis-not-complete", "The analysis isn't complete");

  const authorized = (request: MockRequest, allowQuery: boolean): boolean =>
    request.headers[TOKEN_HEADER] === MOCK_TOKEN ||
    (allowQuery && request.query.get(TOKEN_QUERY_PARAM) === MOCK_TOKEN);

  const unauthorized = failure("unauthorized", "Missing or wrong session token");

  const handlers: Record<
    RouteName,
    (params: Readonly<Record<string, string>>, body: unknown) => MockResponse
  > = {
    getStatus: () => success(fixtureStatus),
    listPullRequests: () => success(fixturePullRequests),
    startAnalysis: (_, body) => {
      const request = routes.startAnalysis.request.safeParse(body);
      if (!request.success) {
        return failure("bad-request", issuesOf("body", request.error.issues).join("; "));
      }
      const ref = parsePullRequestUrl(request.data.url);
      if (!ref.ok)
        return failure("unsupported-url", "Not a GitHub or Bitbucket Cloud pull request URL");
      const host = ref.value.repo.host;
      if (!fixtureStatus.hosts[host].configured) {
        const name = host === "github" ? "GitHub" : "Bitbucket";
        return failure("host-not-configured", `${name} isn't configured`);
      }
      if (timer === null) {
        fixtureView =
          ref.value.number === MOCK_LARGE_PR_NUMBER ? largeAnalysisView : fixtureAnalysisView;
        fixture = asked(fixtureView.analysis);
      }
      simulate(ref.value.number === MOCK_FAILING_PR_NUMBER ? FAILING_STAGE : null);
      const response: AnalysisIdResponse = { analysisId: fixture.id };
      return success(response);
    },
    getAnalysis: ({ id }) => findAnalysis(id) ?? success(view()),
    getFileContent: ({ id, side, path }) => {
      const missing = findAnalysis(id);
      if (missing !== null) return missing;
      const file = fixture.files.find((one) => one.path === path);
      if (file === undefined || (side !== "base" && side !== "head")) {
        return failure("not-found", `No changed ${side} file ${path} in analysis ${id}`);
      }
      const response: FileContentResponse = { content: mockContent(file, side) };
      return success(response);
    },
    retryAnalysis: ({ id }) => {
      const missing = findAnalysis(id);
      if (missing !== null) return missing;
      if (!failed) return failure("bad-request", "Only a failed analysis can be retried");
      simulate(null);
      const response: AnalysisIdResponse = { analysisId: fixture.id };
      return success(response);
    },
    runModel: ({ id }) => {
      const missing = findAnalysis(id);
      if (missing !== null) return missing;
      if (scenario === undefined) {
        return failure("model-unavailable", "the mock API doesn't run Claude");
      }
      if (modelStagesDone === null && timer === null) {
        modelStagesDone = 0;
        timer = setInterval(
          () => {
            modelStagesDone = (modelStagesDone ?? 0) + 1;
            const stage = MODEL_STAGES[Math.min(modelStagesDone, MODEL_STAGES.length - 1)];
            if (modelStagesDone >= MODEL_STAGES.length) {
              stop();
              return;
            }
            if (stage !== undefined) emit({ event: "updated", data: { stage, status: "running" } });
          },
          scenario === "slow" ? stageMs * 3 : stageMs,
        );
      }
      const response: AnalysisIdResponse = { analysisId: fixture.id };
      return success(response);
    },
    putPointState: (params, body) => {
      const missing = findAnalysis(params.id) ?? requireComplete();
      if (missing !== null) return missing;
      const parsedParams = routes.putPointState.params.safeParse(params);
      const request = routes.putPointState.request.safeParse(body);
      if (!parsedParams.success || !request.success) {
        const problems = [
          ...(parsedParams.success ? [] : issuesOf("params", parsedParams.error.issues)),
          ...(request.success ? [] : issuesOf("body", request.error.issues)),
        ];
        return failure("bad-request", problems.join("; "));
      }
      const { pointId } = parsedParams.data;
      if (!pointsOf(fixture).some((point) => point.id === pointId)) {
        return failure("not-found", `No point ${pointId} in analysis ${params.id}`);
      }
      const saved: PointReview = { pointId, ...request.data, updatedAt: now() };
      pointReviews.set(pointId, saved);
      return success(saved);
    },
    previewPublication: ({ id }, body) => {
      const missing = findAnalysis(id) ?? requireComplete();
      if (missing !== null) return missing;
      const request = routes.previewPublication.request.safeParse(body);
      if (!request.success) {
        return failure("bad-request", issuesOf("body", request.error.issues).join("; "));
      }
      return success(
        buildPublication({
          analysis: fixture,
          summary: request.data.summary,
          isAuthor: fixtureView.isAuthor,
          hunkComments: request.data.hunkComments ?? [],
          verdict: request.data.verdict ?? null,
        }),
      );
    },
    publish: ({ id }, body) => {
      const missing = findAnalysis(id) ?? requireComplete();
      if (missing !== null) return missing;
      const request = routes.publish.request.safeParse(body);
      if (!request.success) {
        return failure("bad-request", issuesOf("body", request.error.issues).join("; "));
      }
      if (publication === null) {
        const published = buildPublication({
          analysis: fixture,
          summary: request.data.summary,
          isAuthor: fixtureView.isAuthor,
          hunkComments: request.data.hunkComments ?? [],
          verdict: request.data.verdict ?? null,
        });
        const keys = ["summary", ...published.comments.map((comment) => comment.key)];
        publication = {
          url: `${fixture.pullRequest?.url ?? "https://github.com"}#pullrequestreview-1`,
          publishedAt: now(),
          postedCommentIds: Object.fromEntries(keys.map((key, index) => [key, `${1000 + index}`])),
        };
      }
      return success(publication);
    },
    getThreads: ({ id }) => findAnalysis(id) ?? success({ threads }),
    replyToThread: (params, body) => {
      const missing = findAnalysis(params.id);
      if (missing !== null) return missing;
      const request = routes.replyToThread.request.safeParse(body);
      if (!request.success) {
        return failure("bad-request", issuesOf("body", request.error.issues).join("; "));
      }
      const thread = threads.find((one) => one.id === params.threadId);
      if (thread === undefined) return failure("not-found", `No thread ${params.threadId}`);
      replies += 1;
      const comment = {
        id: `PRRC_mock${replies}`,
        author: fixtureStatus.hosts.github.user ?? { id: "you", name: "You" },
        body: request.data.body,
        createdAt: now(),
        originalCommit: fixture.key.headSha,
      };
      threads = threads.map((one) =>
        one === thread ? { ...one, comments: [...one.comments, comment] } : one,
      );
      return success(comment);
    },
    resolveThread: (params, body) => {
      const missing = findAnalysis(params.id);
      if (missing !== null) return missing;
      const request = routes.resolveThread.request.safeParse(body);
      if (!request.success) {
        return failure("bad-request", issuesOf("body", request.error.issues).join("; "));
      }
      const { resolved } = request.data;
      threads = threads.map((one) =>
        one.id === params.threadId
          ? { ...one, resolved, resolvedBy: resolved ? fixtureStatus.hosts.github.user : null }
          : one,
      );
      return success({ resolved });
    },
    postComment: ({ id }, body) => {
      const missing = findAnalysis(id) ?? requireComplete();
      if (missing !== null) return missing;
      const request = routes.postComment.request.safeParse(body);
      if (!request.success) {
        return failure("bad-request", issuesOf("body", request.error.issues).join("; "));
      }
      const comment = request.data;
      const hunk = fixture.files
        .flatMap((file) => file.hunks)
        .find((one) => one.id === comment.hunkId);
      if (hunk === undefined) return failure("bad-request", `No hunk ${comment.hunkId}`);
      replies += 1;
      threads = [
        ...threads,
        {
          id: `PRRT_mock${replies}`,
          path: hunk.path,
          side: comment.side,
          line: comment.line,
          startLine: comment.startLine ?? null,
          originalLine: comment.line,
          resolved: false,
          resolvedBy: null,
          outdated: false,
          can: { reply: true, resolve: true },
          comments: [
            {
              id: `PRRC_mock${replies}`,
              author: fixtureStatus.hosts.github.user ?? { id: "you", name: "You" },
              body: composeBody(comment),
              createdAt: now(),
              originalCommit: fixture.key.headSha,
            },
          ],
        },
      ];
      return success({});
    },
  };

  return {
    handle(request) {
      if (!authorized(request, false)) return unauthorized;
      for (const route of ROUTES) {
        const match = route.pattern.exec(request.path);
        if (match === null || route.method !== request.method) continue;
        return handlers[route.name](decode(match.groups ?? {}), request.body);
      }
      return failure("not-found", `No route ${request.method} ${request.path}`);
    },

    events(request, listener) {
      if (!authorized(request, true)) return unauthorized;
      const id = EVENTS_PATTERN.exec(request.path)?.groups?.id;
      const missing = findAnalysis(id === undefined ? undefined : decodeURIComponent(id));
      if (missing !== null) return missing;
      // Claude's run leaves the analysis complete, so the timer says whether anything is left.
      if (analysis().status !== "running" && timer === null) {
        listener({ event: "done", data: {} });
        return { unsubscribe: () => {} };
      }
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },

    close() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      listeners.clear();
    },
  };
};

export const isEventsRequest = (method: string, path: string): boolean =>
  method === "GET" && EVENTS_PATTERN.test(path);
