import type {
  HostError,
  HostKind,
  PullRequestRef,
  ThreadComment,
  ThreadId,
  ThreadList,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** Files to commit on a PR's branch, on top of the head the reviewer looked at. */
export interface SuggestionCommit {
  /** The commit's parent. The host refuses the commit when the branch has moved past it. */
  readonly headSha: string;
  readonly message: string;
  /** Each file's whole new content. */
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

/**
 * The conversation on a PR's code: its review threads, read live and written at once. Writes are
 * never retried: one that failed on the network may still have happened.
 */
export interface ReviewThreads {
  readonly host: HostKind;
  /** Every thread on the PR's lines, and whether the current user may push to its branch. */
  getThreads(ref: PullRequestRef): Promise<Result<ThreadList, HostError>>;
  /** Posts a reply at the end of a thread. */
  reply(
    ref: PullRequestRef,
    threadId: ThreadId,
    body: string,
  ): Promise<Result<ThreadComment, HostError>>;
  setResolved(
    ref: PullRequestRef,
    threadId: ThreadId,
    resolved: boolean,
  ): Promise<Result<null, HostError>>;
  /**
   * One commit on the PR's source branch, its parent `headSha`. Refused as "rejected" when the
   * branch isn't at `headSha`, so a suggestion never lands on code nobody looked at. The new
   * commit's SHA, when the host gives it.
   */
  applySuggestions(
    ref: PullRequestRef,
    commit: SuggestionCommit,
  ): Promise<Result<{ readonly sha: string | null }, HostError>>;
}
