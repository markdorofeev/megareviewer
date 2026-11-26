import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "discounts-written-twice",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 431 },
    url: "https://github.com/acme/shop/pull/431",
    title: "Add a 500-unit discount and quote estimates",
    description:
      "SHOP-340. Lines of 500 units or more get 20% off, and the new `estimate` prices a quote before it's ordered, with the same discounts as an order.",
    author: { id: "jo-adeyemi", name: "Jo Adeyemi" },
    sourceBranch: "SHOP-340-quote-estimates",
    targetBranch: "main",
    baseSha: "c2d8e7015ba94f6330d1e8b9f7542ac6e0371d8f",
    headSha: "7e90b3d1f6c84a25e9b0d7134fa6c8522e1b09d3",
    commits: [
      {
        sha: "7e90b3d1f6c84a25e9b0d7134fa6c8522e1b09d3",
        message: "Add the 500-unit tier and quote estimates",
        author: "Jo Adeyemi",
      },
    ],
    createdAt: "2026-11-19T08:30:00Z",
    updatedAt: "2026-11-19T09:00:00Z",
  },
  tickets: [
    {
      key: "SHOP-340",
      url: "https://example.atlassian.net/browse/SHOP-340",
      summary: "Quotes for large orders",
      description:
        "Add a 20% discount from 500 units. The quote page needs a function that prices a list of lines the way an order would.",
      type: "Story",
      status: "In Review",
    },
  ],
});
