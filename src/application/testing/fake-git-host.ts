import {
  CommentKey,
  type HostError,
  type HostKind,
  type HostUser,
  type Publication,
  type PublicationReceipt,
  type PullRequest,
  type PullRequestRef,
  type PullRequestSummary,
  type RepoRef,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { Clock, FileAt, GitHost, PublishOptions } from "../ports/index.ts";
import { FixedClock } from "./fixed-clock.ts";
import { fixtureReviewers, type PullRequestFixture } from "./fixtures/index.ts";

export type GitHostMethod =
  | "currentUser"
  | "getPullRequest"
  | "getFiles"
  | "listPullRequests"
  | "getOpenPullRequests"
  | "publish";

export interface PublishAttempt {
  readonly ref: PullRequestRef;
  readonly publication: Publication;
  readonly headSha: string;
  /** The keys this attempt posted, in order. */
  readonly postedKeys: readonly CommentKey[];
  readonly outcome: "published" | "failed";
}

const prKey = (ref: PullRequestRef): string =>
  `${ref.repo.host}/${ref.repo.owner}/${ref.repo.repo}#${ref.number}`;
const commitKey = (repo: RepoRef, sha: string): string =>
  `${repo.host}/${repo.owner}/${repo.repo}@${sha}`;

const toSummary = (
  pullRequest: PullRequest,
  role: PullRequestSummary["role"],
): PullRequestSummary => ({
  ref: structuredClone(pullRequest.ref),
  url: pullRequest.url,
  title: pullRequest.title,
  author: { ...pullRequest.author },
  updatedAt: pullRequest.updatedAt,
  role,
});

const notFound = (what: string): HostError => ({
  kind: "not-found",
  message: `${what} not found`,
  retryAfterSeconds: null,
});

export class FakeGitHost implements GitHost {
  readonly host: HostKind;
  /** Every publish call that got past scripted failures, including partial ones. */
  readonly publishAttempts: PublishAttempt[] = [];
  private readonly user: HostUser;
  private readonly clock: Clock;
  private readonly pullRequests = new Map<string, PullRequest>();
  /** PRs merged or closed: still readable, but listed nowhere. */
  private readonly closed = new Set<string>();
  /** Open PRs the user isn't asked to review: readable, but not listed. */
  private readonly unlisted = new Set<string>();
  /** File contents by commit, then path. */
  private readonly commits = new Map<string, Map<string, string>>();
  private readonly failures = new Map<GitHostMethod, HostError[]>();
  private permanentFailure: HostError | null = null;
  private commentFailure: { n: number; error: HostError } | null = null;
  private nextCommentId = 1;

  /** Fixtures for other hosts are skipped, so the same list can seed every host. */
  constructor(options: {
    host: HostKind;
    user?: HostUser;
    fixtures?: readonly PullRequestFixture[];
    clock?: Clock;
  }) {
    this.host = options.host;
    this.user = options.user ?? fixtureReviewers[options.host];
    this.clock = options.clock ?? new FixedClock();
    for (const fixture of options.fixtures ?? []) {
      if (fixture.pullRequest.ref.repo.host === this.host) this.addFixture(fixture);
    }
  }

  addFixture(fixture: PullRequestFixture): void {
    const { pullRequest } = fixture;
    this.pullRequests.set(prKey(pullRequest.ref), structuredClone(pullRequest));
    this.setFiles(pullRequest.ref.repo, pullRequest.baseSha, fixture.baseFiles);
    this.setFiles(pullRequest.ref.repo, pullRequest.headSha, fixture.headFiles);
  }

  setFiles(repo: RepoRef, sha: string, files: Readonly<Record<string, string>>): void {
    const contents = this.commits.get(commitKey(repo, sha)) ?? new Map<string, string>();
    for (const [path, content] of Object.entries(files)) contents.set(path, content);
    this.commits.set(commitKey(repo, sha), contents);
  }

  /** The next call to `method` fails with `error`. Failures queue up per method. */
  failNext(method: GitHostMethod, error: HostError): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), error]);
  }

  /** Every call fails with `error` until this is called with null. */
  failAlways(error: HostError | null): void {
    this.permanentFailure = error;
  }

  /** The next publish fails when it gets to its `n`th post (1-based; the summary is a post). */
  failPublishAtPost(n: number, error: HostError): void {
    this.commentFailure = { n, error };
  }

  /** Simulates a push: the PR gets a new head SHA with the same head files. */
  setHeadSha(ref: PullRequestRef, sha: string): void {
    const pullRequest = this.pullRequests.get(prKey(ref));
    if (pullRequest === undefined) throw new Error(`no fixture PR ${prKey(ref)}`);
    const headFiles = this.commits.get(commitKey(ref.repo, pullRequest.headSha));
    this.commits.set(commitKey(ref.repo, sha), new Map(headFiles));
    this.pullRequests.set(prKey(ref), { ...pullRequest, headSha: sha });
  }

  close(ref: PullRequestRef): void {
    this.closed.add(prKey(ref));
  }

  /** Simulates an open PR the user isn't asked to review, so listPullRequests leaves it out. */
  unlist(ref: PullRequestRef): void {
    this.unlisted.add(prKey(ref));
  }

  /** Every getOpenPullRequests call, with the refs it asked about. */
  readonly getOpenPullRequestsCalls: PullRequestRef[][] = [];

  async currentUser(): Promise<Result<HostUser, HostError>> {
    return this.fail("currentUser") ?? ok({ ...this.user });
  }

  async getPullRequest(ref: PullRequestRef): Promise<Result<PullRequest, HostError>> {
    const failure = this.fail("getPullRequest");
    if (failure !== null) return failure;
    const pullRequest = this.pullRequests.get(prKey(ref));
    return pullRequest === undefined
      ? err(notFound(`pull request ${prKey(ref)}`))
      : ok(structuredClone(pullRequest));
  }

  /** Every call, with the files it asked for. */
  readonly getFilesCalls: FileAt[][] = [];

  async getFiles(
    repo: RepoRef,
    files: readonly FileAt[],
  ): Promise<Result<readonly (string | null)[], HostError>> {
    this.getFilesCalls.push([...files]);
    const failure = this.fail("getFiles");
    if (failure !== null) return failure;
    const found: (string | null)[] = [];
    for (const { sha, path } of files) {
      const contents = this.commits.get(commitKey(repo, sha));
      if (contents === undefined) return err(notFound(`commit ${commitKey(repo, sha)}`));
      found.push(contents.get(path) ?? null);
    }
    return ok(found);
  }

  async listPullRequests(): Promise<Result<PullRequestSummary[], HostError>> {
    const failure = this.fail("listPullRequests");
    if (failure !== null) return failure;
    return ok(
      [...this.pullRequests.values()]
        .filter(({ ref }) => !this.closed.has(prKey(ref)) && !this.unlisted.has(prKey(ref)))
        .map((pullRequest) =>
          toSummary(pullRequest, pullRequest.author.id === this.user.id ? "author" : "reviewer"),
        ),
    );
  }

  async getOpenPullRequests(
    refs: readonly PullRequestRef[],
  ): Promise<Result<PullRequestSummary[], HostError>> {
    this.getOpenPullRequestsCalls.push([...refs]);
    const failure = this.fail("getOpenPullRequests");
    if (failure !== null) return failure;
    return ok(
      refs.flatMap((ref) => {
        const pullRequest = this.pullRequests.get(prKey(ref));
        return pullRequest === undefined || this.closed.has(prKey(ref))
          ? []
          : [{ ...toSummary(pullRequest, "reviewer"), ref: structuredClone(ref) }];
      }),
    );
  }

  async publish(
    ref: PullRequestRef,
    publication: Publication,
    options: PublishOptions,
  ): Promise<Result<PublicationReceipt, HostError>> {
    const failure = this.fail("publish");
    if (failure !== null) return failure;
    const pullRequest = this.pullRequests.get(prKey(ref));
    if (pullRequest === undefined) return err(notFound(`pull request ${prKey(ref)}`));

    const keys = [CommentKey.parse("summary"), ...publication.comments.map((c) => c.key)];
    const toPost = keys.filter((key) => !options.alreadyPosted.has(key));
    const commentFailure = this.commentFailure;
    this.commentFailure = null;
    const postedKeys: CommentKey[] = [];
    const postedCommentIds: Record<CommentKey, string> = {};
    const attempt = (outcome: PublishAttempt["outcome"]): PublishAttempt => ({
      ref: structuredClone(ref),
      publication: structuredClone(publication),
      headSha: options.headSha,
      postedKeys: [...postedKeys],
      outcome,
    });

    for (const [index, key] of toPost.entries()) {
      if (commentFailure !== null && index + 1 === commentFailure.n) {
        this.publishAttempts.push(attempt("failed"));
        return err(commentFailure.error);
      }
      const hostCommentId = `fake-comment-${this.nextCommentId++}`;
      await options.onPosted(key, hostCommentId);
      postedKeys.push(key);
      postedCommentIds[key] = hostCommentId;
    }
    this.publishAttempts.push(attempt("published"));
    return ok({
      url: `${pullRequest.url}#review-${this.publishAttempts.length}`,
      publishedAt: this.clock.now(),
      postedCommentIds,
    });
  }

  private fail(method: GitHostMethod): Result<never, HostError> | null {
    if (this.permanentFailure !== null) return err(this.permanentFailure);
    const failure = this.failures.get(method)?.shift();
    return failure === undefined ? null : err(failure);
  }
}
