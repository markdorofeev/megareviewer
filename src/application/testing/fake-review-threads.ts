import type {
  HostError,
  HostKind,
  HostUser,
  PullRequestRef,
  ReviewThread,
  ThreadComment,
  ThreadId,
  ThreadList,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { Clock, GitHost, ReviewThreads, SuggestionCommit } from "../ports/index.ts";
import { FixedClock } from "./fixed-clock.ts";
import { fixtureReviewers } from "./fixtures/index.ts";

export type ReviewThreadsMethod = "getThreads" | "reply" | "setResolved" | "applySuggestions";

/** A commit the fake made on a PR's branch. */
export interface FakeCommit extends SuggestionCommit {
  readonly ref: PullRequestRef;
  readonly sha: string;
}

const prKey = (ref: PullRequestRef): string =>
  `${ref.repo.host}/${ref.repo.owner}/${ref.repo.repo}#${ref.number}`;

const notFound = (what: string): HostError => ({
  kind: "not-found",
  message: `${what} not found`,
  retryAfterSeconds: null,
});

/**
 * Threads kept in memory. With a fake git host, its PR's head is the branch tip, and a commit
 * moves it, as a push would.
 */
export class FakeReviewThreads implements ReviewThreads {
  readonly host: HostKind;
  /** Every commit applied, in order. */
  readonly commits: FakeCommit[] = [];
  private readonly user: HostUser;
  private readonly clock: Clock;
  private readonly lists = new Map<string, { threads: ReviewThread[]; canApply: boolean }>();
  private readonly heads = new Map<string, string>();
  private readonly gitHost:
    | (GitHost & { setHeadSha(ref: PullRequestRef, sha: string): void })
    | null;
  private readonly failures = new Map<ReviewThreadsMethod, HostError[]>();
  private nextId = 1;

  constructor(options: {
    host: HostKind;
    user?: HostUser;
    clock?: Clock;
    gitHost?: GitHost & { setHeadSha(ref: PullRequestRef, sha: string): void };
  }) {
    this.host = options.host;
    this.user = options.user ?? fixtureReviewers[options.host];
    this.clock = options.clock ?? new FixedClock();
    this.gitHost = options.gitHost ?? null;
  }

  /** Seeds a PR's threads; `headSha` is its branch tip when there's no fake git host. */
  setThreads(ref: PullRequestRef, list: ThreadList, headSha?: string): void {
    this.lists.set(prKey(ref), {
      threads: structuredClone([...list.threads]),
      canApply: list.canApply,
    });
    if (headSha !== undefined) this.heads.set(prKey(ref), headSha);
  }

  /** The next call to `method` fails with `error`. Failures queue up per method. */
  failNext(method: ReviewThreadsMethod, error: HostError): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), error]);
  }

  async getThreads(ref: PullRequestRef): Promise<Result<ThreadList, HostError>> {
    const failure = this.fail("getThreads");
    if (failure !== null) return failure;
    const list = this.lists.get(prKey(ref));
    return ok(
      list === undefined
        ? { threads: [], canApply: false }
        : { threads: structuredClone(list.threads), canApply: list.canApply },
    );
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

  async applySuggestions(
    ref: PullRequestRef,
    commit: SuggestionCommit,
  ): Promise<Result<{ readonly sha: string | null }, HostError>> {
    const failure = this.fail("applySuggestions");
    if (failure !== null) return failure;
    const tip = await this.tipOf(ref);
    if (tip === null) return err(notFound(`pull request ${prKey(ref)}`));
    if (tip !== commit.headSha) {
      return err({
        kind: "rejected",
        message: "The branch has moved since; nothing was committed.",
        retryAfterSeconds: null,
      });
    }
    const sha = (this.commits.length + 1).toString(16).padStart(40, "c");
    this.commits.push({ ...structuredClone(commit), ref: structuredClone(ref), sha });
    this.heads.set(prKey(ref), sha);
    this.gitHost?.setHeadSha(ref, sha);
    return ok({ sha });
  }

  private async tipOf(ref: PullRequestRef): Promise<string | null> {
    if (this.gitHost === null) return this.heads.get(prKey(ref)) ?? null;
    const pullRequest = await this.gitHost.getPullRequest(ref);
    return pullRequest.ok ? pullRequest.value.headSha : null;
  }

  private find(ref: PullRequestRef, threadId: ThreadId) {
    const list = this.lists.get(prKey(ref));
    const at = list?.threads.findIndex((thread) => thread.id === threadId) ?? -1;
    const thread = list?.threads[at];
    if (list === undefined || thread === undefined) return null;
    return {
      thread,
      replace: (next: ReviewThread) => {
        list.threads[at] = next;
      },
    };
  }

  private fail(method: ReviewThreadsMethod): Result<never, HostError> | null {
    const failure = this.failures.get(method)?.shift();
    return failure === undefined ? null : err(failure);
  }
}
