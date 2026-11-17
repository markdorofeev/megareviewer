import type { HostError, HostKind, PastComment, RepoRef } from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

export interface ReviewerComments {
  /** Newest first. */
  readonly comments: readonly PastComment[];
  /** How many pull requests were read, with or without a comment of the reviewer's. */
  readonly pullRequests: number;
}

/** What the reviewer has already said on a repository's pull requests. */
export interface ReviewHistory {
  readonly host: HostKind;
  /**
   * The current user's own comments on the code of the most recently updated pull requests of
   * `repo` they reviewed, at most `pullRequests` of them. None reviewed is an empty list.
   */
  getReviewerComments(
    repo: RepoRef,
    options: { readonly pullRequests: number },
  ): Promise<Result<ReviewerComments, HostError>>;
}
