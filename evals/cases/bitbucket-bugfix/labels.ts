import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_916b942fb92913f9: "logic", // null check in refundAmount
    h_1fd5161b01e4eb07: "logic", // test
  },
  findings: [],
  decisions: [
    {
      description:
        "Why return 0 for an order with no original payment, rather than failing or refunding to store credit: store-credit orders have no payment to refund, and refundAmount crashed on them",
      mustHave: true,
    },
  ],
  mismatches: [],
};
