import {
  type Analysis,
  type AnalysisId,
  type AnalysisKey,
  analysisId,
  type CheckoutStatus,
  type HostKind,
  hasModelRun,
  inProgress,
  MODEL_STAGES,
  mapModelStages,
  modelRunnable,
  type PullRequest,
  type PullRequestRef,
  parsePullRequestUrl,
  type StageName,
  StageName as StageNames,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";
import { pipelineVersion } from "./pipeline-version.ts";
import { runModel, runPipeline } from "./run-pipeline.ts";
import { type CheckoutAt, lookUpCheckout } from "./unchanged-callers.ts";

/** More than enough to find every analysis that was running when megareviewer stopped. */
const RECOVERY_SCAN_LIMIT = 200;

const STAGES: readonly StageName[] = StageNames.options;

export const hostFor = (deps: AppDeps, host: HostKind): Result<GitHost, UseCaseError> => {
  const gitHost = deps.hosts[host];
  return gitHost === undefined
    ? err(appError("host-not-configured", `${hostName(host)} isn't configured`))
    : ok(gitHost);
};

const hostName = (host: HostKind): string =>
  ({ github: "GitHub", bitbucket: "Bitbucket Cloud" })[host];

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

const newAnalysis = (
  deps: AppDeps,
  key: AnalysisKey,
  pullRequest: PullRequest,
  checkout: CheckoutStatus,
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
    tour: "pending",
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
  checkout,
  unchangedCallers: [],
  intent: null,
  findings: [],
  risk: [],
  decisions: [],
  tour: null,
  warnings: [],
  usage: [],
  modelCalls: [],
  error: null,
  modelError: null,
  createdAt,
  updatedAt: deps.clock.now(),
});

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
      checkout.status,
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
    before: () => Promise<void> = async () => {},
  ): void => {
    const run = (async () => {
      await before();
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
     * Runs the model's passes on a complete analysis, adding to it. A run already going is
     * joined; one that's done or can't run is refused.
     */
    async runModel(id: AnalysisId): Promise<Result<{ analysisId: AnalysisId }, UseCaseError>> {
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
        return err(appError("bad-request", "Claude has already analyzed this pull request"));
      }
      const availability = await deps.modelAvailability();
      if (!availability.available) {
        return err(appError("model-unavailable", availability.reason));
      }
      const host = hostFor(deps, analysis.key.ref.repo.host);
      if (!host.ok) return host;
      const checkout =
        analysis.checkout === "read"
          ? await lookUpCheckout(deps.checkouts, pullRequest.ref.repo, analysis.key.headSha)
          : null;
      // No await from here on until the run is in the map, so two requests can't both start it.
      if (inFlight.has(id)) return ok({ analysisId: id });
      const run = runModel(deps, host.value, analysis, pullRequest, checkout?.at ?? null)
        .catch((error: unknown) => {
          deps.logger.error("Couldn't record the model run", { analysisId: id, error });
        })
        .finally(() => inFlight.delete(id));
      inFlight.set(id, run);
      return ok({ analysisId: id });
    },

    /**
     * Takes Claude's run off a complete analysis, so the passes can be tried again: the code's
     * stages run again in place, under the same ID, and the states of Claude's points go.
     */
    async removeModelRun(
      id: AnalysisId,
    ): Promise<Result<{ analysisId: AnalysisId }, UseCaseError>> {
      const analysis = await deps.store.getAnalysis(id);
      if (analysis === null) return err(appError("not-found", `No analysis ${id}`));
      const { pullRequest } = analysis;
      if (analysis.status !== "complete" || inProgress(analysis) || pullRequest === null) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      if (!hasModelRun(analysis)) {
        return err(appError("bad-request", "Claude hasn't analyzed this pull request"));
      }
      const host = hostFor(deps, analysis.key.ref.repo.host);
      if (!host.ok) return host;
      const checkout =
        analysis.checkout === "read"
          ? await lookUpCheckout(deps.checkouts, pullRequest.ref.repo, analysis.key.headSha)
          : null;
      // No await from here on until the run is in the map, so a model run can't start meanwhile.
      if (inFlight.has(id)) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      const fresh = newAnalysis(
        deps,
        analysis.key,
        pullRequest,
        analysis.checkout,
        analysis.createdAt,
      );
      runCode(host.value, fresh, pullRequest, checkout?.at ?? null, () =>
        deps.store.clearPointReviews(id),
      );
      return ok({ analysisId: id });
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
        const stage = MODEL_STAGES.find((name) => analysis.stages[name] === "running") ?? "intent";
        await deps.store.saveAnalysis({
          ...analysis,
          stages: mapModelStages(analysis.stages, (status) =>
            status === "running" ? "failed" : status === "pending" ? "skipped" : status,
          ),
          modelError: {
            stage,
            code: "interrupted",
            message: "megareviewer stopped while Claude analyzed the pull request",
          },
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
      const count = interrupted.length + stopped.length;
      if (count > 0) deps.logger.info("Marked interrupted analyses as failed", { count });
      return count;
    },
  };
};
