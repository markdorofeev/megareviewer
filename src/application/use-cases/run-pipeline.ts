import type { HunkId } from "../../domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisError,
  type BeforeModel,
  classifyByRules,
  codeFlows,
  type FilesFetched,
  following,
  joinParts,
  keepBeforeModel,
  MODEL_STAGES,
  type ModelRunOption,
  mapModelStages,
  modelFamily,
  type PullRequest,
  STEPS_STAGE,
  type StageName,
  type StageStatus,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import type { AnalysisModel, GitHost, GuardrailAdvisor } from "../ports/index.ts";
import { type Collected, collect, type OnFilesFetched } from "./collect.ts";
import type { AppDeps } from "./deps.ts";
import type { UseCaseError } from "./errors.ts";
import { type GuardrailCall, runGuardrailCall } from "./guardrails.ts";
import { runGuidance } from "./guidance.ts";
import { buildAnalysisInput, fitToModel } from "./model-input.ts";
import { askingForTour, runFindings, runIntent, runSteps } from "./model-passes.ts";
import { prep } from "./prep.ts";
import type { CheckoutAt } from "./unchanged-callers.ts";

type Patch = Partial<Analysis> | ((analysis: Analysis) => Partial<Analysis>);

/**
 * Keeps the analysis being built, saving it after every change and announcing every stage
 * status change. Changes apply to the latest state, so the parallel passes don't lose each
 * other's results.
 */
const createTracker = (deps: AppDeps, initial: Analysis) => {
  let analysis = initial;
  let lastStage: StageName = "collect";
  const save = async (patch: Patch): Promise<void> => {
    const changes = typeof patch === "function" ? patch(analysis) : patch;
    analysis = { ...analysis, ...changes, updatedAt: deps.clock.now() };
    await deps.store.saveAnalysis(analysis);
  };
  const setStage = async (stage: StageName, status: StageStatus, patch: Patch = {}) => {
    if (status === "running") lastStage = stage;
    await save((current) => ({
      ...(typeof patch === "function" ? patch(current) : patch),
      stages: { ...current.stages, [stage]: status },
    }));
    deps.events.emit(analysis.id, { type: "updated", stage, status });
  };
  /** Collect is still running, but further along: announced so the page shows the count. */
  const setFilesFetched = async (filesFetched: FilesFetched) => {
    await save({ filesFetched });
    deps.events.emit(analysis.id, { type: "updated", stage: "collect", status: "running" });
  };
  /** The end of what ran, or an update while something else of the analysis is still to come. */
  const announceEnd = (stage: StageName) => {
    deps.events.emit(
      analysis.id,
      following(analysis)
        ? { type: "updated", stage, status: analysis.stages[stage] }
        : { type: "done" },
    );
  };
  /** A complete analysis whose callers come later says so in the same write, so the events go on. */
  const finish = async (error: AnalysisError | null, downloading = false) => {
    await save({
      status: error === null ? "complete" : "failed",
      error,
      ...(error === null && downloading ? { checkout: "downloading" } : {}),
    });
    announceEnd("prep");
  };
  /**
   * Ends a model run's passes. Passes it didn't reach go back to not run; the analysis stays
   * complete. While its guardrail call runs, the events go on, so the page lands the review now
   * and reads the call's marks when it ends.
   */
  const finishModel = async (modelError: AnalysisError | null) => {
    await save((current) => ({
      modelError,
      stages: mapModelStages(current.stages, (status) =>
        status === "pending" ? "skipped" : status,
      ),
    }));
    announceEnd("findings");
  };
  /** Ends a run's guardrail call, with what came of it, or as failed when the run crashed. */
  const finishGuardrails = async (call: GuardrailCall | null) => {
    if (analysis.guardrails !== "running") return;
    await save((current) => ({
      guardrails: call?.ok === true ? "done" : "failed",
      ...(call === null
        ? {}
        : {
            ...(call.ok ? { findings: call.findings } : {}),
            ...(current.guidance === null
              ? {}
              : { guidance: { ...current.guidance, checks: call.checks } }),
            ...adding({
              warnings: call.warnings.filter((warning) => !current.warnings.includes(warning)),
              usage: call.usage,
              modelCalls: call.modelCalls,
            })(current),
          }),
    }));
    announceEnd("findings");
  };
  return {
    get lastStage() {
      return lastStage;
    },
    get current() {
      return analysis;
    },
    save,
    setStage,
    setFilesFetched,
    finish,
    finishModel,
    finishGuardrails,
    fail: async (stage: StageName, failure: UseCaseError) => {
      await setStage(stage, "failed");
      await finish({ stage, ...failure });
    },
    failModel: async (stage: StageName, failure: UseCaseError) => {
      await setStage(stage, "failed");
      await finishModel({ stage, ...failure });
    },
  };
};

