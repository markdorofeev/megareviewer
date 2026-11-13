import { hunkIdOf, renameHints } from "../../src/domain/diff/index.ts";
import {
  type Analysis,
  MODEL_STAGES,
  mapModelStages,
  StageName,
  type StageStatus,
} from "../../src/domain/review/index.ts";

const STAGES = StageName.options;

const isModelStage = (stage: StageName): boolean =>
  (MODEL_STAGES as readonly StageName[]).includes(stage);
const CODE_STAGE_COUNT = STAGES.filter((stage) => !isModelStage(stage)).length;

/**
 * A complete analysis as it looks while running, after its first `stagesDone` stages: each result
 * appears once the stage that produces it is done, the way the server fills it in. The code's
 * stages run with the analysis running; the model's, once asked for, run on the complete one.
 */
export const analysisInProgress = (analysis: Analysis, stagesDone: number): Analysis => {
  if (stagesDone >= STAGES.length) return analysis;
  const status = (stage: StageName): StageStatus => {
    const index = STAGES.indexOf(stage);
    return index < stagesDone ? "done" : index === stagesDone ? "running" : "pending";
  };
  const done = (stage: StageName): boolean => status(stage) === "done";
  return {
    ...analysis,
    // Past the code's stages, the analysis is complete and the model runs on it.
    status: stagesDone >= CODE_STAGE_COUNT ? "complete" : "running",
    stages: {
      collect: status("collect"),
      prep: status("prep"),
      intent: status("intent"),
      risk: status("risk"),
      decisions: status("decisions"),
      tour: status("tour"),
    },
    pullRequest: done("collect") ? analysis.pullRequest : null,
    tickets: done("collect") ? analysis.tickets : [],
    missingTicketKeys: done("collect") ? analysis.missingTicketKeys : [],
    files: done("prep") ? analysis.files : [],
    proofs: done("prep") ? analysis.proofs : [],
    // Parts come with the tour; until then every hunk is whole.
    parts: done("tour") ? analysis.parts : [],
    callGraph: done("tour")
      ? analysis.callGraph
      : done("prep")
        ? renameHints(analysis.callGraph, hunkIdOf)
        : [],
    intent: done("intent") ? analysis.intent : null,
    risk: done("risk")
      ? analysis.risk
      : done("prep")
        ? analysis.risk.filter((assessment) => assessment.source === "proof")
        : [],
    decisions: done("decisions") ? analysis.decisions : [],
    tour: done("tour") ? analysis.tour : null,
    warnings: [],
    usage: analysis.usage.filter((usage) => done(usage.pass)),
    error: null,
  };
};

/**
 * The analysis as it looks after `stage` failed: what earlier stages produced, and the error. A
 * model stage's failure leaves the analysis complete, with the model's error and the stages after
 * it not run.
 */
export const analysisFailed = (analysis: Analysis, stage: StageName, message: string): Analysis => {
  const running = analysisInProgress(analysis, STAGES.indexOf(stage));
  const error = { stage, code: isModelStage(stage) ? "model-error" : "internal", message };
  if (!isModelStage(stage)) {
    return {
      ...running,
      status: "failed",
      stages: { ...running.stages, [stage]: "failed" },
      error,
    };
  }
  return {
    ...running,
    status: "complete",
    stages: mapModelStages({ ...running.stages, [stage]: "failed" }, (status) =>
      status === "pending" ? "skipped" : status,
    ),
    modelError: error,
  };
};
