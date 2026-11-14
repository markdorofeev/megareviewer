import type { Logger, PullRequestStatusSource } from "../../application/ports/index.ts";
import {
  type Check,
  type CheckState,
  type HostError,
  HttpUrl,
  type PullRequestState,
  type Reviewer,
  type ReviewerVerdict,
  type ReviewStatus,
  reviewStatusOf,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { createGitHubClient, type GitHubClientOptions } from "./client.ts";
import { graphqlAnswerWithErrors } from "./errors.ts";
import {
  type GitHubCheckContext,
  GitHubStatusAnswer,
  type GitHubStatusPullRequest,
  type GraphqlError,
} from "./schemas.ts";

/** Checks read per commit; GitHub's rollup lists the latest run of each. */
const MAX_CHECKS = 100;

/** The PR's state and reviews, and the checks on the commit the reviewer reads. */
export const STATUS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $head: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state isDraft reviewDecision
      author { login }
      reviewRequests(first: 50) {
        nodes {
          requestedReviewer {
            __typename
            ... on User { login name }
            ... on Team { slug name }
            ... on Bot { login }
            ... on Mannequin { login }
          }
        }
      }
      latestReviews(first: 50) { nodes { state author { login ... on User { name } } } }
      latestOpinionatedReviews(first: 50) { nodes { state author { login ... on User { name } } } }
    }
    object(expression: $head) {
      ... on Commit {
        statusCheckRollup {
          contexts(first: ${MAX_CHECKS}) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
}`;

const toState = (pullRequest: GitHubStatusPullRequest): PullRequestState =>
  pullRequest.state === "MERGED"
    ? "merged"
    : pullRequest.state === "CLOSED"
      ? "closed"
      : pullRequest.isDraft
        ? "draft"
        : "open";

const VERDICTS: Readonly<Record<string, ReviewerVerdict>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
};

/**
 * Requested reviewers wait; a review sets its author's verdict, and an approval or a request for
 * changes outlasts a comment written after it, as GitHub counts them.
 */
export const toReviewers = (pullRequest: GitHubStatusPullRequest): Reviewer[] => {
  const reviewers = new Map<string, Reviewer>();
  for (const { requestedReviewer: requested } of pullRequest.reviewRequests) {
    if (requested === null) continue;
    const reviewer: Reviewer =
      "slug" in requested
        ? { id: `team:${requested.slug}`, name: requested.name, team: true, verdict: null }
        : {
            id: requested.login,
            name: requested.name?.trim() || requested.login,
            team: false,
            verdict: null,
          };
    reviewers.set(reviewer.id, reviewer);
  }
  for (const review of [...pullRequest.latestReviews, ...pullRequest.latestOpinionatedReviews]) {
    const verdict = VERDICTS[review.state];
    if (verdict === undefined || review.author === null) continue;
    const { login, name } = review.author;
    reviewers.set(login, { id: login, name: name?.trim() || login, team: false, verdict });
  }
  const author = pullRequest.author?.login;
  return [...reviewers.values()].filter((reviewer) => reviewer.id !== author);
};

const DECISIONS: Readonly<Record<string, ReviewStatus | null>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: null,
};

const checkRunState = (status: string, conclusion: string | null): CheckState => {
  if (status !== "COMPLETED") return "running";
  if (conclusion === "SUCCESS") return "passed";
  if (conclusion === "NEUTRAL" || conclusion === "SKIPPED") return "skipped";
  return "failed";
};

const statusContextState = (state: string): CheckState =>
  state === "SUCCESS"
    ? "passed"
    : state === "PENDING" || state === "EXPECTED"
      ? "running"
      : "failed";

const httpUrl = (url: string | null): string | null => {
  const parsed = HttpUrl.safeParse(url);
  return parsed.success ? parsed.data : null;
};

export const toCheck = (context: GitHubCheckContext): Check =>
  context.__typename === "CheckRun"
    ? {
        name: context.name,
        state: checkRunState(context.status, context.conclusion),
        url: httpUrl(context.detailsUrl),
      }
    : {
        name: context.context,
        state: statusContextState(context.state),
        url: httpUrl(context.targetUrl),
      };

const isAbout = (error: GraphqlError, field: string) => error.path?.includes(field) === true;

const notFound = (message: string): HostError => ({
  kind: "not-found",
  message,
  retryAfterSeconds: null,
});

export const createGitHubStatusSource = (
  options: GitHubClientOptions & { readonly logger: Logger },
): PullRequestStatusSource => {
  const { logger } = options;
  const { octokit, read } = createGitHubClient(options);

  return {
    host: "github",

    async getStatus(ref, headSha) {
      const answer = await read("the pull request's status", GitHubStatusAnswer, (request) =>
        octokit
          .graphql(STATUS_QUERY, {
            owner: ref.repo.owner,
            repo: ref.repo.repo,
            number: ref.number,
            head: headSha,
            request,
          })
          .then(
            (data) => ({ data, errors: [] }),
            (error: unknown) => graphqlAnswerWithErrors(error) ?? Promise.reject(error),
          ),
      );
      if (!answer.ok) return answer;
      const { data, errors } = answer.value;
      const pullRequest = data.repository?.pullRequest ?? null;
      if (pullRequest === null) {
        const message = errors.map((error) => error.message).join("; ");
        return err(
          notFound(message === "" ? "Not found on GitHub" : `GitHub answered: ${message}`),
        );
      }
      const others = errors.filter((error) => !isAbout(error, "object"));
      if (others.length > 0) {
        logger.warn("GitHub left out part of the pull request's status", {
          pullRequest: ref.number,
          errors: others.map((error) => error.message).join("; "),
        });
      }

      const refused = errors.filter((error) => isAbout(error, "object"));
      const commit = data.repository?.object ?? null;
      let checks: Check[] | null = null;
      let checksUnreadable: string | null = null;
      if (refused.length > 0 || (commit !== null && commit.statusCheckRollup === undefined)) {
        checksUnreadable = `GitHub wouldn't show the checks: ${refused.map((error) => error.message).join("; ") || "no reason given"}. A fine-grained token needs read access to Checks and Commit statuses.`;
      } else if (commit === null) {
        checksUnreadable = `GitHub doesn't have commit ${headSha.slice(0, 7)}.`;
      } else {
        const contexts = commit.statusCheckRollup?.contexts;
        checks = (contexts?.nodes ?? []).filter((node) => node !== null).map(toCheck);
        if (contexts !== undefined && contexts.totalCount > checks.length) {
          logger.warn(`Read the first ${MAX_CHECKS} checks; later ones are missing`, {
            pullRequest: ref.number,
            checks: contexts.totalCount,
          });
        }
      }

      const reviewers = toReviewers(pullRequest);
      const decision = pullRequest.reviewDecision;
      return ok({
        state: toState(pullRequest),
        reviewStatus: decision === null ? reviewStatusOf(reviewers) : (DECISIONS[decision] ?? null),
        reviewers,
        checks,
        checksUnreadable,
      });
    },
  };
};
