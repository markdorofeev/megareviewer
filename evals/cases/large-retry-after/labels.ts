import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [],
  mismatches: [
    {
      kind: "unrequested",
      description:
        "Beyond Retry-After handling, response body reads are now subject to totalTimeout",
    },
  ],
};
