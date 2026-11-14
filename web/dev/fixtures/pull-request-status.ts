import type { PullRequestStatus } from "../../../src/domain/review/index.ts";

const run = (job: number) => `https://github.com/acme/shop/actions/runs/7/job/${job}`;

/** Where the mock PR stands: changes requested, one approval, one waiting, and CI passed. */
export const fixturePullRequestStatus: PullRequestStatus = {
  state: "open",
  reviewStatus: "changes-requested",
  reviewers: [
    { id: "lena-sato", name: "Lena Sato", team: false, verdict: "changes-requested" },
    { id: "jk-ortiz", name: "J. K. Ortiz", team: false, verdict: "approved" },
    { id: "sam-rivera", name: "Sam Rivera", team: false, verdict: null },
  ],
  checks: [
    ...["build", "lint", "typecheck", "unit (22)", "unit (24)", "e2e (chromium)"].map(
      (name, index) => ({ name, state: "passed" as const, url: run(index + 1) }),
    ),
    ...["e2e (webkit)", "e2e (firefox)", "contrast", "deps", "coverage", "bundle size"].map(
      (name, index) => ({ name, state: "passed" as const, url: run(index + 7) }),
    ),
    { name: "deploy-preview", state: "skipped", url: null },
  ],
  checksUnreadable: null,
};
