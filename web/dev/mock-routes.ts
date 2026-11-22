import {
  type AnalysisIdResponse,
  type AnalysisUpdatedEvent,
  type AnalysisView,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorResponse,
  type FileContentResponse,
  type PreferencesView,
  type RemovedModelRun,
  type RouteName,
  routes,
  TOKEN_HEADER,
  TOKEN_QUERY_PARAM,
} from "../../contracts/index.ts";
import type { FileChange } from "../../src/domain/diff/index.ts";
import {
  type Analysis,
  buildPublication,
  canEnable,
  composeBody,
  hasModelRun,
  isEmptyPublication,
  MAX_ENABLED_PREFERENCES,
  MAX_PREFERENCE_TEXT,
  MODEL_STAGES,
  type PointId,
  type PointReview,
  type Preference,
  type PreferenceProposal,
  type PublicationReceipt,
  parsePullRequestUrl,
  pointsOf,
  preferenceId,
  type ReviewerVerdict,
  type ReviewThread,
  StageName,
  sameRepo,
  sameRule,
} from "../../src/domain/review/index.ts";
import {
  activeReviewerActivity,
  deepAppAnalysisView,
  fixtureAnalysisView,
  fixtureImport,
  fixturePreferencesView,
  fixturePullRequestStatus,
  fixturePullRequests,
  fixtureStatus,
  fixtureSteps,
  fixtureSuggestions,
  fixtureThreads,
  guidedAnalysisView,
  javaServiceAnalysisView,
  largeAnalysisView,
  monorepoAnalysisView,
} from "./fixtures/index.ts";
import { analysisFailed, analysisInProgress, CODE_STAGE_COUNT } from "./progress.ts";
import { afterModelRun, type Scenario, withoutModel } from "./scenarios.ts";

/** The session token the mock accepts; open the UI with `?token=mock`. */
export const MOCK_TOKEN = "mock";

/** How long each simulated stage takes. */
export const MOCK_STAGE_MS = 600;

/** Starting an analysis for a PR with this number fails it at the prep stage; a retry succeeds. */
export const MOCK_FAILING_PR_NUMBER = 500;

/** Starting an analysis for a PR with this number analyzes a PR with 240 hunks. */
export const MOCK_LARGE_PR_NUMBER = 900;

/** Starting an analysis for a PR with this number analyzes one whose run read preferences. */
export const MOCK_GUIDED_PR_NUMBER = 904;

/**
 * PRs whose files sit in many directories: a Java service, a monorepo and a deep web app. Then the
 * fixture PR after a run that read the reviewer's preferences and a guideline file.
 */
const SYNTHETIC_VIEWS: ReadonlyMap<number, AnalysisView> = new Map([
  [MOCK_LARGE_PR_NUMBER, largeAnalysisView],
  [901, javaServiceAnalysisView],
  [902, monorepoAnalysisView],
  [903, deepAppAnalysisView],
  [MOCK_GUIDED_PR_NUMBER, guidedAnalysisView],
]);

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

/** The code's stages, which run when a PR is opened; Claude's come after them, when asked. */
const CODE_STAGES = CODE_STAGE_COUNT;

/**
 * Every contract route in memory, backed by the fixtures. Starting an analysis replays the
 * code's stages one by one, so loading states can be built against it.
 */
