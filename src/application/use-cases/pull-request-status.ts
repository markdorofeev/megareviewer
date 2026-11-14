import type { AnalysisId, PullRequestStatus } from "../../domain/review/index.ts";
import { err, type Result } from "../../domain/shared/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";

/** Where a PR stands on its host: read live, like its threads, never part of an analysis. */
export const createPullRequestStatusUseCases = (deps: AppDeps) => ({
  /**
   * The PR's state and reviewers now, with the checks on the analysis's head: the commit the
   * reviewer reads, not a newer push.
   */
  async getPullRequestStatus(id: AnalysisId): Promise<Result<PullRequestStatus, UseCaseError>> {
    const analysis = await deps.store.getAnalysis(id);
    if (analysis === null) return err(appError("not-found", `No analysis ${id}`));
    const { ref, headSha } = analysis.key;
    const source = deps.statuses[ref.repo.host];
    if (source === undefined) {
      return err(appError("host-not-configured", `${ref.repo.host} isn't configured`));
    }
    const status = await source.getStatus(ref, headSha);
    return status.ok ? status : err(fromHostError(status.error));
  },
});
