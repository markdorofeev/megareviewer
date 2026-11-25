import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";
import { largeHarness } from "../../large-harness.ts";

// A call shorter than a minute showed "0 min" and now shows nothing. The repository's harness is
// half a megabyte about firmware and hardware, and speaks to none of it.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "unrelated-harness",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "devices" }, number: 18 },
    url: "https://github.com/acme/devices/pull/18",
    title: "Show a call's length in hours and minutes",
    description:
      'A long call reads "95 min" in the support console. From an hour on, its length is now in hours and minutes, "1 h 35 min".',
    author: { id: "jonas-weber", name: "Jonas Weber" },
    sourceBranch: "feature/call-hours",
    targetBranch: "main",
    baseSha: "1f3a5c7e9b0d2f4a6c8e0b2d4f6a8c0e1b3d5f7a",
    headSha: "6b8d0f2a4c6e8b0d1f3a5c7e9b1d3f5a7c9e0b2d",
    commits: [
      {
        sha: "6b8d0f2a4c6e8b0d1f3a5c7e9b1d3f5a7c9e0b2d",
        message: "Show hours in a call's length",
        author: "Jonas Weber",
      },
    ],
    createdAt: "2026-11-25T11:00:00Z",
    updatedAt: "2026-11-25T11:10:00Z",
  },
  tickets: [],
});

export const guidance = largeHarness;
