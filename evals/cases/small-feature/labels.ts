import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_fbaf18305007c20a: "contract", // rate limit 60 → 600
    h_2e2332fa455a2146: "contract", // cache.ttlSeconds.receipts
    h_3822ea0f7192c70e: "contract", // receipts config section
    h_88747b653fc82f6d: "logic", // import
    h_5c94b39812b2e8f8: "contract", // GET /orders/:id/receipt
  },
  findings: [
    {
      description:
        "Raises the API rate limit tenfold, from 60 to 600 requests per minute, which nobody asked for",
      at: [{ hunkId: "h_fbaf18305007c20a", side: "new", lines: [13, 13] }],
      mustHave: true,
      mismatch: 0,
    },
    {
      description:
        "Caches rendered receipts in an in-process Map with no eviction or size limit (memory grows, not shared between instances)",
      at: [
        { hunkId: "h_a2e0236601ffc778", side: "new", lines: [4, 4] },
        { hunkId: "h_a2e0236601ffc778", side: "new", lines: [18, 18] },
      ],
      mustHave: true,
    },
    {
      description:
        "Hard-codes the receipt cache lifetime to one hour instead of reading the cache.ttlSeconds.receipts setting it adds",
      at: [
        { hunkId: "h_a2e0236601ffc778", side: "new", lines: [3, 3] },
        { hunkId: "h_a2e0236601ffc778", side: "new", lines: [18, 18] },
      ],
      mustHave: true,
      mismatch: 1,
    },
    {
      description:
        "Serves a cached receipt even if the order changed since (refunds, cancellations) for up to an hour",
      at: [{ hunkId: "h_a2e0236601ffc778", side: "new", lines: [9, 12] }],
      mustHave: false,
    },
  ],
  decisions: [
    {
      description:
        "Why add a public GET /orders/:id/receipt endpoint returning plain text: customers want to download a plain-text receipt (SHOP-123)",
      mustHave: false,
    },
  ],
  mismatches: [
    { kind: "unrequested", description: "The rate limit is raised from 60 to 600 per minute" },
    {
      kind: "missing",
      description:
        "The ticket asks for a configurable cache lifetime, but the code uses a hard-coded hour",
    },
  ],
};
