import {
  type Analysis,
  MODEL_STAGES,
  mapModelStages,
  STEPS_STAGE,
  StageName,
  type StageStatus,
} from "../../src/domain/review/index.ts";

// The mock runs never ask for the tour.
const STAGES: readonly StageName[] = StageName.options.filter((stage) => stage !== STEPS_STAGE);

const isModelStage = (stage: StageName): boolean =>
  (MODEL_STAGES as readonly StageName[]).includes(stage);
export const CODE_STAGE_COUNT = STAGES.filter((stage) => !isModelStage(stage)).length;

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
      findings: status("findings"),
      steps: "skipped",
    },
    pullRequest: done("collect") ? analysis.pullRequest : null,
    tickets: done("collect") ? analysis.tickets : [],
    missingTicketKeys: done("collect") ? analysis.missingTicketKeys : [],
    files: done("prep") ? analysis.files : [],
    proofs: done("prep") ? analysis.proofs : [],
    parts: done("prep") ? analysis.parts : [],
    callGraph: done("prep") ? analysis.callGraph : [],
    intent: done("intent") ? analysis.intent : null,
    findings: done("findings") ? analysis.findings : [],
    risk: done("prep") ? analysis.risk : [],
    flows: done("prep") ? analysis.flows : null,
    warnings: [],
    usage: analysis.usage.filter(({ pass }) => {
      const stage = StageName.safeParse(pass);
      return stage.success && done(stage.data);
    }),
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
