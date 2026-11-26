import type { AnalysisKey, PipelineVersion, PullRequest } from "../../domain/review/index.ts";

/**
 * Bump whenever pipeline logic changes what an analysis contains. Whether a checkout was read isn't
 * in it, nor is the model: both add to the analysis.
 */
export const PIPELINE_VERSION: PipelineVersion = "23";

export const keyOf = (pullRequest: Pick<PullRequest, "ref" | "headSha">): AnalysisKey => ({
  ref: pullRequest.ref,
  headSha: pullRequest.headSha,
  pipelineVersion: PIPELINE_VERSION,
});