type Tracker = ReturnType<typeof createTracker>;

/** Appends to the analysis's warnings, usage and traced model calls, for patches. */
const adding =
  (added: {
    warnings?: readonly string[];
    usage?: Analysis["usage"];
    modelCalls?: Analysis["modelCalls"];
  }) =>
  (analysis: Analysis) => ({
    warnings: [...analysis.warnings, ...(added.warnings ?? [])],
    usage: [...analysis.usage, ...(added.usage ?? [])],
    modelCalls: [...analysis.modelCalls, ...(added.modelCalls ?? [])],
  });

/** What the code alone makes of a collected PR: proofs, risk from rules, and the code's flows. */
const prepare = async (deps: AppDeps, collected: Collected, checkout: CheckoutAt | null) => {
  const prepared = await prep(deps.parser, collected, checkout);
  const {
    proofs,
    parts,
    callGraph,
    callSites,
    definitionCalls,
    required,
    definitions,
    generated,
    unchangedCallers,
  } = prepared;
  const proofRisk = proofs.flatMap((proof) =>
    proof.hunkId === null
      ? []
      : [
          {
            hunkId: proof.hunkId,
            riskClass: "mechanical" as const,
            reason: proof.detail,
            source: "proof" as const,
          },
        ],
  );
  const ruleRisk = classifyByRules(collected.files, new Set(proofRisk.map((risk) => risk.hunkId)));
  // Ordered by the rules' risk.
  const skeleton = codeFlows({
    files: collected.files,
    required,
    parts,
    callGraph,
    risk: [...proofRisk, ...ruleRisk],
    definitions,
    generated,
  });
  const joined = joinParts(
    skeleton,
    parts,
    callGraph,
    unchangedCallers,
    callSites,
    definitionCalls,
  );
  return { prepared, proofRisk, ruleRisk, skeleton, joined };
};

/** The fields prep fills in, but its warnings. */
const preparedFields = ({
  prepared,
  proofRisk,
  ruleRisk,
  joined,
}: Awaited<ReturnType<typeof prepare>>) => ({
  proofs: prepared.proofs,
  ...joined,
  fileLinks: prepared.fileLinks,
  generated: [...prepared.generated].sort(),
  risk: [...proofRisk, ...ruleRisk],
});

/**
 * What the code's stages make of the PR, without saving or announcing anything: for taking a model
 * run off an analysis stored before what the code made was kept.
 */
export const codeFields = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
  checkout: CheckoutAt | null,
): Promise<Result<Partial<Analysis> & Required<BeforeModel>, UseCaseError>> => {
  const collected = await collect(deps, host, pullRequest);
  if (!collected.ok) return collected;
  const { files, tickets, missingTicketKeys, warnings } = collected.value;
  const prepared = await prepare(deps, collected.value, checkout);
  return ok({
    files,
    tickets,
    missingTicketKeys,
    ...preparedFields(prepared),
    warnings: [...warnings, ...prepared.prepared.warnings, ...prepared.prepared.checkoutWarnings],
  });
};

/**
 * What a checkout adds to a PR the code's stages read without one. The parts the callers name are
 * the analysis's own, since prep is deterministic and a checkout changes nothing else in it.
 */
export const checkoutFields = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
  checkout: CheckoutAt,
): Promise<Result<Pick<Analysis, "unchangedCallers" | "warnings">, UseCaseError>> => {
  const collected = await collect(deps, host, pullRequest);
  if (!collected.ok) return collected;
  const { prepared, joined } = await prepare(deps, collected.value, checkout);
  return ok({ unchangedCallers: joined.unchangedCallers, warnings: prepared.checkoutWarnings });
};

/**
 * Runs the code's stages on a saved, running analysis until it's complete or failed, leaving the
 * model's stages not run. With `downloading`, a complete one's callers are still to come. Never
 * throws: a bug fails the analysis with code "internal".
 */
