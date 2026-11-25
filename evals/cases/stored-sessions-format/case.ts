import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "stored-sessions-format",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "accounts" }, number: 131 },
    url: "https://github.com/acme/accounts/pull/131",
    title: "Keep the acting organization in the session",
    description:
      "ACC-402. A session now records the organization the user acts for, so requests don't look it up each time. Sessions are stored as JSON instead of the `user|time` string, which had no room for another field.",
    author: { id: "mira-holt", name: "Mira Holt" },
    sourceBranch: "ACC-402-session-organization",
    targetBranch: "main",
    baseSha: "5d0c2e8b1f4a7396e0d8c5b2a1f947630e8bd1c4",
    headSha: "e81f3b60c79d52a4460b8f1e9dc72a35b04e6f18",
    commits: [
      {
        sha: "e81f3b60c79d52a4460b8f1e9dc72a35b04e6f18",
        message: "Store the acting organization in the session",
        author: "Mira Holt",
      },
    ],
    createdAt: "2026-11-23T11:00:00Z",
    updatedAt: "2026-11-23T11:40:00Z",
  },
  tickets: [
    {
      key: "ACC-402",
      url: "https://example.atlassian.net/browse/ACC-402",
      summary: "Remember the organization a user acts for",
      description:
        "Every request looks up the user's current organization. Keep it in the session, and make it available on the request.",
      type: "Story",
      status: "In Review",
    },
  ],
});
