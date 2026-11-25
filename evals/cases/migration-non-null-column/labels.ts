import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Builds the region index without CONCURRENTLY, which blocks writes to accounts while it builds",
      at: [{ hunkId: "h_901f64fb4baa9ec3", side: "new", lines: [4, 4] }],
      mustHave: false,
    },
  ],
  mismatches: [],
};