export const runPipeline = async (
  deps: AppDeps,
  host: GitHost,
  analysis: Analysis,
  pullRequest: PullRequest,
  checkout: CheckoutAt | null = null,
  downloading = false,
): Promise<void> => {
  const tracker = createTracker(deps, analysis);
  try {
    await codeStages(deps, host, pullRequest, checkout, downloading, tracker);
  } catch (error) {
    deps.logger.error("The analysis pipeline crashed", { analysisId: analysis.id, error });
    await tracker.fail(tracker.lastStage, {
      code: "internal",
      message: "megareviewer hit an internal error during the analysis",
    });
  }
};

const codeStages = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
  checkout: CheckoutAt | null,
  downloading: boolean,
  tracker: Tracker,
): Promise<void> => {
  await tracker.setStage("collect", "running");
  const collected = await collect(deps, host, pullRequest, tracker.setFilesFetched);
  if (!collected.ok) return tracker.fail("collect", collected.error);
  const { files, tickets, missingTicketKeys } = collected.value;
  await tracker.setStage("collect", "done", (analysis) => ({
    files,
    tickets,
    missingTicketKeys,
    ...adding({ warnings: collected.value.warnings })(analysis),
  }));

  await tracker.setStage("prep", "running");
  const prepared = await prepare(deps, collected.value, checkout);
  await tracker.setStage("prep", "done", (analysis) => ({
    ...preparedFields(prepared),
    ...adding({
      warnings: [...prepared.prepared.warnings, ...prepared.prepared.checkoutWarnings],
    })(analysis),
  }));
  for (const stage of MODEL_STAGES) await tracker.setStage(stage, "skipped");
  await tracker.finish(null, downloading);
};

/**
 * Runs the model's passes on a complete analysis, adding intent and findings to it. Collects and
 * preps again from the stored PR first: files come from the file cache, and prep is deterministic.
 * The passes read the reviewer's preferences and the
 * repository's guideline files, which the analysis keeps as the run's guidance. A run that asks for
 * the tour runs the steps pass beside them. A failure of the two is the analysis's `modelError`,
 * and the steps pass's is its `stepsError`; its status stays complete. Never throws.
 */
export const runModel = async (
  deps: AppDeps,
  host: GitHost,
  analysis: Analysis,
  pullRequest: PullRequest,
  run: {
    readonly model: AnalysisModel;
    readonly option: ModelRunOption;
    /** The option's guardrail call; null when its provider can't make it. */
    readonly advisor: GuardrailAdvisor | null;
    readonly tour?: boolean;
  },
): Promise<void> => {
  const tracker = createTracker(deps, analysis);
  try {
    await tracker.save((current) => ({
      beforeModel: keepBeforeModel(current),
      modelError: null,
      modelOption: run.option,
      guidance: null,
      guardrails: null,
      steps: null,
      stepsError: null,
      stages: {
        ...mapModelStages(current.stages, () => "pending"),
        steps: run.tour === true ? "pending" : "skipped",
      },
    }));
    await modelStages(
      deps,
      {
        model: run.tour === true ? askingForTour(run.model) : run.model,
        option: run.option,
        advisor: run.advisor,
      },
      run.tour === true,
      host,
      pullRequest,
      tracker,
    );
  } catch (error) {
    deps.logger.error("The model run crashed", { analysisId: analysis.id, error });
    await tracker.failModel(tracker.lastStage, {
      code: "internal",
      message: `megareviewer hit an internal error while ${modelFamily(run.option)} analyzed the pull request`,
    });
    await tracker.finishGuardrails(null);
  }
};

const noProgress: OnFilesFetched = async () => {};

