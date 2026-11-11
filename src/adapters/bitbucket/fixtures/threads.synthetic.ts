// Written from Bitbucket Cloud's REST docs against atlassian/bitbucket-upload-file#26, as
// recording would post real comments and push a commit. Bodies keep only the fields the adapter
// reads. Open issue: the `resolution` field, the /resolve endpoint and `inline.outdated` need
// confirming against a recorded response.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const API = "https://api.bitbucket.org/2.0";
const REPO = `${API}/repositories/atlassian/bitbucket-upload-file`;
const PR = `${REPO}/pullrequests/26`;
export const BITBUCKET_THREADS_HEAD = "b467819f28a4ca3cfbbdb889bd1bc7ba6918522d";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const lee = { uuid: "{9b6f3c2e-1a4d-4c8b-8e2f-7d5a0c9b3e14}", display_name: "Lee Park" };
const ana = { uuid: "{0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f}", display_name: "Ana Silva" };
const comment = (fields: Record<string, unknown>) => ({
  deleted: false,
  content: { raw: "" },
  user: lee,
  ...fields,
});

export const COMMENTS_PAGE_2 = `${PR}/comments?pagelen=100&page=2`;

export const bitbucketThreadExchanges: Exchange[] = [
  {
    request: { method: "GET", url: `${PR}/comments?pagelen=100`, accept: "application/json" },
    response: {
      status: 200,
      headers: JSON_HEADERS,
      body: {
        values: [
          comment({
            id: 101,
            content: { raw: "**major:** This drops the error's cause." },
            created_on: "2026-01-02T09:00:00.000000+00:00",
            inline: { path: "pipe/pipe.py", from: null, to: 42 },
          }),
          // A general comment: not on code, so not a thread.
          comment({
            id: 102,
            content: { raw: "Looks good overall." },
            created_on: "2026-01-02T09:01:00.000000+00:00",
          }),
          comment({
            id: 104,
            content: { raw: "And it's logged twice." },
            user: lee,
            created_on: "2026-01-02T11:00:00.000000+01:00",
            parent: { id: 103 },
          }),
          comment({
            id: 103,
            content: { raw: "Fixed in the next push." },
            user: ana,
            created_on: "2026-01-02T09:30:00.000000+00:00",
            parent: { id: 101 },
          }),
        ],
        next: COMMENTS_PAGE_2,
      },
    },
  },
  {
    request: { method: "GET", url: COMMENTS_PAGE_2, accept: "application/json" },
    response: {
      status: 200,
      headers: JSON_HEADERS,
      body: {
        values: [
          comment({
            id: 201,
            content: { raw: "Was this meant to go?" },
            created_on: "2026-01-02T09:05:00.000000+00:00",
            inline: { path: "pipe/pipe.py", from: 17, to: null },
            resolution: { user: ana, created_on: "2026-01-02T10:00:00.000000+00:00" },
          }),
          comment({
            id: 301,
            content: { raw: "" },
            deleted: true,
            created_on: "2026-01-02T09:06:00.000000+00:00",
            inline: { path: "README.md", from: null, to: 3 },
          }),
          comment({
            id: 401,
            content: { raw: "```suggestion\nretries = 3\n```" },
            created_on: "2026-01-02T09:07:00.000000+00:00",
            inline: { path: "pipe/pipe.py", from: null, to: 12, start_to: 10, outdated: true },
          }),
          comment({
            id: 501,
            content: { raw: "" },
            deleted: true,
            created_on: "2026-01-02T09:08:00.000000+00:00",
            inline: { path: "pipe/pipe.py", from: null, to: 50 },
          }),
          comment({
            id: 502,
            content: { raw: "Still worth a look." },
            user: null,
            created_on: "2026-01-02T09:09:00.000000+00:00",
            parent: { id: 501 },
          }),
        ],
      },
    },
  },
  {
    request: {
      method: "GET",
      url: `${API}/user/permissions/repositories?q=${encodeURIComponent('repository.full_name="atlassian/bitbucket-upload-file"').replaceAll("%20", "+")}`,
      accept: "application/json",
    },
    response: { status: 200, headers: JSON_HEADERS, body: { values: [{ permission: "write" }] } },
  },
  {
    request: {
      method: "POST",
      url: `${PR}/comments`,
      body: { content: { raw: "Thanks!" }, parent: { id: 101 } },
    },
    response: {
      status: 201,
      headers: JSON_HEADERS,
      body: comment({
        id: 105,
        content: { raw: "Thanks!" },
        created_on: "2026-01-03T09:00:00.000000+00:00",
        parent: { id: 101 },
      }),
    },
  },
  {
    request: { method: "POST", url: `${PR}/comments/101/resolve` },
    response: { status: 200, headers: JSON_HEADERS, body: { type: "comment_resolution" } },
  },
  {
    request: { method: "DELETE", url: `${PR}/comments/101/resolve` },
    response: { status: 204, headers: {}, body: null },
  },
  {
    request: { method: "GET", url: PR, accept: "application/json" },
    response: {
      status: 200,
      headers: JSON_HEADERS,
      body: {
        source: {
          branch: { name: "fix/cause" },
          commit: { hash: BITBUCKET_THREADS_HEAD.slice(0, 12) },
          repository: { full_name: "atlassian/bitbucket-upload-file" },
        },
        destination: { repository: { full_name: "atlassian/bitbucket-upload-file" } },
      },
    },
  },
  {
    request: {
      method: "POST",
      url: `${REPO}/src`,
      body: new URLSearchParams({
        message: "Apply suggestion from code review",
        branch: "fix/cause",
        parents: BITBUCKET_THREADS_HEAD,
        "/pipe/pipe.py": "retries = 3\n",
      }).toString(),
    },
    response: {
      status: 201,
      headers: { location: `${REPO}/commit/${"5".repeat(40)}` },
      body: null,
    },
  },
];

/** The branch moved after the PR was read: Bitbucket refuses the commit. */
export const refusedCommit: Exchange = {
  request: { method: "POST", url: `${REPO}/src` },
  response: {
    status: 409,
    headers: JSON_HEADERS,
    body: { type: "error", error: { message: "parents: the branch's tip has moved" } },
  },
};
