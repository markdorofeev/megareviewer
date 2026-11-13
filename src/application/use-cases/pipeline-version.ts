import type { PipelineVersion } from "../../domain/review/index.ts";

/** Bump whenever pipeline logic changes what an analysis contains. */
export const PIPELINE_VERSION = "18";

/**
 * Says whether a local checkout was read, so a checkout that gains the PR's head commit analyzes
 * again instead of reusing the result. The model isn't in it: its passes add to the analysis.
 */
export const pipelineVersion = (checkoutRead: boolean): PipelineVersion =>
  `${PIPELINE_VERSION}${checkoutRead ? "+checkout" : ""}`;