const modelStages = async (
  deps: AppDeps,
  {
    model,
    option,
    advisor,
  }: {
    readonly model: AnalysisModel;
    readonly option: ModelRunOption;
    readonly advisor: GuardrailAdvisor | null;
  },
  tour: boolean,
  host: GitHost,
  pullRequest: PullRequest,
  tracker: Tracker,
): Promise<void> => {
  const collected = await collect(deps, host, pullRequest, noProgress);
  if (!collected.ok) return tracker.failModel("intent", collected.error);
  // The analysis holds what the checkout gave it, so it isn't read again.
  const { prepared } = await prepare(deps, collected.value, null);
  const { files } = collected.value;

  const read = await runGuidance(deps, pullRequest, {
    readsHarness: model.readsHarness,
    name: `${option.modelName} through ${option.providerName}`,
  });
  const { guidance } = read;
  await tracker.save((analysis) => ({
    guidance,
    // A run tried again reads the same files: what it couldn't send is said once.
    ...adding({
      warnings: read.warnings.filter((warning) => !analysis.warnings.includes(warning)),
    })(analysis),
  }));
  const fitted = await fitToModel(
    model,
    buildAnalysisInput({
      pullRequest,
      tickets: collected.value.tickets,
      files,
      headContents: collected.value.headContents,
      prepared,
      unchangedCallers: tracker.current.unchangedCallers,
      guidance: read.input,
      harness: read.harness,
    }),
  );
  if (!fitted.ok) return tracker.failModel("intent", fitted.error);
  const { input } = fitted.value;
  await tracker.save(adding({ warnings: fitted.value.warnings }));

  const hunks = new Map(
    files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
  );
  const knownHunks = new Set<HunkId>(hunks.keys());
  // The last pass to end says, in the same write, whether the guardrail call runs, so the passes'
  // end is never announced as the run's.
  let ended = 0;
  const ending =
    (patch: (analysis: Analysis) => Partial<Analysis>) =>
    (analysis: Analysis): Partial<Analysis> => {
      const changes = patch(analysis);
      ended += 1;
      if (advisor === null || ended < MODEL_STAGES.length) return changes;
      const next = { ...analysis, ...changes };
      return next.findings.length > 0 ? { ...changes, guardrails: "running" } : changes;
    };

  for (const stage of MODEL_STAGES) await tracker.setStage(stage, "running");
  if (tour) await tracker.setStage(STEPS_STAGE, "running");
  // The intent pass writes the PR to the prompt cache; the steps pass starts once it's there, to
  // read it rather than write it again. A transport that can't tell starts it at the intent's end.
  const { promise: cached, resolve: cacheWritten } = Promise.withResolvers<void>();
  const intentRun = runIntent(model, input, knownHunks, deps, cacheWritten, guidance).then(
    async (result) => {
      cacheWritten();
      await tracker.setStage(
        "intent",
        result.outcome.ok ? "done" : "failed",
        ending((analysis) => ({
          ...(result.outcome.ok ? { intent: result.outcome.value } : {}),
          ...adding(result)(analysis),
        })),
      );
      return result.outcome;
    },
  );
  // Findings read the intent's mismatches, to name the one a finding shows, so they wait for it.
  const findingsRun = intentRun.then(async (intent) => {
    const result = await runFindings(
      model,
      input,
      intent.ok ? intent.value : null,
      hunks,
      deps,
      guidance,
    );
    await tracker.setStage(
      "findings",
      result.outcome.ok ? "done" : "failed",
      ending((analysis) => ({
        ...(result.outcome.ok ? { findings: result.outcome.value } : {}),
        ...adding(result)(analysis),
      })),
    );
    return result.outcome;
  });
  const [intent, findings] = await Promise.all([
    intentRun,
    findingsRun,
    // The tour is optional to the run: its failure is its own, never the run's.
    tour
      ? Promise.race([cached, intentRun])
          .then(() =>
            runSteps(
              model,
              input,
              {
                hunks,
                mechanical: new Set(prepared.proofs.flatMap((proof) => proof.hunkId ?? [])),
                parts: prepared.parts,
                callGraph: prepared.callGraph,
              },
              deps,
              guidance,
            ),
          )
          .then(async (result) => {
            await tracker.setStage(
              STEPS_STAGE,
              result.outcome.ok ? "done" : "failed",
              (analysis) => ({
                steps: result.outcome.ok ? result.outcome.value : [],
                stepsError: result.outcome.ok
                  ? null
                  : {
                      stage: STEPS_STAGE,
                      code: "model-error",
                      message: result.outcome.error.message,
                    },
                ...adding(result)(analysis),
              }),
            );
          })
      : null,
  ]);
  // What finished stays; the first failure is the run's error.
  const failure = [
    { stage: "intent" as const, outcome: intent },
    { stage: "findings" as const, outcome: findings },
  ].find(({ outcome }) => !outcome.ok);
  await tracker.finishModel(
    failure === undefined || failure.outcome.ok
      ? null
      : { stage: failure.stage, code: "model-error", message: failure.outcome.error.message },
  );
  const passed = tracker.current;
  if (advisor === null || passed.guardrails !== "running") return;
  // The call starts once the passes have ended, the steps pass among them.
  await tracker.finishGuardrails(
    await runGuardrailCall(
      deps,
      advisor,
      pullRequest,
      files.map((file) => file.path),
      hunks,
      passed.findings,
    ),
  );
};
