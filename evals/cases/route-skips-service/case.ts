import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "route-skips-service",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "planner" }, number: 58 },
    url: "https://github.com/acme/planner/pull/58",
    title: "Archive and restore projects",
    description:
      "PLAN-77. Adds POST /projects/:id/archive and POST /projects/:id/restore, for the project's owner.",
    author: { id: "tomas-vale", name: "Tomas Vale" },
    sourceBranch: "PLAN-77-archive-projects",
    targetBranch: "main",
    baseSha: "90b1c4f7d2e63a58b7c019fe4d82a6531c0f7be9",
    headSha: "1fc6a908e5d3b7246a0e9c71fb58d42036ea7b5d",
    commits: [
      {
        sha: "1fc6a908e5d3b7246a0e9c71fb58d42036ea7b5d",
        message: "Archive and restore projects",
        author: "Tomas Vale",
      },
    ],
    createdAt: "2026-11-20T13:00:00Z",
    updatedAt: "2026-11-20T13:20:00Z",
  },
  tickets: [
    {
      key: "PLAN-77",
      url: "https://example.atlassian.net/browse/PLAN-77",
      summary: "Archive projects",
      description:
        "Owners can archive a project they no longer work on, and restore it later. Answer 404 for a project that isn't theirs.",
      type: "Story",
      status: "In Review",
    },
  ],
});
