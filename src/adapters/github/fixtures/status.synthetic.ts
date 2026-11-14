import { STATUS_QUERY } from "../status.ts";

// Written from GitHub's GraphQL docs and the shape microsoft/TypeScript#60000 answers, for
// sindresorhus/is#210: a PR whose reviewers have every verdict, and checks of every state.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const API = "https://api.github.com";
export const STATUS_HEAD = "b177d02e3aee907af72dc76aece21faf74be7935";
export const STATUS_HEAD_WITHOUT_CHECKS = "5f1c9a0d2b7e4f3a8c6d1e0b9a8f7e6d5c4b3a21";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const JSONV3 = "application/vnd.github.v3+json";

const graphql = (variables: Record<string, unknown>, body: unknown): Exchange => ({
  request: {
    method: "POST",
    url: `${API}/graphql`,
    accept: JSONV3,
    body: { query: STATUS_QUERY, variables },
  },
  response: { status: 200, headers: JSON_HEADERS, body },
});

const variables = (number: number, head: string) => ({
  owner: "sindresorhus",
  repo: "is",
  number,
  head,
});

const pullRequest = {
  state: "OPEN",
  isDraft: false,
  reviewDecision: "CHANGES_REQUESTED",
  author: { login: "sindresorhus" },
  reviewRequests: {
    nodes: [
      { requestedReviewer: { __typename: "User", login: "lee-park", name: "Lee Park" } },
      { requestedReviewer: { __typename: "Team", slug: "maintainers", name: "Maintainers" } },
      // The author asked themselves, which GitHub allows on some repositories.
      { requestedReviewer: { __typename: "User", login: "sindresorhus", name: "" } },
    ],
  },
  latestReviews: {
    nodes: [
      { state: "COMMENTED", author: { login: "jk-ortiz", name: "J. K. Ortiz" } },
      { state: "COMMENTED", author: { login: "ana-silva", name: null } },
      { state: "APPROVED", author: { login: "ruth-ng", name: "Ruth Ng" } },
      { state: "DISMISSED", author: { login: "old-hand", name: "Old Hand" } },
    ],
  },
  latestOpinionatedReviews: {
    nodes: [
      // A comment after it doesn't undo a request for changes.
      { state: "CHANGES_REQUESTED", author: { login: "jk-ortiz", name: "J. K. Ortiz" } },
      { state: "APPROVED", author: { login: "ruth-ng", name: "Ruth Ng" } },
    ],
  },
};

const rollup = {
  contexts: {
    totalCount: 5,
    nodes: [
      {
        __typename: "CheckRun",
        name: "test (22)",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://github.com/sindresorhus/is/actions/runs/1/job/1",
      },
      {
        __typename: "CheckRun",
        name: "test (24)",
        status: "COMPLETED",
        conclusion: "FAILURE",
        detailsUrl: "https://github.com/sindresorhus/is/actions/runs/1/job/2",
      },
      {
        __typename: "CheckRun",
        name: "lint",
        status: "IN_PROGRESS",
        conclusion: null,
        detailsUrl: null,
      },
      {
        __typename: "CheckRun",
        name: "deploy-preview",
        status: "COMPLETED",
        conclusion: "SKIPPED",
        detailsUrl: "javascript:alert(1)",
      },
      {
        __typename: "StatusContext",
        context: "codecov/patch",
        state: "SUCCESS",
        targetUrl: "https://app.codecov.io/gh/sindresorhus/is/pull/210",
      },
    ],
  },
};

export const statusExchanges: Exchange[] = [
  graphql(variables(210, STATUS_HEAD), {
    data: { repository: { pullRequest, object: { statusCheckRollup: rollup } } },
  }),
  graphql(variables(210, STATUS_HEAD_WITHOUT_CHECKS), {
    data: { repository: { pullRequest, object: { statusCheckRollup: null } } },
  }),
  graphql(variables(999999, STATUS_HEAD), {
    data: { repository: { pullRequest: null, object: { statusCheckRollup: rollup } } },
    errors: [
      {
        type: "NOT_FOUND",
        path: ["repository", "pullRequest"],
        message: "Could not resolve to a PullRequest with the number of 999999.",
      },
    ],
  }),
];

/** What a fine-grained token without Checks or Commit statuses gets. */
export const statusWithoutChecksExchanges: Exchange[] = [
  graphql(variables(210, STATUS_HEAD), {
    data: { repository: { pullRequest, object: { statusCheckRollup: null } } },
    errors: [
      {
        type: "FORBIDDEN",
        path: ["repository", "object", "statusCheckRollup"],
        message: "Resource not accessible by personal access token",
      },
    ],
  }),
];
