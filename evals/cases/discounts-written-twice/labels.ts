import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "estimate.ts writes the discount tiers and the line's price again instead of calling discountRate or discountedLine in pricing/discounts.ts, so the next tier change makes a quote differ from the order",
      type: "architecture",
      mustHave: true,
      at: [{ hunkId: "h_595a5342cae1e2a8", side: "new", lines: [12, 25] }],
    },
  ],
  mismatches: [],
};
