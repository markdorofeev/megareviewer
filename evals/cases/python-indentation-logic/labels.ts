import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    // Dedenting `count += …` out of the `if` changes what's counted. A mechanical proof here
    // would hide a logic change, so it must come out logic.
    h_0ea106903cb8153b: "logic",
  },
  riskAt: {},
  findings: [],
  decisions: [
    {
      description:
        "Why the item count now includes inactive items while the total still excludes them: the count should match the cart's, which counts out-of-stock items (BILL-88)",
      mustHave: true,
    },
  ],
  mismatches: [],
};
