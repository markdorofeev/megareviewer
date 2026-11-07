import { type HunkId, hunkIdOf, renameHints } from "../../domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisError,
  classifyByRules,
  codeTour,
  type FilesFetched,
  joinParts,
  type PullRequest,
  raiseByRules,
  type StageName,
  type StageStatus,
} from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import { collect } from "./collect.ts";
import type { AppDeps } from "./deps.ts";
import type { UseCaseError } from "./errors.ts";
import { buildAnalysisInput, fitToModel } from "./model-input.ts";
import { runDecisions, runIntent, runRisk, runTour } from "./model-passes.ts";
import { prep } from "./prep.ts";

const MODEL_STAGES: readonly StageName[] = ["intent", "risk", "decisions", "tour"];

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
  return {
    get lastStage() {
      return lastStage;
    },
    save,
    setStage,
    setFilesFetched,
    finish,
    fail: async (stage: StageName, failure: UseCaseError) => {
      await setStage(stage, "failed");
      await finish({ stage, ...failure });
    },
  };
};

/** Appends to the analysis's warnings and usage, for patches. */
const adding =
  (added: { warnings?: readonly string[]; usage?: Analysis["usage"] }) => (analysis: Analysis) => ({
    warnings: [...analysis.warnings, ...(added.warnings ?? [])],
    usage: [...analysis.usage, ...(added.usage ?? [])],
  });

/**
 * Runs the pipeline on a saved, running analysis until it's complete or failed. Never throws: a
 * bug fails the analysis with code "internal".
 */
export const runPipeline = async (
  deps: AppDeps,
  host: GitHost,
  analysis: Analysis,
  pullRequest: PullRequest,
): Promise<void> => {
  const tracker = createTracker(deps, analysis);
  try {
    await stages(deps, host, pullRequest, tracker);
  } catch (error) {
    deps.logger.error("The analysis pipeline crashed", { analysisId: analysis.id, error });
    await tracker.fail(tracker.lastStage, {
      code: "internal",
      message: "megareviewer hit an internal error during the analysis",
    });
  }
};

const stages = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
  tracker: ReturnType<typeof createTracker>,
): Promise<void> => {
  const { model, logger } = deps;

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
  const prepared = await prep(deps.parser, collected.value);
  const { proofs, parts, callGraph, required, definitions, generated } = prepared;
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
  const ruleRisk = classifyByRules(files, new Set(proofRisk.map((risk) => risk.hunkId)));
  // Until the tour places the parts, every hunk is whole.
  const prepPatch = {
    proofs,
    callGraph: renameHints(callGraph, hunkIdOf),
    fileLinks: prepared.fileLinks,
    generated: [...generated].sort(),
  };

  // Without the model, risk comes from proofs and rules and the tour from the call graph.
  if (!deps.modelEnabled) {
    const risk = [...proofRisk, ...ruleRisk];
    const tour = codeTour({ files, required, parts, callGraph, risk, definitions, generated });
    await tracker.setStage("prep", "done", (analysis) => ({
      ...prepPatch,
      risk,
      ...joinParts(tour, parts, callGraph),
      ...adding(prepared)(analysis),
    }));
    for (const stage of MODEL_STAGES) await tracker.setStage(stage, "skipped");
    return tracker.finish(null);
  }

  const fitted = await fitToModel(
    model,
    buildAnalysisInput({
      pullRequest,
      tickets,
      files,
      headContents: collected.value.headContents,
      prepared,
    }),
  );
  if (!fitted.ok) {
    await tracker.save((analysis) => ({ ...prepPatch, ...adding(prepared)(analysis) }));
    return tracker.fail("prep", fitted.error);
  }
  const { input } = fitted.value;
  await tracker.setStage("prep", "done", (analysis) => ({
    ...prepPatch,
    ...adding({ warnings: [...prepared.warnings, ...fitted.value.warnings] })(analysis),
  }));

  const knownHunks = new Set<HunkId>(files.flatMap((file) => file.hunks.map((hunk) => hunk.id)));

  await tracker.setStage("intent", "running");
  const intentResult = await runIntent(model, input, knownHunks, logger);
  await tracker.save(adding(intentResult));
  if (!intentResult.outcome.ok) {
    return tracker.fail("intent", {
      code: "model-error",
      message: intentResult.outcome.error.message,
    });
  }
  const intent = intentResult.outcome.value;
  await tracker.setStage("intent", "done", { intent });

  await tracker.setStage("risk", "running");
  await tracker.setStage("decisions", "running");
  const [risk, decisions] = await Promise.all([
    runRisk(model, input, intent, required, logger).then(async (result) => {
      const assessments = result.outcome.ok
        ? [...proofRisk, ...raiseByRules(result.outcome.value.assessments, ruleRisk)]
        : [];
      await tracker.setStage("risk", result.outcome.ok ? "done" : "failed", (analysis) => ({
        ...(result.outcome.ok ? { risk: assessments } : {}),
        ...adding(result)(analysis),
      }));
      return result.outcome.ok ? ok({ ...result.outcome.value, assessments }) : result.outcome;
    }),
    runDecisions(model, input, intent, knownHunks, logger).then(async (result) => {
      await tracker.setStage("decisions", result.outcome.ok ? "done" : "failed", (analysis) => ({
        ...(result.outcome.ok ? { decisions: result.outcome.value } : {}),
        ...adding(result)(analysis),
      }));
      return result.outcome;
    }),
  ]);
  if (!risk.ok) {
    return tracker.finish({ stage: "risk", code: "model-error", message: risk.error.message });
  }
  if (!decisions.ok) {
    return tracker.finish({
      stage: "decisions",
      code: "model-error",
      message: decisions.error.message,
    });
  }

  await tracker.setStage("tour", "running");
  const tour = await runTour(
    model,
    input,
    {
      intent,
      risk: risk.value.forTour,
      decisions: decisions.value,
      files,
      required,
      parts,
      callGraph,
      definitions,
      generated,
      assessments: risk.value.assessments,
    },
    logger,
  );
  await tracker.setStage("tour", "done", (analysis) => ({
    ...joinParts(tour.tour, parts, callGraph),
    ...adding(tour)(analysis),
  }));

  await tracker.finish(null);
};
