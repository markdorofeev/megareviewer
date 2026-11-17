import { reviewedQuery } from "../history.ts";

// Written from GitHub's REST docs and the shapes of live answers, for a made-up octo-org:
// recording would capture the token owner's own comments. record-history.ts records a scrubbed
// read. Bodies keep only the fields the adapter reads.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
export interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const API = "https://api.github.com";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const HISTORY_REPO = { host: "github", owner: "octo-org", repo: "api" } as const;
export const UNREVIEWED_REPO = { host: "github", owner: "octo-org", repo: "docs" } as const;
export const HIDDEN_REPO = { host: "github", owner: "octo-org", repo: "vault" } as const;
/** The token's user. */
export const REVIEWER = "lee-park";

type Repo = { readonly owner: string; readonly repo: string };

const get = (url: string, body: unknown, headers: Record<string, string> = {}): Exchange => ({
  request: { method: "GET", url },
  response: { status: 200, headers: { ...JSON_HEADERS, ...headers }, body },
});

export const userExchange: Exchange = get(`${API}/user`, { login: REVIEWER, name: null });

export const searchUrl = (repo: Repo, pullRequests: number): string =>
  `${API}/search/issues?q=${encodeURIComponent(reviewedQuery({ host: "github", ...repo }))}` +
  `&sort=updated&order=desc&per_page=${pullRequests}`;

export const commentsUrl = (repo: Repo, number: number): string =>
  `${API}/repos/${repo.owner}/${repo.repo}/pulls/${number}/comments?per_page=100`;

export const found = (
  repo: Repo,
  pullRequests: number,
  items: readonly { number: number; updated_at: string }[],
): Exchange =>
  get(searchUrl(repo, pullRequests), {
    total_count: items.length,
    incomplete_results: false,
    items,
  });

export const comment = (login: string | null, path: string, body: string, at: string) => ({
  user: login === null ? null : { login },
  path,
  body,
  created_at: at,
});

export const REVIEWED = [
  { number: 42, updated_at: "2026-01-05T12:00:00Z" },
  { number: 40, updated_at: "2026-01-04T09:30:00Z" },
  { number: 37, updated_at: "2025-12-20T16:45:00Z" },
] as const;

const PAGE_2 = `${API}/repositories/1300192/pulls/42/comments?per_page=100&page=2`;

export const historyExchanges: Exchange[] = [
  userExchange,
  found(HISTORY_REPO, 30, REVIEWED),
  found(HISTORY_REPO, 1, REVIEWED.slice(0, 1)),
  found(UNREVIEWED_REPO, 30, []),
  get(
    commentsUrl(HISTORY_REPO, 42),
    [
      comment(
        REVIEWER,
        "src/billing/retry.ts",
        "This retries a charge that may have gone through. Check the idempotency key first.",
        "2026-01-05T10:00:00Z",
      ),
      comment("octocat", "src/billing/retry.ts", "It's set by the caller.", "2026-01-05T10:20:00Z"),
      // A reply is the reviewer's words too.
      comment(
        REVIEWER,
        "src/billing/retry.ts",
        "Then assert it here, so a caller that forgets fails loudly.",
        "2026-01-05T10:40:00Z",
      ),
    ],
    { link: `<${PAGE_2}>; rel="next", <${PAGE_2}>; rel="last"` },
  ),
  get(PAGE_2, [
    // A deleted account's comment.
    comment(null, "src/billing/retry.test.ts", "Covered below.", "2026-01-05T11:00:00Z"),
    comment(
      REVIEWER,
      "src/billing/retry.test.ts",
      "No test for the timeout path.",
      "2026-01-05T11:30:00Z",
    ),
  ]),
  // Reviewed with an approval: the comments on its code are someone else's.
  get(commentsUrl(HISTORY_REPO, 40), [
    comment("octocat", "README.md", "Typo: recieve.", "2026-01-04T09:00:00Z"),
  ]),
  get(commentsUrl(HISTORY_REPO, 37), [
    comment(
      REVIEWER,
      "src/api/orders.ts",
      "```suggestion\nconst owner = await requireOwner(order, user);\n```\nEvery route here checks the owner.",
      "2025-12-20T16:00:00Z",
    ),
  ]),
];

/** What GitHub answers for a repository the token can't see, or that isn't there. */
export const hiddenRepoExchanges: Exchange[] = [
  userExchange,
  {
    request: { method: "GET", url: searchUrl(HIDDEN_REPO, 30) },
    response: {
      status: 422,
      headers: JSON_HEADERS,
      body: {
        message: "Validation Failed",
        errors: [
          {
            message:
              "The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.",
            resource: "Search",
            field: "q",
            code: "invalid",
          },
        ],
      },
    },
  },
];
