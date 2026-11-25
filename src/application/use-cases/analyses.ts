import {
  type Analysis,
  type AnalysisId,
  type AnalysisKey,
  analysisId,
  type BeforeModel,
  following,
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
import { keyOf, keysOf } from "./pipeline-version.ts";
import { checkoutFields, codeFields, runModel, runPipeline } from "./run-pipeline.ts";
import { type CheckoutAt, type CheckoutLookup, lookUpCheckout } from "./unchanged-callers.ts";

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
  checkout: CheckoutLookup,
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
  checkoutError: null,
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
      ? await lookUpCheckout(deps, pullRequest.ref.repo, analysis.key.headSha)
      : null;
  const fields = await codeFields(deps, host.value, pullRequest, checkout?.at ?? null);
  if (!fields.ok) return fields;
  const { risk, warnings } = fields.value;
  return ok({ beforeModel: { risk, warnings }, fields: fields.value });
};

/** What opening an analysis says of its checkout while nothing is read or downloaded. */
const lookedUp = ({ status, dir }: CheckoutLookup) => ({
  checkout: status,
  checkoutDir: dir,
  checkoutError: null,
});

/** Starts, joins and recovers analysis runs. Runs continue in the background. */
export const createAnalysisRunner = (deps: AppDeps) => {
  /** Runs in this process, so concurrent requests for one analysis join it. */
  const inFlight = new Map<AnalysisId, Promise<void>>();
  /** Model runs about to start, between being in flight and saying so on the analysis. */
  const starting = new Set<AnalysisId>();
  /** Callers on their way to a complete analysis, so they're read once. */
  const bringing = new Map<AnalysisId, Promise<void>>();
  /** Changes to a complete analysis being written: moments, where a run takes minutes. */
  const writing = new Map<AnalysisId, Promise<void>>();

  /**
   * Changes a complete analysis once nothing runs on it. A run keeps the analysis it started from
   * and saves it whole, so a change under one would be lost: a run waits for the changes being
   * written, then reads the analysis it starts from.
   */
  const writeWhenFree = async (
    id: AnalysisId,
    change: (current: Analysis) => Analysis,
  ): Promise<void> => {
    for (;;) {
      const busy = inFlight.get(id) ?? writing.get(id);
      if (busy === undefined) break;
      await busy;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    writing.set(id, promise);
    try {
      const current = await deps.store.getAnalysis(id);
      if (current === null) return;
      const next = change(current);
      if (next !== current) await deps.store.saveAnalysis(next);
    } finally {
      writing.delete(id);
      resolve();
    }
  };

  /** Tells the page that an analysis has its callers, or why it doesn't. */
  const announce = async (id: AnalysisId): Promise<void> => {
    const analysis = await deps.store.getAnalysis(id);
    if (analysis === null) return;
    deps.events.emit(
      id,
      following(analysis)
        ? { type: "updated", stage: "prep", status: analysis.stages.prep }
        : { type: "done" },
    );
  };

  /** Says why a download came to nothing. An analysis that wasn't waiting for one stays as it is. */
  const failDownload = async (id: AnalysisId, reason: string): Promise<void> => {
    await writeWhenFree(id, (current) =>
      current.checkout === "downloading"
        ? { ...current, checkout: "download-failed", checkoutError: reason }
        : current,
    );
    await announce(id);
  };

  /**
   * Reads the callers of a complete analysis from a checkout and adds them to it: they, where they
   * were read and what couldn't be, and nothing else, so the reviewer's drafts stay on it.
   */
  const addCallers = async (
    host: GitHost,
    id: AnalysisId,
    pullRequest: PullRequest,
    at: CheckoutAt,
    dir: string | null,
    onRead: () => void = () => {},
  ): Promise<void> => {
    const read = await checkoutFields(deps, host, pullRequest, at);
    onRead();
    if (!read.ok) {
      deps.logger.warn("Couldn't read the callers of an analysis", {
        analysisId: id,
        error: read.error.message,
      });
      return failDownload(
        id,
        `The repository was downloaded, but the pull request couldn't be read again: ${read.error.message}`,
      );
    }
    const { unchangedCallers, warnings } = read.value;
    const adding = (to: readonly string[]) => [
      ...to,
      ...warnings.filter((warning) => !to.includes(warning)),
    ];
    await writeWhenFree(id, (current) => ({
      ...current,
      unchangedCallers,
      checkout: "read",
      checkoutDir: dir,
      checkoutError: null,
      warnings: adding(current.warnings),
      // Remove AI review puts these back.
      beforeModel:
        current.beforeModel === null
          ? null
          : { ...current.beforeModel, warnings: adding(current.beforeModel.warnings) },
    }));
    await announce(id);
  };

  /** Runs what brings an analysis its callers, in the background, once at a time. */
  const bring = (id: AnalysisId, work: () => Promise<void>): Promise<void> => {
    const job = work()
      .catch(async (error: unknown) => {
        deps.logger.error("Couldn't add an analysis's callers", { analysisId: id, error });
        await failDownload(id, "megareviewer hit an internal error while reading the callers.");
      })
      .catch((error: unknown) => {
        deps.logger.error("Couldn't record an analysis's callers", { analysisId: id, error });
      })
      .finally(() => bringing.delete(id));
    bringing.set(id, job);
    return job;
  };

  /** Downloads the head commit of an analysis that says it's downloading, then adds the callers. */
  const download = async (
    host: GitHost,
    id: AnalysisId,
    pullRequest: PullRequest,
  ): Promise<void> => {
    const { headSha: sha, ref } = pullRequest;
    const copy = await deps.copies.download(ref.repo, sha);
    if (copy.ok) {
      const { checkout, dir } = copy.value;
      return addCallers(host, id, pullRequest, { checkout, sha }, dir);
    }
    // The next start sets a stopped one back, and opening the PR starts it again.
    if (copy.error.kind !== "stopped") return failDownload(id, copy.error.message);
  };

  /**
   * Brings a complete analysis its callers: from the checkout found, which opening it waits for, or
   * from a download, which it doesn't. With neither, it says what was found.
   */
  const bringCallers = async (
    host: GitHost,
    id: AnalysisId,
    pullRequest: PullRequest,
    lookup: CheckoutLookup,
  ): Promise<void> => {
    const { promise: ready, resolve: isReady } = Promise.withResolvers<void>();
    const { at } = lookup;
    if (at !== null) {
      const job = bring(id, () =>
        addCallers(host, id, pullRequest, at, lookup.dir, isReady).finally(isReady),
      );
      await ready;
      // A model run that started meanwhile comes first, and opening the PR doesn't wait for it.
      if (!inFlight.has(id)) await job;
      return;
    }
    if (deps.copies.downloadFolder === null) {
      await writeWhenFree(id, (current) =>
        current.checkout === lookup.status && current.checkoutDir === lookup.dir
          ? current
          : { ...current, ...lookedUp(lookup) },
      );
      return;
    }
    void bring(id, async () => {
      await writeWhenFree(id, (current) => ({
        ...current,
        ...lookedUp(lookup),
        checkout: "downloading",
      })).finally(isReady);
      await download(host, id, pullRequest);
    });
    await ready;
  };

  /** The pull request's analysis at its head commit, whichever key it's stored under. */
  const findStored = async (pullRequest: PullRequest): Promise<Analysis | null> => {
    const stored = await Promise.all(keysOf(pullRequest).map((key) => deps.store.findByKey(key)));
    return (
      stored
        .filter((analysis) => analysis !== null)
        .sort(
          (a, b) =>
            Number(b.status === "complete") - Number(a.status === "complete") ||
            Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        )[0] ?? null
    );
  };

  const startFor = async (host: GitHost, pullRequest: PullRequest): Promise<AnalysisId> => {
    const opened = await findStored(pullRequest);
    if (opened?.status === "complete" && opened.checkout === "read") return opened.id;
    const lookup = await lookUpCheckout(deps, pullRequest.ref.repo, pullRequest.headSha);
    const existing = await findStored(pullRequest);
    const key = existing?.key ?? keyOf(pullRequest);
    const id = existing?.id ?? analysisId(key);
    // No await from here on until the run is in the map, so two requests can't both start it.
    if (inFlight.has(id) || bringing.has(id)) return id;
    if (existing?.status === "complete") {
      if (existing.checkout !== "read") await bringCallers(host, id, pullRequest, lookup);
      return id;
    }
    // A failed analysis, or one interrupted by a restart, runs again under the same ID.
    const analysis = newAnalysis(
      deps,
      key,
      pullRequest,
      lookup,
      existing?.createdAt ?? deps.clock.now(),
    );
    runCode(host, analysis, pullRequest, lookup.at);
    return id;
  };

  /**
   * Saves a new analysis and runs the code's stages on it, in the background. Without a checkout,
   * the commit is downloaded once they're done, so the download doesn't slow down the review.
   */
  const runCode = (
    host: GitHost,
    analysis: Analysis,
    pullRequest: PullRequest,
    checkout: CheckoutAt | null,
  ): void => {
    const { id } = analysis;
    const downloading = checkout === null && deps.copies.downloadFolder !== null;
    const run = (async () => {
      await deps.store.saveAnalysis(analysis);
      await runPipeline(deps, host, analysis, pullRequest, checkout, downloading);
      const ended = downloading ? await deps.store.getAnalysis(id) : null;
      if (ended?.status === "complete") void bring(id, () => download(host, id, pullRequest));
    })()
      .catch((error: unknown) => {
        deps.logger.error("Couldn't record the analysis", { analysisId: id, error });
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, run);
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
        if (inProgress(analysis) || starting.has(id)) return ok({ analysisId: id });
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
          ? await lookUpCheckout(deps, pullRequest.ref.repo, analysis.key.headSha)
          : null;
      // No await from here on until the run is in the map, so two requests can't both start it.
      if (inFlight.has(id)) return ok({ analysisId: id });
      const { promise: run, resolve: ended } = Promise.withResolvers<void>();
      const end = () => {
        inFlight.delete(id);
        ended();
      };
      inFlight.set(id, run);
      starting.add(id);
      try {
        // Callers being added are written first, and the run starts from the analysis with them.
        await writing.get(id);
        const current = await deps.store.getAnalysis(id);
        if (current === null || !modelRunnable(current)) {
          end();
          return err(appError("analysis-not-complete", "The analysis has changed: try again"));
        }
        void runModel(
          deps,
          host.value,
          current,
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
          .finally(end);
        return ok({ analysisId: id });
      } catch (error) {
        end();
        throw error;
      } finally {
        starting.delete(id);
      }
    },

    /**
     * Takes Claude's run off a complete analysis, so the passes can be tried again: what the code
     * made is put back, under the same ID, and the states of Claude's points go. An analysis stored
     * before what the code made was kept runs the code's stages again to get it.
     */
    async removeModelRun(
      id: AnalysisId,
    ): Promise<Result<{ analysis: Analysis; pointReviews: readonly PointReview[] }, UseCaseError>> {
      const opened = await deps.store.getAnalysis(id);
      if (opened === null) return err(appError("not-found", `No analysis ${id}`));
      const { pullRequest } = opened;
      if (opened.status !== "complete" || inProgress(opened) || pullRequest === null) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      if (!hasModelRun(opened)) {
        return err(appError("bad-request", "No model has analyzed this pull request"));
      }
      // No await from here on until the removal is in the map, so a model run can't start meanwhile.
      if (inFlight.has(id)) {
        return err(appError("analysis-not-complete", "The analysis isn't complete yet"));
      }
      const { promise: removal, resolve: removed } = Promise.withResolvers<void>();
      inFlight.set(id, removal);
      try {
        await writing.get(id);
        const analysis = (await deps.store.getAnalysis(id)) ?? opened;
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
     * leaves behind, and sets back every download, which opening the PR starts again. Call once at
     * startup. Returns how many it failed.
     */
    async recoverInterruptedAnalyses(): Promise<number> {
      const scanned = await deps.store.listRecent(RECOVERY_SCAN_LIMIT);
      const recent = await Promise.all(
        scanned.map(async (analysis) => {
          if (analysis.checkout !== "downloading" || bringing.has(analysis.id)) return analysis;
          const { checkoutDir: dir } = analysis;
          const setBack: Analysis = {
            ...analysis,
            checkout: dir === null ? "none" : "missing-commit",
          };
          await deps.store.saveAnalysis(setBack);
          return setBack;
        }),
      );
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
