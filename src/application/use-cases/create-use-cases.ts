import { createAnalysisRunner } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { createReviewUseCases } from "./review.ts";
import { createStatusUseCases } from "./status.ts";

/** Every use case the HTTP API calls. Expected failures are results with an `ErrorCode`. */
export const createUseCases = (deps: AppDeps, options: { readonly version: string }) => {
  const runner = createAnalysisRunner(deps);
  const review = createReviewUseCases(deps);
  const status = createStatusUseCases(deps, options.version);
  return {
    startAnalysis: runner.startAnalysis,
    retryAnalysis: runner.retryAnalysis,
    recoverInterruptedAnalyses: runner.recoverInterruptedAnalyses,
    getAnalysisView: review.getAnalysisView,
    getFileContent: review.getFileContent,
    recordVerdict: review.recordVerdict,
    previewPublication: review.previewPublication,
    publishReview: review.publishReview,
    listPullRequests: status.listPullRequests,
    getStatus: status.getStatus,
  };
};

export type UseCases = ReturnType<typeof createUseCases>;
