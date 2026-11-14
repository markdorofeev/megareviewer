import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_901f64fb4baa9ec3: "contract", // migration
    h_d0c1c2644b662381: "contract", // insert persists region
    h_6c44d4960df7be29: "contract", // API body accepts region
    h_d9b986572f79a476: "logic", // Region type and Account field, following from the migration
    h_74550438acb8f078: "logic", // the row type's column, following from the migration
  },
  riskAt: {
    h_901f64fb4baa9ec3: [{ hunkId: "h_901f64fb4baa9ec3", side: "new", lines: [2, 2] }],
    h_d0c1c2644b662381: [
      { hunkId: "h_d0c1c2644b662381", side: "new", lines: [31, 31] },
      { hunkId: "h_d0c1c2644b662381", side: "new", lines: [34, 35] },
    ],
    h_6c44d4960df7be29: [{ hunkId: "h_6c44d4960df7be29", side: "new", lines: [9, 9] }],
  },
  findings: [
    {
      description:
        "Builds the region index without CONCURRENTLY, which blocks writes to accounts while it builds",
      at: [{ hunkId: "h_901f64fb4baa9ec3", side: "new", lines: [4, 4] }],
      mustHave: false,
    },
  ],
  decisions: [
    {
      description:
        "Why backfill every existing account with region us-east-1 through a NOT NULL DEFAULT: all existing data lives in that region",
      mustHave: true,
    },
    {
      description:
        "Why new accounts default to us-east-1 when signup sends no region, instead of requiring a choice",
      mustHave: false,
    },
  ],
  mismatches: [],
};
