import type { CaseLabels } from "../../labels.ts";

const duration = "h_9d47948fcd5c81cd";

export const labels: CaseLabels = {
  risk: {
    [duration]: "logic", // how a length is shown
    h_b10a1d87584f3dbc: "logic", // its tests
  },
  riskAt: {},
  findings: [
    {
      description:
        "A call under a minute, or of no length, is shown as nothing: both parts are left out, where it read 0 min before",
      at: [{ hunkId: duration, side: "new", lines: [2, 8] }],
      mustHave: true,
    },
  ],
  decisions: [],
  mismatches: [],
  // Nothing in the harness speaks to it, so any mark is wrong.
  guidance: [],
  reads: [],
};
