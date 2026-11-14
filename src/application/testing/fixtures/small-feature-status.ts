import type { PullRequestStatus } from "../../../domain/review/index.ts";

/** Where small-feature stands on its host: changes requested, and CI passed but one skipped. */
export const smallFeatureStatus: PullRequestStatus = {
  state: "open",
  reviewStatus: "changes-requested",
  reviewers: [
    { id: "lena-s", name: "Lena Sato", team: false, verdict: "changes-requested" },
    { id: "jk-ortiz", name: "J. K. Ortiz", team: false, verdict: "approved" },
    { id: "lee-park", name: "Lee Park", team: false, verdict: null },
  ],
  checks: [
    {
      name: "test (22)",
      state: "passed",
      url: "https://github.com/acme/shop/actions/runs/1/job/1",
    },
    {
      name: "test (24)",
      state: "passed",
      url: "https://github.com/acme/shop/actions/runs/1/job/2",
    },
    { name: "lint", state: "passed", url: "https://github.com/acme/shop/actions/runs/1/job/3" },
    { name: "deploy-preview", state: "skipped", url: null },
  ],
  checksUnreadable: null,
};
