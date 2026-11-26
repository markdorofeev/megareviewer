import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles, outsideFiles } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "caller-keeps-old-unit",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 412 },
    url: "https://github.com/acme/shop/pull/412",
    title: "Keep order totals in cents",
    description:
      "SHOP-318. `orderTotal` returned dollars as a float, and adding totals up drifted by a cent. It now returns whole cents, and the summary divides for display.",
    author: { id: "jo-adeyemi", name: "Jo Adeyemi" },
    sourceBranch: "SHOP-318-totals-in-cents",
    targetBranch: "main",
    baseSha: "3b9f6a1d27c08e54f1a96b7702cd9e8341f05a6c",
    headSha: "a47d10e93f5b2c6688e1d4097f3c5b21e6d8097f",
    commits: [
      {
        sha: "a47d10e93f5b2c6688e1d4097f3c5b21e6d8097f",
        message: "Return order totals in cents",
        author: "Jo Adeyemi",
      },
    ],
    createdAt: "2026-11-24T09:00:00Z",
    updatedAt: "2026-11-24T09:30:00Z",
  },
  tickets: [
    {
      key: "SHOP-318",
      url: "https://example.atlassian.net/browse/SHOP-318",
      summary: "Order totals drift by a cent in reports",
      description:
        "Totals are floats in dollars, so sums of many orders are off by a cent or two. Keep them in whole cents and convert only when they're shown.",
      type: "Bug",
      status: "In Review",
    },
  ],
});

export const checkoutFiles = outsideFiles(new URL(".", import.meta.url));
