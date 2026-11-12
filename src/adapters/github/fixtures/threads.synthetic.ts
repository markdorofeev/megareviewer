import { REPLY_MUTATION, RESOLVE_MUTATION, THREADS_QUERY, UNRESOLVE_MUTATION } from "../threads.ts";

// Written from GitHub's GraphQL docs against sindresorhus/is#210, as recording would post real
// comments. Bodies keep only the fields the adapter reads.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const API = "https://api.github.com";
export const THREADS_HEAD = "b177d02e3aee907af72dc76aece21faf74be7935";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const JSONV3 = "application/vnd.github.v3+json";

const ok = (body: unknown) => ({ status: 200, headers: JSON_HEADERS, body });
const graphql = (query: string, variables: Record<string, unknown>, data: unknown) => ({
  request: { method: "POST", url: `${API}/graphql`, accept: JSONV3, body: { query, variables } },
  response: ok({ data }),
});

const author = (login: string, name: string | null) => ({ login, name });
const comment = (id: string, who: ReturnType<typeof author> | null, body: string, at: string) => ({
  id,
  body,
  createdAt: at,
  author: who,
  originalCommit: { oid: THREADS_HEAD },
});
const thread = (fields: Record<string, unknown>) => ({
  isResolved: false,
  isOutdated: false,
  path: "source/index.ts",
  line: 1146,
  startLine: null,
  originalLine: 1146,
  diffSide: "RIGHT",
  viewerCanResolve: true,
  viewerCanUnresolve: false,
  viewerCanReply: true,
  resolvedBy: null,
  ...fields,
});

const variables = { owner: "sindresorhus", repo: "is", number: 210 };

export const threadExchanges: Exchange[] = [
  graphql(THREADS_QUERY, variables, {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: true, endCursor: "Y3Vyc29yOjE=" },
          nodes: [
            thread({
              id: "PRRT_kwDOAbc1",
              startLine: 1146,
              // Out of order, as a page can be: the adapter sorts by time.
              comments: {
                nodes: [
                  comment(
                    "PRRC_kwDOAbc12",
                    author("sindresorhus", ""),
                    "Good point, fixed.",
                    "2026-01-02T10:00:00Z",
                  ),
                  comment(
                    "PRRC_kwDOAbc11",
                    author("lee-park", "Lee Park"),
                    "**major:** The message is lost when `value` is undefined.",
                    "2026-01-02T09:00:00Z",
                  ),
                ],
              },
            }),
            thread({
              id: "PRRT_kwDOAbc2",
              isResolved: true,
              viewerCanUnresolve: true,
              line: 1152,
              originalLine: 1152,
              diffSide: "LEFT",
              resolvedBy: author("sindresorhus", null),
              comments: {
                nodes: [comment("PRRC_kwDOAbc21", null, "Intended?", "2026-01-02T09:05:00Z")],
              },
            }),
          ],
        },
      },
    },
  }),
  graphql(
    THREADS_QUERY,
    { ...variables, after: "Y3Vyc29yOjE=" },
    {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              thread({
                id: "PRRT_kwDOAbc3",
                isOutdated: true,
                line: null,
                startLine: null,
                originalLine: 776,
                path: "test/test.ts",
                comments: {
                  nodes: [
                    comment(
                      "PRRC_kwDOAbc31",
                      author("lee-park", "Lee Park"),
                      "```suggestion\n\tt.throws(() => {\n```",
                      "2026-01-02T09:10:00Z",
                    ),
                  ],
                },
              }),
              thread({ id: "PRRT_kwDOAbc4", comments: { nodes: [] } }),
            ],
          },
        },
      },
    },
  ),
  graphql(
    REPLY_MUTATION,
    { threadId: "PRRT_kwDOAbc1", body: "Thanks!" },
    {
      addPullRequestReviewThreadReply: {
        comment: comment(
          "PRRC_kwDOAbc13",
          author("lee-park", "Lee Park"),
          "Thanks!",
          "2026-01-03T09:00:00Z",
        ),
      },
    },
  ),
  {
    request: {
      method: "POST",
      url: `${API}/repos/sindresorhus/is/pulls/210/comments`,
      body: {
        commit_id: THREADS_HEAD,
        path: "source/index.ts",
        line: 12,
        side: "RIGHT",
        start_line: 10,
        start_side: "RIGHT",
        body: "Name it for what it checks.",
      },
    },
    response: { status: 201, headers: JSON_HEADERS, body: { id: 3001 } },
  },
  graphql(
    RESOLVE_MUTATION,
    { threadId: "PRRT_kwDOAbc1" },
    {
      resolveReviewThread: { thread: { id: "PRRT_kwDOAbc1" } },
    },
  ),
  graphql(
    UNRESOLVE_MUTATION,
    { threadId: "PRRT_kwDOAbc1" },
    {
      unresolveReviewThread: { thread: { id: "PRRT_kwDOAbc1" } },
    },
  ),
];

export const ATTACHMENT =
  "https://github.com/user-attachments/assets/771a3d24-9ce2-4554-96da-50a773965ff5";
const SIGNED =
  "https://github-production-user-asset-6210df.s3.amazonaws.com/1/771a3d24.png?X-Amz-Signature=abc";

/** An attachment redirects to a signed URL, which serves the file. */
export const attachmentExchanges: Exchange[] = [
  {
    request: { method: "GET", url: ATTACHMENT },
    response: { status: 302, headers: { location: SIGNED }, body: null },
  },
  {
    request: { method: "GET", url: SIGNED },
    response: { status: 200, headers: { "content-type": "image/png" }, body: "PNGDATA" },
  },
];
