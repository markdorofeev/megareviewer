import { createAnalysisRunner } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { createReviewUseCases } from "./review.ts";
import { createStatusUseCases } from "./status.ts";
import { createThreadUseCases } from "./threads.ts";

/** Every use case the HTTP API calls. Expected failures are results with an `ErrorCode`. */
export const createUseCases = (deps: AppDeps, options: { readonly version: string }) => {
  const runner = createAnalysisRunner(deps);
  const review = createReviewUseCases(deps);
  const status = createStatusUseCases(deps, options.version);
  const threads = createThreadUseCases(deps);
  return {
    startAnalysis: runner.startAnalysis,
    retryAnalysis: runner.retryAnalysis,
    runModel: runner.runModel,
    recoverInterruptedAnalyses: runner.recoverInterruptedAnalyses,
    getAnalysisView: review.getAnalysisView,
    getFileContent: review.getFileContent,
    recordPointState: review.recordPointState,
    previewPublication: review.previewPublication,
    publishReview: review.publishReview,
    listPullRequests: status.listPullRequests,
    getStatus: status.getStatus,
    getThreads: threads.getThreads,
    getAttachment: threads.getAttachment,
    replyToThread: threads.replyToThread,
    resolveThread: threads.resolveThread,
    postComment: threads.postComment,
  };
};

export type UseCases = ReturnType<typeof createUseCases>;
