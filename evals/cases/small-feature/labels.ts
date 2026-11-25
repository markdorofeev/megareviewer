import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Raises the API rate limit tenfold, from 60 to 600 requests per minute, which nobody asked for",
      type: "contract",
      at: [{ hunkId: "h_fbaf18305007c20a", side: "new", lines: [13, 13] }],
      mustHave: true,
      mismatch: 0,
    },
    {
      description:
        "Caches rendered receipts in an in-process Map with no eviction or size limit (memory grows, not shared between instances)",
      type: "logic",
      at: [
        { hunkId: "h_a2e0236601ffc778", side: "new", lines: [4, 4] },
        { hunkId: "h_a2e0236601ffc778", side: "new", lines: [18, 18] },
      ],
      mustHave: true,
    },
    {
      description:
        "Hard-codes the receipt cache lifetime to one hour instead of reading the cache.ttlSeconds.receipts setting it adds",
      type: "logic",
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
      type: "logic",
      at: [{ hunkId: "h_a2e0236601ffc778", side: "new", lines: [9, 12] }],
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
