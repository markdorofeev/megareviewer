import { hunkIdOf, renameHints } from "../../src/domain/diff/index.ts";
import { type Analysis, StageName, type StageStatus } from "../../src/domain/review/index.ts";

const STAGES = StageName.options;

/**
 * A complete analysis as it looks while running, after its first `stagesDone` stages: each result
 * appears once the stage that produces it is done, the way the server fills it in.
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
    status: "running",
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

/** The analysis as it looks after `stage` failed: what earlier stages produced, and the error. */
export const analysisFailed = (analysis: Analysis, stage: StageName, message: string): Analysis => {
  const running = analysisInProgress(analysis, STAGES.indexOf(stage));
  return {
    ...running,
    status: "failed",
    stages: { ...running.stages, [stage]: "failed" },
    error: { stage, code: "model-error", message },
  };
};