export const createMockApi = (
  options: {
    readonly stageMs?: number;
    readonly now?: () => string;
    /** Plays Claude's run as this scenario, starting from the code's review alone. */
    readonly scenario?: Scenario;
    /** The preferences it starts with; the fixture's without. */
    readonly preferences?: PreferencesView;
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
  /** The run asked for the tour, which the fixture's steps answer once it ends. */
  let tourAsked = false;

  let stagesDone = CODE_STAGES;
  let failAt: StageName | null = null;
  let failed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const pointReviews = new Map<PointId, PointReview>();
  /** The reviews published, by the ID the page chose; the view shows the latest. */
  const publications = new Map<string, PublicationReceipt>();
  let publication: PublicationReceipt | null = null;
  /** The reviewer's verdict on the host, from what they published and revoked here. */
  let yourVerdict: ReviewerVerdict | null = null;
  let threads: ReviewThread[] = structuredClone([...fixtureThreads.threads]);
  let replies = 0;
  let preferences = options.preferences ?? fixturePreferencesView;
  const rejected: PreferenceProposal[] = [];
  /** The points dismissed or raised here, which a suggestion reads as signals. */
  let signals = 0;
  const listeners = new Set<(event: MockEvent) => void>();

  const analysis = () => {
    if (failed && failAt !== null) return analysisFailed(fixture, failAt, FAILURE_MESSAGE);
    if (scenario === undefined || modelStagesDone === null) {
      return stagesDone >= CODE_STAGES ? fixture : analysisInProgress(fixture, stagesDone);
    }
    // Claude's run: each pass's results appear as its stage finishes, then the scenario's end.
    const ended = afterModelRun(fixtureView.analysis, scenario);
    if (modelStagesDone >= MODEL_STAGES.length) {
      return tourAsked
        ? { ...ended, stages: { ...ended.stages, steps: "done" as const }, steps: fixtureSteps }
        : ended;
    }
    const running = analysisInProgress(ended, CODE_STAGES + modelStagesDone);
    return tourAsked
      ? { ...running, stages: { ...running.stages, steps: "running" as const } }
      : running;
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
    const next = stagesDone < CODE_STAGES ? StageName.options[stagesDone] : undefined;
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
    publications.clear();
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

  const invalid = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
    failure("bad-request", issuesOf("body", issues).join("; "));

  /** Saves a preference in place of the one with its ID, or after the others. */
  const savePreference = (saved: Preference): MockResponse => {
    if (saved.enabled && !canEnable(preferences.preferences, saved.scope, saved.id)) {
      const where =
        saved.scope.kind === "global"
          ? "every repository"
          : `${saved.scope.repo.owner}/${saved.scope.repo.repo}`;
      return failure(
        "bad-request",
        `${MAX_ENABLED_PREFERENCES} preferences are already enabled for ${where}: switch one off or delete it first`,
      );
    }
    const known = preferences.preferences.some((one) => one.id === saved.id);
    preferences = {
      ...preferences,
      preferences: known
        ? preferences.preferences.map((one) => (one.id === saved.id ? saved : one))
        : [...preferences.preferences, saved],
    };
    return success(saved);
  };

  /** The drafts nothing says yet, as pending proposals. */
  const propose = (drafts: readonly PreferenceProposal[]): PreferenceProposal[] => {
    const said = [...preferences.preferences, ...preferences.proposals, ...rejected];
    const added = drafts.filter((draft) => !said.some((other) => sameRule(other, draft)));
    preferences = { ...preferences, proposals: [...preferences.proposals, ...added] };
    return added;
  };

  const handlers: Record<
    RouteName,
    (params: Readonly<Record<string, string>>, body: unknown) => MockResponse
  > = {
    getStatus: () => success(fixtureStatus),
    listPullRequests: () => success(fixturePullRequests),
    getReviewActivity: () => success(activeReviewerActivity(Date.now())),
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
        fixtureView = SYNTHETIC_VIEWS.get(ref.value.number) ?? fixtureAnalysisView;
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
    removeModelRun: ({ id }) => {
      const refused = findAnalysis(id) ?? requireComplete();
      if (refused !== null) return refused;
      if (timer !== null || !hasModelRun(analysis())) {
        return failure("bad-request", "Claude hasn't analyzed this pull request");
      }
      fixture = { ...withoutModel(fixtureView.analysis), usage: [], modelCalls: [] };
      modelStagesDone = null;
      // The states of Claude's points go; a publication stays, as on the server.
      pointReviews.clear();
      const response: RemovedModelRun = { analysis: analysis(), pointReviews: [] };
      return success(response);
    },
    runModel: ({ id }, body) => {
      const missing = findAnalysis(id);
      if (missing !== null) return missing;
      if (scenario === undefined) {
        return failure("model-unavailable", "the mock API doesn't run Claude");
      }
      tourAsked = routes.runModel.request.safeParse(body).data?.tour === true;
      // A run that ended plays again, as Try again does on the server.
      if (timer === null) {
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
      if (!pointsOf(analysis()).some((point) => point.id === pointId)) {
        return failure("not-found", `No point ${pointId} in analysis ${params.id}`);
      }
      const saved: PointReview = { pointId, ...request.data, updatedAt: now() };
      pointReviews.set(pointId, saved);
      // What the reviewer does with a point is what suggestions are made from.
      if (saved.state !== "open") signals += 1;
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
      const repeated = publications.get(request.data.publicationId);
      if (repeated !== undefined) return success(repeated);
      const published = buildPublication({
        analysis: fixture,
        summary: request.data.summary,
        isAuthor: fixtureView.isAuthor,
        hunkComments: request.data.hunkComments ?? [],
        verdict: request.data.verdict ?? null,
      });
      if (isEmptyPublication(published)) {
        return failure("bad-request", "Nothing to publish: no comment, no summary and no verdict");
      }
      const keys = ["summary", ...published.comments.map((comment) => comment.key)];
      const number = publications.size + 1;
      publication = {
        url: `${fixture.pullRequest?.url ?? "https://github.com"}#pullrequestreview-${number}`,
        publishedAt: now(),
        postedCommentIds: Object.fromEntries(
          keys.map((key, index) => [key, `${number * 1000 + index}`]),
        ),
      };
      publications.set(request.data.publicationId, publication);
      yourVerdict =
        published.verdict === "approve"
          ? "approved"
          : published.verdict === "request_changes"
            ? "changes-requested"
            : (yourVerdict ?? "commented");
      return success(publication);
    },
    revokeApproval: ({ id }) => {
      const missing = findAnalysis(id);
      if (missing !== null) return missing;
      if (yourVerdict === "approved") yourVerdict = null;
      return success({});
    },
    getThreads: ({ id }) => findAnalysis(id) ?? success({ threads }),
    getPullRequestStatus: ({ id }) =>
      findAnalysis(id) ??
      success(
        yourVerdict !== null
          ? {
              ...fixturePullRequestStatus,
              reviewers: [
                ...fixturePullRequestStatus.reviewers.filter((one) => one.id !== "lee-park"),
                { id: "lee-park", name: "Lee Park", team: false, verdict: yourVerdict },
              ],
            }
          : fixturePullRequestStatus,
      ),
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
    getPreferences: () => success(preferences),
    addPreference: (_, body) => {
      const request = routes.addPreference.request.safeParse(body);
      if (!request.success) return invalid(request.error.issues);
      const { kind, text, scope, source } = request.data;
      const fields = { kind, text, scope, createdAt: now() };
      return savePreference({
        id: preferenceId(fields, new Set<string>(preferences.preferences.map((one) => one.id))),
        ...fields,
        source: source ?? "written",
        enabled: true,
        updatedAt: fields.createdAt,
      });
    },
    updatePreference: (params, body) => {
      const request = routes.updatePreference.request.safeParse(body);
      if (!request.success) return invalid(request.error.issues);
      const preference = preferences.preferences.find((one) => one.id === params.preferenceId);
      if (preference === undefined) {
        return failure("not-found", `No preference ${params.preferenceId}`);
      }
      const { kind, text, scope, enabled } = request.data;
      return savePreference({
        ...preference,
        kind: kind ?? preference.kind,
        text: text ?? preference.text,
        scope: scope ?? preference.scope,
        enabled: enabled ?? preference.enabled,
        updatedAt: now(),
      });
    },
    deletePreference: (params) => {
      if (!preferences.preferences.some((one) => one.id === params.preferenceId)) {
        return failure("not-found", `No preference ${params.preferenceId}`);
      }
      preferences = {
        ...preferences,
        preferences: preferences.preferences.filter((one) => one.id !== params.preferenceId),
      };
      return success({});
    },
    suggestPreferences: (_, body) => {
      const request = routes.suggestPreferences.request.safeParse(body);
      if (!request.success) return invalid(request.error.issues);
      const { repo } = request.data;
      // Only GitHub's past reviews are read here, so a Bitbucket repository has the signals alone.
      const read =
        repo.host === "github"
          ? { signals, comments: 92, pullRequests: 30 }
          : { signals, comments: 0, pullRequests: 0 };
      if (read.signals === 0 && read.comments === 0) return success({ proposals: [], ...read });
      const proposals = propose(
        [...fixtureSuggestions, fixtureImport].map(
          (draft): PreferenceProposal => ({
            ...draft,
            source: "learned",
            scope: draft.scope.kind === "global" ? draft.scope : { kind: "repo", repo },
          }),
        ),
      );
      return success({ proposals, ...read });
    },
    setGuidelineSwitch: (_, body) => {
      const request = routes.setGuidelineSwitch.request.safeParse(body);
      if (!request.success) return invalid(request.error.issues);
      const { repo, path, enabled } = request.data;
      preferences = {
        ...preferences,
        repositories: preferences.repositories.map((one) =>
          sameRepo(one.repo, repo) && one.guidelineFiles !== null
            ? {
                ...one,
                guidelineFiles: one.guidelineFiles.map((file) =>
                  file.path === path ? { ...file, enabled } : file,
                ),
              }
            : one,
        ),
      };
      return success({});
    },
    decideProposal: (params, body) => {
      const request = routes.decideProposal.request.safeParse(body);
      if (!request.success) return invalid(request.error.issues);
      const proposal = preferences.proposals.find((one) => one.id === params.proposalId);
      if (proposal === undefined) return failure("not-found", `No proposal ${params.proposalId}`);
      const { decision, kind, text, scope } = request.data;
      const decided = () => {
        preferences = {
          ...preferences,
          proposals: preferences.proposals.filter((one) => one !== proposal),
        };
      };
      if (decision === "reject") {
        rejected.push(proposal);
        decided();
        return success({ preference: null });
      }
      const fields = {
        kind: kind ?? proposal.kind,
        text: text ?? proposal.text,
        scope: scope ?? proposal.scope,
        createdAt: now(),
      };
      if (fields.text.length > MAX_PREFERENCE_TEXT) {
        return failure(
          "bad-request",
          `A preference is one sentence of at most ${MAX_PREFERENCE_TEXT} characters`,
        );
      }
      const saved = savePreference({
        id: preferenceId(fields, new Set<string>(preferences.preferences.map((one) => one.id))),
        ...fields,
        source: proposal.source,
        enabled: true,
        updatedAt: fields.createdAt,
      });
      if (saved.status !== 200) return saved;
      decided();
      return success({ preference: saved.body });
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
