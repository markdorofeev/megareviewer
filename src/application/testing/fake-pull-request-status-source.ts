import {
  type HostError,
  type HostKind,
  type PullRequestRef,
  type PullRequestStatus,
  type Reviewer,
  reviewStatusOf,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { PullRequestStatusSource } from "../ports/index.ts";

const prKey = (ref: PullRequestRef): string =>
  `${ref.repo.host}/${ref.repo.owner}/${ref.repo.repo}#${ref.number}`;

/** An open PR nobody has reviewed, on a commit without checks. */
export const OPEN_STATUS: PullRequestStatus = {
  state: "open",
  reviewStatus: null,
  reviewers: [],
  checks: [],
  checksUnreadable: null,
};

export class FakePullRequestStatusSource implements PullRequestStatusSource {
  readonly host: HostKind;
  private readonly statuses = new Map<string, PullRequestStatus>();
  private readonly failures: HostError[] = [];
  /** Every head SHA asked about, in order. */
  readonly asked: string[] = [];

  /** The current user as a reviewer of `ref` now, joined to its reviewers: what a fake host says they published, say. */
  private readonly viewer: ((ref: PullRequestRef) => Reviewer | null) | undefined;

  constructor(options: { host: HostKind; viewer?: (ref: PullRequestRef) => Reviewer | null }) {
    this.host = options.host;
    this.viewer = options.viewer;
  }

  /** The status of `ref`; one never set reads as OPEN_STATUS. */
  setStatus(ref: PullRequestRef, status: PullRequestStatus): void {
    this.statuses.set(prKey(ref), status);
  }

  /** The next read fails with `error`. Failures queue up. */
  failNext(error: HostError): void {
    this.failures.push(error);
  }

  async getStatus(
    ref: PullRequestRef,
    headSha: string,
  ): Promise<Result<PullRequestStatus, HostError>> {
    this.asked.push(headSha);
    const failure = this.failures.shift();
    if (failure !== undefined) return err(failure);
    const status = structuredClone(this.statuses.get(prKey(ref)) ?? OPEN_STATUS);
    const viewer = this.viewer?.(ref) ?? null;
    if (viewer === null) return ok(status);
    const reviewers = [...status.reviewers.filter((one) => one.id !== viewer.id), viewer];
    return ok({ ...status, reviewers, reviewStatus: reviewStatusOf(reviewers) });
  }
}
