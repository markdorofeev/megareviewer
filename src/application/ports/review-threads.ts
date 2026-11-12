import type {
  HostError,
  HostKind,
  PullRequestRef,
  ThreadComment,
  ThreadId,
  ThreadList,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** An image or video pasted into a comment, as its host stores it. */
export interface Attachment {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** Attachments past this aren't fetched: the page shows them as named, not loaded. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * The conversation on a PR's code: its review threads, read live and written at once. Writes are
 * never retried: one that failed on the network may still have happened.
 */
export interface ReviewThreads {
  readonly host: HostKind;
  /** Every thread on the PR's lines. */
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
   * An image or video in the host's own attachment store (`attachmentHost` says which URLs),
   * fetched with the reviewer's credentials. Any other URL is not-found, and one over
   * MAX_ATTACHMENT_BYTES is too-large.
   */
  getAttachment(url: string): Promise<Result<Attachment, HostError>>;
}
