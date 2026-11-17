import { commentsUrl, othersPullRequestsUrl } from "../history.ts";

// Written from Bitbucket's REST docs and the shapes of live answers, for a made-up acme
// workspace: recording would capture the credentials' owner's own comments. record-history.ts
// records a scrubbed read. Bodies keep only the fields the adapter reads.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
export interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const API = "https://api.bitbucket.org/2.0";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const HISTORY_REPO = { host: "bitbucket", owner: "acme", repo: "shop" } as const;
export const UNREVIEWED_REPO = { host: "bitbucket", owner: "acme", repo: "docs" } as const;
export const HIDDEN_REPO = { host: "bitbucket", owner: "acme", repo: "vault" } as const;

/** The credentials' owner. */
export const LEE = {
  uuid: "{9b6f3c2e-1a4d-4c8b-8e2f-7d5a0c9b3e14}",
  display_name: "Lee Park",
  account_id: "712020:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
};
const ANA = {
  uuid: "{0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f}",
  display_name: "Ana Silva",
  account_id: "712020:5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
};

export const get = (url: string, body: unknown): Exchange => ({
  request: { method: "GET", url, accept: "application/json" },
  response: { status: 200, headers: JSON_HEADERS, body },
});

export const userExchange: Exchange = get(`${API}/user`, LEE);

/** When someone on a pull request last acted, or null for one asked to review who never did. */
const on = (account: { uuid: string }, participatedOn: string | null) => ({
  user: { uuid: account.uuid },
  participated_on: participatedOn,
});

export const listed = (
  id: number,
  updatedOn: string,
  participants: readonly ReturnType<typeof on>[],
) => ({ id, updated_on: updatedOn, participants });

/** A pull request the credentials' owner acted on at `at`. */
export const reviewedAt = (id: number, at: string) => listed(id, at, [on(LEE, at)]);

export const comment = (fields: Record<string, unknown>) => ({
  deleted: false,
  user: LEE,
  ...fields,
});

const LIST = othersPullRequestsUrl(HISTORY_REPO, LEE.uuid);
export const LIST_PAGE_2 = `${LIST}&page=2`;
const COMMENTS_27_PAGE_2 = `${commentsUrl(HISTORY_REPO, 27)}&page=2`;

export const historyExchanges: Exchange[] = [
  userExchange,
  get(LIST, {
    values: [
      listed(31, "2026-01-05T12:00:00.000000+00:00", [
        on(LEE, "2026-01-05T11:30:00.000000+00:00"),
        on(ANA, null),
      ]),
      // Asked for a review that was never given.
      listed(30, "2026-01-05T08:00:00.000000+00:00", [on(LEE, null)]),
      listed(29, "2026-01-04T17:00:00.000000+00:00", []),
    ],
    next: LIST_PAGE_2,
  }),
  get(LIST_PAGE_2, {
    values: [
      // Commented without being asked to review.
      listed(27, "2026-01-03T10:00:00.000000+00:00", [
        on(ANA, "2026-01-03T09:00:00.000000+00:00"),
        on(LEE, "2026-01-03T10:00:00.000000+00:00"),
      ]),
      // Approved, with nothing said on the code.
      reviewedAt(25, "2025-12-19T15:00:00.000000+00:00"),
    ],
  }),
  get(othersPullRequestsUrl(UNREVIEWED_REPO, LEE.uuid), {
    values: [
      listed(8, "2026-01-02T10:00:00.000000+00:00", [
        on(ANA, "2026-01-02T10:00:00.000000+00:00"),
        on(LEE, null),
      ]),
    ],
  }),
  get(commentsUrl(HISTORY_REPO, 31), {
    values: [
      comment({
        id: 501,
        content: {
          raw: "@{712020:5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b} this skips the tenant check, see [the guide](https://acme.example/guide){: data-inline-card='' }.",
        },
        created_on: "2026-01-05T10:00:00.000000+00:00",
        inline: { path: "shop/orders.py", from: null, to: 42 },
      }),
      // A general comment: not on code.
      comment({
        id: 502,
        content: { raw: "Two things before this merges." },
        created_on: "2026-01-05T10:05:00.000000+00:00",
      }),
      comment({
        id: 503,
        user: ANA,
        content: { raw: "The caller checks it." },
        created_on: "2026-01-05T10:30:00.000000+00:00",
        inline: { path: "shop/orders.py", from: null, to: 42 },
        parent: { id: 501 },
      }),
      // A reply is the reviewer's words too, on the file its thread is on.
      comment({
        id: 504,
        content: { raw: "Then say so in a test." },
        created_on: "2026-01-05T12:30:00.000000+01:00",
        parent: { id: 503 },
      }),
      comment({
        id: 505,
        deleted: true,
        content: { raw: "" },
        created_on: "2026-01-05T11:40:00.000000+00:00",
        inline: { path: "shop/orders.py", from: 17, to: null },
      }),
    ],
  }),
  get(commentsUrl(HISTORY_REPO, 27), {
    values: [
      comment({
        id: 401,
        user: ANA,
        content: { raw: "Is the retry needed?" },
        created_on: "2026-01-03T09:00:00.000000+00:00",
        inline: { path: "shop/payments.py", from: null, to: 9 },
      }),
    ],
    next: COMMENTS_27_PAGE_2,
  }),
  get(COMMENTS_27_PAGE_2, {
    values: [
      comment({
        id: 402,
        content: { raw: "It retries a charge that may have gone through." },
        created_on: "2026-01-03T10:00:00.000000+00:00",
        inline: { path: "shop/payments.py", from: 12, to: null },
      }),
    ],
  }),
  get(commentsUrl(HISTORY_REPO, 25), {
    values: [
      comment({
        id: 301,
        user: ANA,
        content: { raw: "Renamed as asked." },
        created_on: "2025-12-19T14:00:00.000000+00:00",
        inline: { path: "README.md", from: null, to: 3 },
      }),
    ],
  }),
];

/** What Bitbucket answers for a repository the credentials can't see, or that isn't there. */
export const hiddenRepoExchanges: Exchange[] = [
  userExchange,
  {
    request: { method: "GET", url: othersPullRequestsUrl(HIDDEN_REPO, LEE.uuid) },
    response: {
      status: 404,
      headers: JSON_HEADERS,
      body: {
        type: "error",
        error: {
          message:
            "You may not have access to this repository or it no longer exists in this workspace. If you think this repository exists and you have access, make sure you are authenticated.",
        },
      },
    },
  },
];
