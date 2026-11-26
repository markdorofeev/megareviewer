import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles, outsideFiles } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "optional-response-field",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "backoffice" }, number: 209 },
    url: "https://github.com/acme/backoffice/pull/209",
    title: "Say when a customer last ordered",
    description:
      "BO-88. GET /customers/:id gains an optional `lastOrderAt`, left out for a customer who never ordered. Nothing else in the response changes. The repository already loads `lastOrderAt`.",
    author: { id: "tomas-vale", name: "Tomas Vale" },
    sourceBranch: "BO-88-last-order",
    targetBranch: "main",
    baseSha: "f3a61d8c0e752b94d16a8f7bc0925e3d41b7086a",
    headSha: "28c7e5f90d1b463ae8f2c9705b3d14e6a78f0c92",
    commits: [
      {
        sha: "28c7e5f90d1b463ae8f2c9705b3d14e6a78f0c92",
        message: "Add lastOrderAt to the customer view",
        author: "Tomas Vale",
      },
    ],
    createdAt: "2026-11-18T10:00:00Z",
    updatedAt: "2026-11-18T10:15:00Z",
  },
  tickets: [
    {
      key: "BO-88",
      url: "https://example.atlassian.net/browse/BO-88",
      summary: "Show when a customer last ordered",
      description:
        "Support wants to see when a customer last ordered. Add it to the customer's API response, as an ISO date, and leave it out when there's no order.",
      type: "Story",
      status: "In Review",
    },
  ],
});

export const checkoutFiles = outsideFiles(new URL(".", import.meta.url));
