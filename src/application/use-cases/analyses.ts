import {
  type Analysis,
  type AnalysisId,
  type AnalysisKey,
  analysisId,
  type BeforeModel,
  type CheckoutStatus,
  hasModelRun,
  inProgress,
  MODEL_STAGES,
  type ModelOption,
  type ModelOptionId,
  type ModelOptions,
  mapModelStages,
  modelFamily,
  modelRunnable,
  type PointReview,
  type PullRequest,
  type PullRequestRef,
  parsePullRequestUrl,
  runOptionOf,
  STEPS_STAGE,
  type StageName,
  StageName as StageNames,
  withoutModelRun,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";
import { hostFor } from "./hosts.ts";
import { pipelineVersion } from "./pipeline-version.ts";
import { codeFields, runModel, runPipeline } from "./run-pipeline.ts";
import { type CheckoutAt, lookUpCheckout } from "./unchanged-callers.ts";

/** More than enough to find every analysis that was running when megareviewer stopped. */
const RECOVERY_SCAN_LIMIT = 200;

const STAGES: readonly StageName[] = StageNames.options;

const fetchPullRequest = async (
  deps: AppDeps,
  ref: PullRequestRef,
): Promise<Result<{ host: GitHost; pullRequest: PullRequest }, UseCaseError>> => {
  const host = hostFor(deps, ref.repo.host);
  if (!host.ok) return host;
  const pullRequest = await host.value.getPullRequest(ref);
  return pullRequest.ok
    ? ok({ host: host.value, pullRequest: pullRequest.value })
    : err(fromHostError(pullRequest.error));
};

/**
 * The catalog's options, with the option the last model call used as the one a run without a
 * choice uses, while it can run, so a restart doesn't put the reviewer back on the default.
 */
export const modelOptions = async ({
  models,
  store,
}: Pick<AppDeps, "models" | "store">): Promise<ModelOptions> => {
  const [catalog, lastId] = await Promise.all([models.options(), store.getLastModelOption()]);
  const last = catalog.options.find((option) => option.id === lastId && option.available);
  return last === undefined ? catalog : { ...catalog, defaultId: last.id };
};

/**
 * The option a model call uses: the one asked for, else the one a run without a choice uses, with
 * what makes the call, the passes or the suggester, and remembered as the last used. An unknown
 * option is a bad request; one that can't run, or can't make that call, is unavailable, with why.
 */
export const chooseOption = async <T>(
  deps: Pick<AppDeps, "models" | "store">,
  optionId: ModelOptionId | undefined,
  runner: (optionId: ModelOptionId) => T | null,
): Promise<Result<{ option: ModelOption; runner: T }, UseCaseError>> => {
  const { options, defaultId } = await modelOptions(deps);
  const id = optionId ?? defaultId;
  const option = options.find((candidate) => candidate.id === id);
  if (option === undefined) {
    return err(
      optionId === undefined
        ? appError("model-unavailable", "No model is known to megareviewer")
        : appError("bad-request", `No model option ${optionId}`),
    );
  }
  const unavailable = (reason: string) =>
    err(
      appError(
        "model-unavailable",
        `${option.modelName} through ${option.providerName} can't run: ${reason}`,
      ),
    );
  if (!option.available) return unavailable(option.reason ?? "it can't run");
  const found = runner(option.id);
  if (found === null) return unavailable("it can't run");
  await deps.store.recordModelOption(option.id);
  return ok({ option, runner: found });
};

const newAnalysis = (
  deps: AppDeps,
  key: AnalysisKey,
  pullRequest: PullRequest,
  checkout: { readonly status: CheckoutStatus; readonly dir: string | null },
  createdAt: string,
): Analysis => ({
  id: analysisId(key),
  key,
  status: "running",
  stages: {
    collect: "pending",
    prep: "pending",
    intent: "pending",
    findings: "pending",
    risk: "pending",
    decisions: "pending",
    steps: "skipped",
  },
  filesFetched: null,
  pullRequest,
  files: [],
  tickets: [],
  missingTicketKeys: [],
  proofs: [],
  parts: [],
  callGraph: [],
  callSites: [],
  fileLinks: [],
  generated: [],
  checkout: checkout.status,
  checkoutDir: checkout.dir,
  unchangedCallers: [],
  intent: null,
  findings: [],
  risk: [],
  decisions: [],
  flows: null,
  steps: null,
  stepsError: null,
  warnings: [],
  usage: [],
  modelCalls: [],
  error: null,
  modelError: null,
  modelOption: null,
  guidance: null,
  beforeModel: null,
  guardrails: null,
  createdAt,
  updatedAt: deps.clock.now(),
});

/** What the code makes of an analysis's PR when nothing kept it, as the stages compute it. */
const recomputeCode = async (
  deps: AppDeps,
  analysis: Analysis,
  pullRequest: PullRequest,
): Promise<Result<{ beforeModel: BeforeModel; fields: Partial<Analysis> }, UseCaseError>> => {
  const host = hostFor(deps, analysis.key.ref.repo.host);
  if (!host.ok) return host;
  const checkout =
    analysis.checkout === "read"
      ? await lookUpCheckout(deps.checkouts, pullRequest.ref.repo, analysis.key.headSha)
      : null;
  const fields = await codeFields(deps, host.value, pullRequest, checkout?.at ?? null);
  if (!fields.ok) return fields;
  const { risk, warnings } = fields.value;
  return ok({ beforeModel: { risk, warnings }, fields: fields.value });
};

/** Starts, joins and recovers analysis runs. Runs continue in the background. */
export const createAnalysisRunner = (deps: AppDeps) => {
  /** Runs in this process, so concurrent requests for one analysis join it. */
  const inFlight = new Map<AnalysisId, Promise<void>>();

  const startFor = async (host: GitHost, pullRequest: PullRequest): Promise<AnalysisId> => {
    const checkout = await lookUpCheckout(
      deps.checkouts,
      pullRequest.ref.repo,
      pullRequest.headSha,
    );
    const key: AnalysisKey = {
      ref: pullRequest.ref,
      headSha: pullRequest.headSha,
      pipelineVersion: pipelineVersion(checkout.status === "read"),
    };
    const existing = await deps.store.findByKey(key);
    const id = existing?.id ?? analysisId(key);
    // No await from here on until the run is in the map, so two requests can't both start it.
    if (existing?.status === "complete" || inFlight.has(id)) return id;
    // A failed analysis, or one interrupted by a restart, runs again under the same ID.
    const analysis = newAnalysis(
      deps,
      key,
      pullRequest,
      checkout,
      existing?.createdAt ?? deps.clock.now(),
    );
    runCode(host, analysis, pullRequest, checkout.at);
    return id;
  };

  /** Saves a new analysis and runs the code's stages on it, in the background. */
  const runCode = (
    host: GitHost,
    analysis: Analysis,
    pullRequest: PullRequest,
    checkout: CheckoutAt | null,
  ): void => {
    const run = (async () => {
      await deps.store.saveAnalysis(analysis);
      await runPipeline(deps, host, analysis, pullRequest, checkout);
    })()
      .catch((error: unknown) => {
        deps.logger.error("Couldn't record the analysis", { analysisId: analysis.id, error });
      })
      .finally(() => inFlight.delete(analysis.id));
    inFlight.set(analysis.id, run);
  };

  return {
    async startAnalysis(url: string): Promise<Result<{ analysisId: AnalysisId }, UseCaseError>> {
      const ref = parsePullRequestUrl(url);
      if (!ref.ok) {
        return err(appError("unsupported-url", "Not a GitHub or Bitbucket Cloud pull request URL"));
      }
      const fetched = await fetchPullRequest(deps, ref.value);
      if (!fetched.ok) return fetched;
      return ok({ analysisId: await startFor(fetched.value.host, fetched.value.pullRequest) });
    },

    /** Re-runs a failed analysis. If the PR has new commits, analyzes those under a new ID. */
    async retryAnalysis(id: AnalysisId): Promise<Result<{ analysisId: AnalysisId }, UseCaseError>> {
      const analysis = await deps.store.getAnalysis(id);
      if (analysis === null) return err(appError("not-found", `No analysis ${id}`));
      if (analysis.status !== "failed") {
        return err(appError("bad-request", "Only a failed analysis can be retried"));
      }
      const fetched = await fetchPullRequest(deps, analysis.key.ref);
      if (!fetched.ok) return fetched;
      return ok({ analysisId: await startFor(fetched.value.host, fetched.value.pullRequest) });
    },

    /**
     * Runs the model's passes on a complete analysis, adding to it, and the steps pass beside them
     * when `tour` asks for the page's tour. A run already going is joined; one that's done or can't
     * run is refused.
     */
    async runModel(
      id: AnalysisId,
      optionId?: ModelOptionId,
      tour = false,
    ): Promise<Result<{ analysisId: AnalysisId }, UseCaseError>> {
      let analysis = await deps.store.getAnalysis(id);
      if (analysis === null) return err(appError("not-found", `No analysis ${id}`));
      const running = inFlight.get(id);
      if (running !== undefined) {
        if (inProgress(analysis)) return ok({ analysisId: id });
        // A run that has announced its end but not left the map yet.
        await running;
        analysis = await deps.store.getAnalysis(id);
        if (analysis === null) return err(appError("not-found", `No analysis ${id}`));
      }
      const { pullRequest } = analysis;
      if (analysis.status !== "complete" || pullRequest === null) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      if (!modelRunnable(analysis)) {
        return err(
          appError(
            "bad-request",
            `${modelFamily(analysis.modelOption)} has already analyzed this pull request`,
          ),
        );
      }
      const chosen = await chooseOption(deps, optionId, (option) => deps.models.model(option));
      if (!chosen.ok) return chosen;
      const host = hostFor(deps, analysis.key.ref.repo.host);
      if (!host.ok) return host;
      const checkout =
        analysis.checkout === "read"
          ? await lookUpCheckout(deps.checkouts, pullRequest.ref.repo, analysis.key.headSha)
          : null;
      // No await from here on until the run is in the map, so two requests can't both start it.
      if (inFlight.has(id)) return ok({ analysisId: id });
      const run = runModel(
        deps,
        host.value,
        analysis,
        pullRequest,
        {
          model: chosen.value.runner,
          option: runOptionOf(chosen.value.option),
          advisor: deps.models.advisor(chosen.value.option.id),
          tour,
        },
        checkout?.at ?? null,
      )
        .catch((error: unknown) => {
          deps.logger.error("Couldn't record the model run", { analysisId: id, error });
        })
        .finally(() => inFlight.delete(id));
      inFlight.set(id, run);
      return ok({ analysisId: id });
    },

    /**
     * Takes Claude's run off a complete analysis, so the passes can be tried again: what the code
     * made is put back, under the same ID, and the states of Claude's points go. An analysis stored
     * before what the code made was kept runs the code's stages again to get it.
     */
    async removeModelRun(
      id: AnalysisId,
    ): Promise<Result<{ analysis: Analysis; pointReviews: readonly PointReview[] }, UseCaseError>> {
      const analysis = await deps.store.getAnalysis(id);
      if (analysis === null) return err(appError("not-found", `No analysis ${id}`));
      const { pullRequest } = analysis;
      if (analysis.status !== "complete" || inProgress(analysis) || pullRequest === null) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      if (!hasModelRun(analysis)) {
        return err(appError("bad-request", "No model has analyzed this pull request"));
      }
      // No await from here on until the removal is in the map, so a model run can't start meanwhile.
      if (inFlight.has(id)) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      const { promise: removal, resolve: removed } = Promise.withResolvers<void>();
      inFlight.set(id, removal);
      try {
        const code =
          analysis.beforeModel === null
            ? await recomputeCode(deps, analysis, pullRequest)
            : ok({ beforeModel: analysis.beforeModel, fields: {} });
        if (!code.ok) return code;
        const restored = withoutModelRun(
          { ...analysis, ...code.value.fields },
          code.value.beforeModel,
          deps.clock.now(),
        );
        // States first: if saving the analysis fails, it keeps its run, without the states.
        await deps.store.clearPointReviews(id);
        await deps.store.saveAnalysis(restored);
        return ok({ analysis: restored, pointReviews: await deps.store.getPointReviews(id) });
      } finally {
        inFlight.delete(id);
        removed();
      }
    },

    /**
     * Fails every analysis still marked running, and every model run, which only a stop mid-run
     * leaves behind. Call once at startup. Returns how many it failed.
     */
    async recoverInterruptedAnalyses(): Promise<number> {
      const recent = await deps.store.listRecent(RECOVERY_SCAN_LIMIT);
      const stopped = recent.filter(
        (analysis) =>
          analysis.status === "complete" && inProgress(analysis) && !inFlight.has(analysis.id),
      );
      for (const analysis of stopped) {
        const unfinished = (name: StageName) =>
          analysis.stages[name] === "running" || analysis.stages[name] === "pending";
        const stage = MODEL_STAGES.find((name) => analysis.stages[name] === "running") ?? "intent";
        const message = `megareviewer stopped while ${modelFamily(analysis.modelOption)} analyzed the pull request`;
        await deps.store.saveAnalysis({
          ...analysis,
          stages: mapModelStages(analysis.stages, (status) =>
            status === "running" ? "failed" : status === "pending" ? "skipped" : status,
          ),
          ...(analysis.guardrails === "running" ? { guardrails: "failed" as const } : {}),
          // A tour still being written is the tour's error, never the run's.
          ...(MODEL_STAGES.some(unfinished)
            ? { modelError: { stage, code: "interrupted", message } }
            : {}),
          ...(unfinished(STEPS_STAGE)
            ? { stepsError: { stage: STEPS_STAGE, code: "interrupted", message } }
            : {}),
          updatedAt: deps.clock.now(),
        });
      }
      const interrupted = recent.filter(
        (analysis) => analysis.status === "running" && !inFlight.has(analysis.id),
      );
      for (const analysis of interrupted) {
        const stage =
          STAGES.find((name) => analysis.stages[name] === "running") ??
          STAGES.find((name) => analysis.stages[name] !== "done") ??
          "collect";
        await deps.store.saveAnalysis({
          ...analysis,
          status: "failed",
          stages: { ...analysis.stages, [stage]: "failed" },
          error: {
            stage,
            code: "interrupted",
            message: "megareviewer stopped during the analysis",
          },
          updatedAt: deps.clock.now(),
        });
      }
      // A run stopped during its guardrail call: the passes had ended, so only the call failed.
      const calling = recent.filter(
        (analysis) =>
          analysis.guardrails === "running" && !inProgress(analysis) && !inFlight.has(analysis.id),
      );
      for (const analysis of calling) {
        await deps.store.saveAnalysis({
          ...analysis,
          guardrails: "failed",
          updatedAt: deps.clock.now(),
        });
      }
      const count = interrupted.length + stopped.length + calling.length;
      if (count > 0) deps.logger.info("Marked interrupted analyses as failed", { count });
      return count;
    },
  };
};
