import type { Logger, PullRequestStatusSource } from "../../application/ports/index.ts";
import {
  type Check,
  type CheckState,
  HttpUrl,
  type PullRequestRef,
  type PullRequestState,
  type Reviewer,
  reviewStatusOf,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { API, createBitbucketClient } from "./client.ts";
import { toHostUser } from "./map.ts";
import { BitbucketBuildStatus, BitbucketPullRequestStatus } from "./schemas.ts";

export interface BitbucketStatusOptions {
  readonly username: string;
  readonly password: string;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

const segment = encodeURIComponent;
const repoUrl = (ref: PullRequestRef): string =>
  `${API}/repositories/${segment(ref.repo.owner)}/${segment(ref.repo.repo)}`;

const toState = (pullRequest: BitbucketPullRequestStatus): PullRequestState =>
  pullRequest.state === "MERGED"
    ? "merged"
    : pullRequest.state === "OPEN"
      ? pullRequest.draft === true
        ? "draft"
        : "open"
      : "closed";

/**
 * Reviewers are those asked to review and those who approved or requested changes; a participant
 * who only commented is a reviewer who commented. The author isn't one.
 */
export const toReviewers = (pullRequest: BitbucketPullRequestStatus): Reviewer[] => {
  const author = pullRequest.author?.uuid;
  return pullRequest.participants.flatMap((participant): Reviewer[] => {
    const user = toHostUser(participant.user);
    if (participant.user?.uuid === author) return [];
    const verdict =
      participant.state === "changes_requested"
        ? "changes-requested"
        : participant.approved || participant.state === "approved"
          ? "approved"
          : participant.role === "REVIEWER"
            ? null
            : "commented";
    return [{ id: user.id, name: user.name, team: false, verdict }];
  });
};

const CHECK_STATES: Readonly<Record<string, CheckState>> = {
  SUCCESSFUL: "passed",
  FAILED: "failed",
  STOPPED: "failed",
  INPROGRESS: "running",
};

export const toCheck = (status: BitbucketBuildStatus): Check => {
  const url = HttpUrl.safeParse(status.url);
  return {
    name: status.name?.trim() || status.key,
    state: CHECK_STATES[status.state] ?? "failed",
    url: url.success ? url.data : null,
  };
};

export const createBitbucketStatusSource = (
  options: BitbucketStatusOptions,
): PullRequestStatusSource => {
  const client = createBitbucketClient({
    username: options.username,
    password: options.password,
    logger: options.logger,
    fetch: options.fetch ?? globalThis.fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  return {
    host: "bitbucket",

    async getStatus(ref, headSha) {
      const [pullRequest, statuses] = await Promise.all([
        client.json(
          "the pull request's status",
          BitbucketPullRequestStatus,
          `${repoUrl(ref)}/pullrequests/${ref.number}`,
        ),
        client.pages(
          "the commit's build statuses",
          BitbucketBuildStatus,
          `${repoUrl(ref)}/commit/${segment(headSha)}/statuses?${new URLSearchParams({ pagelen: "100" })}`,
        ),
      ]);
      if (!pullRequest.ok) return pullRequest;
      // Refused or missing statuses leave the rest readable; a network failure is retried whole.
      const unreadable =
        !statuses.ok &&
        (statuses.error.kind === "forbidden" || statuses.error.kind === "not-found");
      if (!statuses.ok && !unreadable) return err(statuses.error);
      const reviewers = toReviewers(pullRequest.value);
      return ok({
        state: toState(pullRequest.value),
        reviewStatus: reviewStatusOf(reviewers),
        reviewers,
        checks: statuses.ok ? statuses.value.map(toCheck) : null,
        checksUnreadable: statuses.ok
          ? null
          : `Bitbucket wouldn't show the commit's build statuses: ${statuses.error.message}`,
      });
    },
  };
};
