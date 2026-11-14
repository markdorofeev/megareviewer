import type {
  HostError,
  HostKind,
  PullRequestRef,
  PullRequestStatus,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** Where a PR stands on its host: its state, reviewers and CI. Read live, never written. */
export interface PullRequestStatusSource {
  readonly host: HostKind;
  /**
   * The PR's state and reviewers now, and the checks on `headSha`: the commit the reviewer reads,
   * which may be behind the PR's latest. Checks the host won't show are null with a reason, not
   * a failed read.
   */
  getStatus(ref: PullRequestRef, headSha: string): Promise<Result<PullRequestStatus, HostError>>;
}
