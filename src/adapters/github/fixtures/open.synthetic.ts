import { openPullRequestsQuery } from "../github-host.ts";

// Written from GitHub's GraphQL docs against sindresorhus/is: #210, merged, and a PR number that
// doesn't exist, which fails only its own alias. Bodies keep only the fields the adapter reads.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const JSONV3 = "application/vnd.github.v3+json";

export const openExchanges: Exchange[] = [
  {
    request: {
      method: "POST",
      url: "https://api.github.com/graphql",
      accept: JSONV3,
      body: {
        query: openPullRequestsQuery(2),
        variables: {
          o0: "sindresorhus",
          r0: "is",
          n0: 210,
          o1: "sindresorhus",
          r1: "is",
          n1: 999_999_999,
        },
      },
    },
    response: {
      status: 200,
      headers: JSON_HEADERS,
      body: {
        data: {
          p0: {
            pullRequest: {
              state: "MERGED",
              title: "Fix passing in assertion message to `assertArray`",
              url: "https://github.com/sindresorhus/is/pull/210",
              updatedAt: "2024-05-03T10:00:00Z",
              author: { login: "contributor" },
            },
          },
          p1: { pullRequest: null },
        },
        errors: [
          {
            type: "NOT_FOUND",
            path: ["p1", "pullRequest"],
            message: "Could not resolve to a PullRequest with the number of 999999999.",
          },
        ],
      },
    },
  },
];
