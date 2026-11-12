import type {
  CommentKey,
  HostError,
  HostKind,
  HostUser,
  Publication,
  PublicationReceipt,
  PullRequest,
  PullRequestRef,
  PullRequestSummary,
  RepoRef,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** A file at a commit. */
export interface FileAt {
  readonly sha: string;
  readonly path: string;
}

export interface PublishOptions {
  /** The head SHA the comments' line numbers refer to. */
  readonly headSha: string;
  /** Keys already posted by an earlier, partly failed attempt. Never posted again. */
  readonly alreadyPosted: ReadonlySet<CommentKey>;
  /** Called once per posted key, as soon as the host confirms it. */
  readonly onPosted: (key: CommentKey, hostCommentId: string) => Promise<void>;
}

export interface GitHost {
  readonly host: HostKind;
  currentUser(): Promise<Result<HostUser, HostError>>;
  getPullRequest(ref: PullRequestRef): Promise<Result<PullRequest, HostError>>;
  /**
   * File contents at commits, in the order of `files`: null for a file that doesn't exist at its
   * commit or that the host won't serve because it's too large. Hosts that can fetch many files
   * in one request do, so fewer requests can fail.
   */
  getFiles(
    repo: RepoRef,
    files: readonly FileAt[],
  ): Promise<Result<readonly (string | null)[], HostError>>;
  /** Open PRs where the current user is a requested reviewer or the author. */
  listPullRequests(): Promise<Result<PullRequestSummary[], HostError>>;
  /**
   * The PRs among `refs` that are still open, as PRs to review, keeping each ref as given. A
   * merged, declined or closed PR is left out, and so is one the host doesn't find or won't
   * show.
   */
  getOpenPullRequests(
    refs: readonly PullRequestRef[],
  ): Promise<Result<PullRequestSummary[], HostError>>;
  /**
   * Publishes the summary (key "summary") and the inline comments with the verdict.
   * Skips keys in alreadyPosted and calls onPosted for every key it posts, so the caller
   * can persist progress (Bitbucket posts comments one by one). The receipt lists the
   * comments this call posted.
   */
  publish(
    ref: PullRequestRef,
    publication: Publication,
    options: PublishOptions,
  ): Promise<Result<PublicationReceipt, HostError>>;
}
