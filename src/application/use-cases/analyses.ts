import {
  type Analysis,
  type AnalysisId,
  type AnalysisKey,
  analysisId,
  type HostKind,
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
import { runPipeline } from "./run-pipeline.ts";

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
  createdAt: string,
): Analysis => ({
  id: analysisId(key),
  key,
  status: "running",
  stages: {
    collect: "pending",
    prep: "pending",
    intent: "pending",
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
  fileLinks: [],
  generated: [],
  checkout: "none",
  unchangedCallers: [],
  intent: null,
  risk: [],
  decisions: [],
  tour: null,
  warnings: [],
  usage: [],
  error: null,
  createdAt,
  updatedAt: deps.clock.now(),
});

/** Starts, joins and recovers analysis runs. Runs continue in the background. */
export const createAnalysisRunner = (deps: AppDeps) => {
  /** Runs in this process, so concurrent requests for one analysis join it. */
  const inFlight = new Map<AnalysisId, Promise<void>>();

  const startFor = async (host: GitHost, pullRequest: PullRequest): Promise<AnalysisId> => {
    const key: AnalysisKey = {
      ref: pullRequest.ref,
      headSha: pullRequest.headSha,
      pipelineVersion: pipelineVersion(deps.model, deps.modelEnabled, false),
    };
    const existing = await deps.store.findByKey(key);
    const id = existing?.id ?? analysisId(key);
    // No await from here on until the run is in the map, so two requests can't both start it.
    if (existing?.status === "complete" || inFlight.has(id)) return id;
    // A failed analysis, or one interrupted by a restart, runs again under the same ID.
    const analysis = newAnalysis(deps, key, pullRequest, existing?.createdAt ?? deps.clock.now());
    const run = (async () => {
      await deps.store.saveAnalysis(analysis);
      await runPipeline(deps, host, analysis, pullRequest);
    })()
      .catch((error: unknown) => {
        deps.logger.error("Couldn't record the analysis", { analysisId: id, error });
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, run);
    return id;
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
     * Fails every analysis still marked running, which only a stop mid-run leaves behind.
     * Call once at startup. Returns how many it failed.
     */
    async recoverInterruptedAnalyses(): Promise<number> {
      const interrupted = (await deps.store.listRecent(RECOVERY_SCAN_LIMIT)).filter(
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
      if (interrupted.length > 0) {
        deps.logger.info("Marked interrupted analyses as failed", { count: interrupted.length });
      }
      return interrupted.length;
    },
  };
};
