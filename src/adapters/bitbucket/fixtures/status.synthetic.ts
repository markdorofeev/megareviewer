// Written from Bitbucket Cloud's REST docs for atlassian/bitbucket-upload-file#26: a PR whose
// participants have every verdict, and build statuses of every state. `draft`, a participant's
// `role`, `approved` and `state`, and an empty statuses page match a real PR's answer; a status
// of each state doesn't have a recording yet.

/** One request and its answer, in the shape `createFixtureFetch` reads. */
interface Exchange {
  readonly request: { method: string; url: string; accept?: string; body?: unknown };
  readonly response: { status: number; headers: Record<string, string>; body: unknown };
}

const API = "https://api.bitbucket.org/2.0";
const REPO = `${API}/repositories/atlassian/bitbucket-upload-file`;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
export const BITBUCKET_STATUS_HEAD = "3f9a2c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";
export const BITBUCKET_HEAD_WITHOUT_CHECKS = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";

const account = (id: string, name: string) => ({ uuid: `{${id}}`, display_name: name });
export const AUTHOR = account("7d1e0f6a-1b2c-4d3e-8f4a-5b6c7d8e9f01", "Mark");
const lee = account("9b6f3c2e-1a4d-4c8b-8e2f-7d5a0c9b3e14", "Lee Park");
const ana = account("0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", "Ana Silva");
const jk = account("1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b", "J. K. Ortiz");
const ruth = account("2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c", "Ruth Ng");

const get = (url: string, status: number, body: unknown): Exchange => ({
  request: { method: "GET", url, accept: "application/json" },
  response: { status, headers: JSON_HEADERS, body },
});

const participant = (user: unknown, role: string, approved: boolean, state: string | null) => ({
  user,
  role,
  approved,
  state,
});

const pullRequest = {
  state: "OPEN",
  draft: false,
  author: AUTHOR,
  participants: [
    participant(lee, "REVIEWER", false, null),
    participant(jk, "REVIEWER", false, "changes_requested"),
    participant(ruth, "REVIEWER", true, "approved"),
    participant(ana, "PARTICIPANT", false, null),
    // The author takes part in their own PR's conversation.
    participant(AUTHOR, "PARTICIPANT", false, null),
  ],
};

const statuses = (head: string) => `${REPO}/commit/${head}/statuses?pagelen=100`;

const buildStatus = (key: string, name: string | null, state: string, url: string) => ({
  key,
  name,
  state,
  url,
});

export const bitbucketStatusExchanges: Exchange[] = [
  get(`${REPO}/pullrequests/26`, 200, pullRequest),
  get(`${REPO}/pullrequests/999999`, 404, {
    type: "error",
    error: { message: "Pull request not found" },
  }),
  get(statuses(BITBUCKET_STATUS_HEAD), 200, {
    values: [
      buildStatus(
        "pipeline-1",
        "Pipeline #41 for main",
        "SUCCESSFUL",
        "https://bitbucket.org/atlassian/bitbucket-upload-file/pipelines/results/41",
      ),
      buildStatus("lint", null, "FAILED", "https://ci.example.com/lint/7"),
      buildStatus("deploy", "Deploy", "INPROGRESS", "https://ci.example.com/deploy/3"),
      buildStatus("e2e", "End to end", "STOPPED", "ftp://ci.example.com/e2e"),
    ],
  }),
  get(statuses(BITBUCKET_HEAD_WITHOUT_CHECKS), 200, { values: [] }),
];

/** A token without the scope to read the repository's build statuses. */
export const bitbucketStatusWithoutChecksExchanges: Exchange[] = [
  get(`${REPO}/pullrequests/26`, 200, pullRequest),
  get(statuses(BITBUCKET_STATUS_HEAD), 403, {
    type: "error",
    error: { message: "Your credentials lack one or more required privilege scopes." },
  }),
];
