import type { AnalysisKey, PipelineVersion, PullRequest } from "../../domain/review/index.ts";

/**
 * Bump whenever pipeline logic changes what an analysis contains. Whether a checkout was read isn't
 * in it, nor is the model: both add to the analysis.
 */
export const PIPELINE_VERSION: PipelineVersion = "21";

/** Analyses stored while the key said a checkout was read have this after the version. */
const CHECKOUT_READ = "+checkout";

export const keyOf = (pullRequest: Pick<PullRequest, "ref" | "headSha">): AnalysisKey => ({
  ref: pullRequest.ref,
  headSha: pullRequest.headSha,
  pipelineVersion: PIPELINE_VERSION,
});

/** Every key the pull request's analysis at its head commit can be stored under. */
export const keysOf = (
  pullRequest: Pick<PullRequest, "ref" | "headSha">,
): readonly AnalysisKey[] => {
  const key = keyOf(pullRequest);
  return [key, { ...key, pipelineVersion: `${PIPELINE_VERSION}${CHECKOUT_READ}` }];
};
