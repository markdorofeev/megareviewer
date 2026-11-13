import type { HunkId } from "../../domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisError,
  classifyByRules,
  codeTour,
  type FilesFetched,
  joinParts,
  MODEL_STAGES,
  mapModelStages,
  type PullRequest,
  raiseByRules,
  type StageName,
  type StageStatus,
} from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import { type Collected, collect, type OnFilesFetched } from "./collect.ts";
import type { AppDeps } from "./deps.ts";
import type { UseCaseError } from "./errors.ts";
import { buildAnalysisInput, fitToModel } from "./model-input.ts";
import { runDecisions, runFindings, runIntent, runRisk, runTour } from "./model-passes.ts";
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
  const finish = async (error: AnalysisError | null) => {
    await save({ status: error === null ? "complete" : "failed", error });
    deps.events.emit(analysis.id, { type: "done" });
  };
  /** Ends a model run. Passes it didn't reach go back to not run; the analysis stays complete. */
  const finishModel = async (modelError: AnalysisError | null) => {
    await save((current) => ({
      modelError,
      stages: mapModelStages(current.stages, (status) =>
        status === "pending" ? "skipped" : status,
      ),
    }));
    deps.events.emit(analysis.id, { type: "done" });
  };
  return {
    get lastStage() {
      return lastStage;
    },
    save,
    setStage,
    setFilesFetched,
    finish,
    finishModel,
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

/** Appends to the analysis's warnings and usage, for patches. */
const adding =
  (added: { warnings?: readonly string[]; usage?: Analysis["usage"] }) => (analysis: Analysis) => ({
    warnings: [...analysis.warnings, ...(added.warnings ?? [])],
    usage: [...analysis.usage, ...(added.usage ?? [])],
  });

/** What the code alone makes of a collected PR: proofs, risk from rules, and the code's tour. */
const prepare = async (deps: AppDeps, collected: Collected, checkout: CheckoutAt | null) => {
  const prepared = await prep(deps.parser, collected, checkout);
  const {
    proofs,
    parts,
    callGraph,
    callSites,
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
  // The tour is the code's with or without the model, ordered by the rules' risk; the model
  // only titles it.
  const skeleton = codeTour({
    files: collected.files,
    required,
    parts,
    callGraph,
    risk: [...proofRisk, ...ruleRisk],
    definitions,
    generated,
  });
  const joined = joinParts(skeleton, parts, callGraph, unchangedCallers, callSites);
  return { prepared, proofRisk, ruleRisk, skeleton, joined };
};

/**
 * Runs the code's stages on a saved, running analysis until it's complete or failed, leaving the
 * model's stages not run. Never throws: a bug fails the analysis with code "internal".
 */
export const runPipeline = async (
  deps: AppDeps,
  host: GitHost,
  analysis: Analysis,
  pullRequest: PullRequest,
  checkout: CheckoutAt | null = null,
): Promise<void> => {
  const tracker = createTracker(deps, analysis);
  try {
    await codeStages(deps, host, pullRequest, checkout, tracker);
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
  const { prepared, proofRisk, ruleRisk, joined } = await prepare(deps, collected.value, checkout);
  await tracker.setStage("prep", "done", (analysis) => ({
    proofs: prepared.proofs,
    ...joined,
    fileLinks: prepared.fileLinks,
    generated: [...prepared.generated].sort(),
    risk: [...proofRisk, ...ruleRisk],
    ...adding(prepared)(analysis),
  }));
  for (const stage of MODEL_STAGES) await tracker.setStage(stage, "skipped");
  await tracker.finish(null);
};

/**
 * Runs the model's passes on a complete analysis, adding intent, findings, decisions, the model's
 * risk and the tour's titles to it. Collects and preps again from the stored PR first: files come from
 * the file cache, and prep is deterministic. A failure is the analysis's `modelError`; its
 * status stays complete. Never throws.
 */
export const runModel = async (
  deps: AppDeps,
  host: GitHost,
  analysis: Analysis,
  pullRequest: PullRequest,
  checkout: CheckoutAt | null = null,
): Promise<void> => {
  const tracker = createTracker(deps, analysis);
  try {
    await tracker.save((current) => ({
      modelError: null,
      stages: mapModelStages(current.stages, () => "pending"),
    }));
    await modelStages(deps, host, pullRequest, checkout, tracker);
  } catch (error) {
    deps.logger.error("The model run crashed", { analysisId: analysis.id, error });
    await tracker.failModel(tracker.lastStage, {
      code: "internal",
      message: "megareviewer hit an internal error while Claude analyzed the pull request",
    });
  }
};

const noProgress: OnFilesFetched = async () => {};

const modelStages = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
  checkout: CheckoutAt | null,
  tracker: Tracker,
): Promise<void> => {
  const { model } = deps;

  const collected = await collect(deps, host, pullRequest, noProgress);
  if (!collected.ok) return tracker.failModel("intent", collected.error);
  const { prepared, proofRisk, ruleRisk, skeleton, joined } = await prepare(
    deps,
    collected.value,
    checkout,
  );
  const { files } = collected.value;
  const { parts, callGraph, callSites, required, unchangedCallers } = prepared;

  const fitted = await fitToModel(
    model,
    buildAnalysisInput({
      pullRequest,
      tickets: collected.value.tickets,
      files,
      headContents: collected.value.headContents,
      prepared,
    }),
  );
  if (!fitted.ok) return tracker.failModel("intent", fitted.error);
  const { input } = fitted.value;
  await tracker.save(adding({ warnings: fitted.value.warnings }));

  const hunks = new Map(
    files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
  );
  const knownHunks = new Set<HunkId>(hunks.keys());

  await tracker.setStage("intent", "running");
  const intentResult = await runIntent(model, input, knownHunks, deps);
  await tracker.save(adding(intentResult));
  if (!intentResult.outcome.ok) {
    return tracker.failModel("intent", {
      code: "model-error",
      message: intentResult.outcome.error.message,
    });
  }
  const intent = intentResult.outcome.value;
  await tracker.setStage("intent", "done", { intent });

  await tracker.setStage("findings", "running");
  await tracker.setStage("risk", "running");
  await tracker.setStage("decisions", "running");
  const [findings, risk, decisions] = await Promise.all([
    runFindings(model, input, intent, hunks, deps).then(async (result) => {
      await tracker.setStage("findings", result.outcome.ok ? "done" : "failed", (analysis) => ({
        ...(result.outcome.ok ? { findings: result.outcome.value } : {}),
        ...adding(result)(analysis),
      }));
      return result.outcome;
    }),
    runRisk(model, input, intent, required, deps).then(async (result) => {
      const assessments = result.outcome.ok
        ? [...proofRisk, ...raiseByRules(result.outcome.value.assessments, ruleRisk)]
        : [];
      await tracker.setStage("risk", result.outcome.ok ? "done" : "failed", (analysis) => ({
        ...(result.outcome.ok ? { risk: assessments } : {}),
        ...adding(result)(analysis),
      }));
      return result.outcome.ok ? ok({ ...result.outcome.value, assessments }) : result.outcome;
    }),
    runDecisions(model, input, intent, hunks, deps).then(async (result) => {
      await tracker.setStage("decisions", result.outcome.ok ? "done" : "failed", (analysis) => ({
        ...(result.outcome.ok ? { decisions: result.outcome.value } : {}),
        ...adding(result)(analysis),
      }));
      return result.outcome;
    }),
  ]);
  // What finished stays; the first failure is the run's error.
  const failure = !findings.ok
    ? { stage: "findings" as const, message: findings.error.message }
    : !risk.ok
      ? { stage: "risk" as const, message: risk.error.message }
      : !decisions.ok
        ? { stage: "decisions" as const, message: decisions.error.message }
        : null;
  if (!risk.ok || !decisions.ok) {
    return tracker.finishModel(failure === null ? null : { ...failure, code: "model-error" });
  }

  await tracker.setStage("tour", "running");
  const tour = await runTour(
    model,
    input,
    {
      intent,
      risk: risk.value.forTour,
      decisions: decisions.value,
      skeleton,
      view: { tour: joined.tour, parts: joined.parts },
    },
    deps,
  );
  await tracker.setStage("tour", "done", (analysis) => ({
    ...joinParts(tour.tour, parts, callGraph, unchangedCallers, callSites),
    ...adding(tour)(analysis),
  }));

  await tracker.finishModel(failure === null ? null : { ...failure, code: "model-error" });
};
