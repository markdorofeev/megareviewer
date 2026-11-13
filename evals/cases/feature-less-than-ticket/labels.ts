import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_cf32c71b35173a7f: "contract", // new admin endpoint
  },
  findings: [
    {
      description:
        "Exports every order in one response with no date range, limit or streaming, loading all orders into memory",
      at: [{ hunkId: "h_cf32c71b35173a7f", side: "new", lines: [14, 20] }],
      mustHave: true,
      mismatch: 0,
    },
    {
      description: "Builds CSV rows by joining values with commas without quoting or escaping",
      at: [{ hunkId: "h_50b0def4be0636d1", side: "new", lines: [7, 15] }],
      mustHave: false,
    },
  ],
  decisions: [],
  mismatches: [
    {
      kind: "missing",
      description: "The ticket requires limiting the export to a date range; there is no filter",
    },
    {
      kind: "missing",
      description: "The ticket asks for a customer email column; the CSV has none",
    },
  ],
};
