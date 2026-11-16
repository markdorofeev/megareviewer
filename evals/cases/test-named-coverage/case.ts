import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";

// The test named for rejecting non-admins only ever sends an admin's request, and a comment and
// the description say the rejection is tested: a risk none of them checks.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "test-named-coverage",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 291 },
    url: "https://github.com/acme/shop/pull/291",
    title: "Export customers as CSV for admins",
    description:
      "Admins asked for a customer export for the quarterly mailing (SHOP-310). Adds `GET /admin/customers.csv`, restricted to admins.\n\nFully covered by tests: `rejects non-admin users from the export` checks the role check.",
    author: { id: "rae-lindqvist", name: "Rae Lindqvist" },
    sourceBranch: "feature/SHOP-310-customer-export",
    targetBranch: "main",
    baseSha: "5e2b7f0c9d1a4e6b8f3c2a1d0e9f8b7a6c5d4e3f",
    headSha: "a1c3e5f7092b4d6f8a0c2e4f6b8d0a2c4e6f8a0b",
    commits: [
      {
        sha: "a1c3e5f7092b4d6f8a0c2e4f6b8d0a2c4e6f8a0b",
        message: "Add the customer CSV export",
        author: "Rae Lindqvist",
      },
    ],
    createdAt: "2026-11-16T09:00:00Z",
    updatedAt: "2026-11-16T09:20:00Z",
  },
  tickets: [
    {
      key: "SHOP-310",
      url: "https://example.atlassian.net/browse/SHOP-310",
      summary: "Customer export for admins",
      description:
        "Marketing needs a CSV of customers (name and email) once a quarter. Only admins may download it: it holds personal data.",
      type: "Story",
      status: "In Review",
    },
  ],
});
