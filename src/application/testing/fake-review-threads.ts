import {
  attachmentHost,
  type HostError,
  type HostKind,
  type HostUser,
  type PullRequestRef,
  type ReviewThread,
  type ThreadComment,
  type ThreadId,
  type ThreadList,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { Attachment, Clock, NewThread, ReviewThreads } from "../ports/index.ts";
import { FixedClock } from "./fixed-clock.ts";
import { fixtureReviewers } from "./fixtures/index.ts";

export type ReviewThreadsMethod =
  | "getThreads"
  | "reply"
  | "comment"
  | "setResolved"
  | "getAttachment";

const prKey = (ref: PullRequestRef): string =>
  `${ref.repo.host}/${ref.repo.owner}/${ref.repo.repo}#${ref.number}`;

const notFound = (what: string): HostError => ({
  kind: "not-found",
  message: `${what} not found`,
  retryAfterSeconds: null,
});

export class FakeReviewThreads implements ReviewThreads {
  readonly host: HostKind;
  private readonly user: HostUser;
  private readonly clock: Clock;
  private readonly lists = new Map<string, ReviewThread[]>();
  private readonly failures = new Map<ReviewThreadsMethod, HostError[]>();
  private readonly attachments = new Map<string, Attachment>();
  private nextId = 1;

  constructor(options: {
    host: HostKind;
    user?: HostUser;
    clock?: Clock;
  }) {
    this.host = options.host;
    this.user = options.user ?? fixtureReviewers[options.host];
    this.clock = options.clock ?? new FixedClock();
  }

  setThreads(ref: PullRequestRef, list: ThreadList): void {
    this.lists.set(prKey(ref), structuredClone([...list.threads]));
  }

  /** Stores an attachment at `url`, which must be one of this host's attachment URLs. */
  setAttachment(url: string, attachment: Attachment): void {
    this.attachments.set(url, attachment);
  }

  async getAttachment(url: string): Promise<Result<Attachment, HostError>> {
    const failure = this.fail("getAttachment");
    if (failure !== null) return failure;
    const found = attachmentHost(url) === this.host ? this.attachments.get(url) : undefined;
    return found === undefined ? err(notFound(`attachment ${url}`)) : ok(found);
  }

  /** The next call to `method` fails with `error`. Failures queue up per method. */
  failNext(method: ReviewThreadsMethod, error: HostError): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), error]);
  }

  async getThreads(ref: PullRequestRef): Promise<Result<ThreadList, HostError>> {
    const failure = this.fail("getThreads");
    if (failure !== null) return failure;
    const list = this.lists.get(prKey(ref));
    return ok({ threads: list === undefined ? [] : structuredClone(list) });
  }

  async reply(
    ref: PullRequestRef,
    threadId: ThreadId,
    body: string,
  ): Promise<Result<ThreadComment, HostError>> {
    const failure = this.fail("reply");
    if (failure !== null) return failure;
    const found = this.find(ref, threadId);
    if (found === null) return err(notFound(`thread ${threadId}`));
    const comment: ThreadComment = {
      id: `fake_reply_${this.nextId++}`,
      author: { ...this.user },
      body,
      createdAt: this.clock.now(),
      originalCommit: found.thread.comments[0]?.originalCommit ?? null,
    };
    found.replace({ ...found.thread, comments: [...found.thread.comments, comment] });
    return ok(structuredClone(comment));
  }

  /** A new thread, as the host would list it. */
  async comment(ref: PullRequestRef, comment: NewThread): Promise<Result<null, HostError>> {
    const failure = this.fail("comment");
    if (failure !== null) return failure;
    const id = this.nextId++;
    const thread: ReviewThread = {
      id: `fake_thread_${id}`,
      path: comment.path,
      side: comment.side,
      line: comment.line,
      startLine: comment.startLine ?? null,
      originalLine: comment.line,
      resolved: false,
      resolvedBy: null,
      outdated: false,
      can: { reply: true, resolve: true },
      comments: [
        {
          id: `fake_comment_${id}`,
          author: { ...this.user },
          body: comment.body,
          createdAt: this.clock.now(),
          originalCommit: comment.headSha,
        },
      ],
    };
    this.lists.set(prKey(ref), [...(this.lists.get(prKey(ref)) ?? []), thread]);
    return ok(null);
  }

  async setResolved(
    ref: PullRequestRef,
    threadId: ThreadId,
    resolved: boolean,
  ): Promise<Result<null, HostError>> {
    const failure = this.fail("setResolved");
    if (failure !== null) return failure;
    const found = this.find(ref, threadId);
    if (found === null) return err(notFound(`thread ${threadId}`));
    found.replace({
      ...found.thread,
      resolved,
      resolvedBy: resolved ? { ...this.user } : null,
    });
    return ok(null);
  }

  private find(ref: PullRequestRef, threadId: ThreadId) {
    const list = this.lists.get(prKey(ref));
    const at = list?.findIndex((thread) => thread.id === threadId) ?? -1;
    const thread = list?.[at];
    if (list === undefined || thread === undefined) return null;
    return {
      thread,
      replace: (next: ReviewThread) => {
        list[at] = next;
      },
    };
  }

  private fail(method: ReviewThreadsMethod): Result<never, HostError> | null {
    const failure = this.failures.get(method)?.shift();
    return failure === undefined ? null : err(failure);
  }
}
