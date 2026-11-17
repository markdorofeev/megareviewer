import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";
import type { CaseGuidance } from "../../guidance.ts";

// Page 1 starts at the 51st event: the offset is the page times the page size. The console.log
// beside it is the kind of thing the reviewer asked not to be told about.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "preference-dont-flag",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "console" }, number: 88 },
    url: "https://github.com/acme/console/pull/88",
    title: "Page the audit log",
    description:
      "The audit log loaded the latest 200 events and nothing older. `GET /audit-log` now takes `?page=`, returns 50 events a page, newest first, and says how many pages there are, so the console can page back through the whole log.",
    author: { id: "tomas-reyes", name: "Tomás Reyes" },
    sourceBranch: "feature/audit-log-pages",
    targetBranch: "main",
    baseSha: "9d2c4e6f8a0b1c3d5e7f9a1b3c5d7e9f1a3b5c7d",
    headSha: "e1f3a5b7c9d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8",
    commits: [
      {
        sha: "e1f3a5b7c9d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8",
        message: "Page the audit log, 50 events a page",
        author: "Tomás Reyes",
      },
    ],
    createdAt: "2026-11-16T15:00:00Z",
    updatedAt: "2026-11-16T15:25:00Z",
  },
  tickets: [],
});

// The first preference matches nothing in the PR: a mark that names it is wrong.
export const guidance: CaseGuidance = {
  preferences: [
    {
      kind: "look-for",
      text: "Hard-coded secrets: API keys, tokens or passwords in code or config",
      scope: "global",
    },
    {
      kind: "dont-flag",
      text: "Leftover debug logging such as console.log: the lint step strips it before merge",
      scope: "repo",
    },
  ],
  guidelines: [],
};
