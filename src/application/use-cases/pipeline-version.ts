import type { PipelineVersion } from "../../domain/review/index.ts";
import type { AnalysisModel } from "../ports/index.ts";

/** Bump whenever pipeline logic changes what an analysis contains. */
export const PIPELINE_VERSION = "10";

/**
 * Says whether the model ran and whether a local checkout was read, so turning either on analyzes
 * again instead of reusing the result.
 */
export const pipelineVersion = (
  model: AnalysisModel,
  modelEnabled: boolean,
  checkoutRead: boolean,
): PipelineVersion =>
  `${PIPELINE_VERSION}+${modelEnabled ? model.version : "no-model"}${checkoutRead ? "+checkout" : ""}`;
