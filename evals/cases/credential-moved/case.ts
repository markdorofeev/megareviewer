import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "credential-moved",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "accounts" }, number: 140 },
    url: "https://github.com/acme/accounts/pull/140",
    title: "Read the mail API key in the config module",
    description:
      "ACC-411. Moves reading `MAIL_API_KEY` from the mail sender to `src/config/`, where it can be tested. Same variable, same error when it's missing, still read at startup.",
    author: { id: "mira-holt", name: "Mira Holt" },
    sourceBranch: "ACC-411-mail-config",
    targetBranch: "main",
    baseSha: "48b0e1f7c93d6a2580d4e6b9f15c7a32e08d1b64",
    headSha: "d5f27a0c81e946b3f7d0a2e8c6b5194371f0ea2d",
    commits: [
      {
        sha: "d5f27a0c81e946b3f7d0a2e8c6b5194371f0ea2d",
        message: "Move the mail API key to the config module",
        author: "Mira Holt",
      },
    ],
    createdAt: "2026-11-17T15:00:00Z",
    updatedAt: "2026-11-17T15:10:00Z",
  },
  tickets: [
    {
      key: "ACC-411",
      url: "https://example.atlassian.net/browse/ACC-411",
      summary: "Test the mail configuration",
      description:
        "Reading the mail API key happens when the module loads, so it can't be tested. Move it to the config module and test it. Nothing else should change.",
      type: "Task",
      status: "In Review",
    },
  ],
});
