import type { PipelineVersion } from "../../domain/review/index.ts";
import type { AnalysisModel } from "../ports/index.ts";

/** Bump whenever pipeline logic changes what an analysis contains. */
export const PIPELINE_VERSION = "8";

/** Says whether the model ran, so turning it on analyzes again instead of reusing the result. */
export const pipelineVersion = (model: AnalysisModel, modelEnabled: boolean): PipelineVersion =>
  `${PIPELINE_VERSION}+${modelEnabled ? model.version : "no-model"}`;
