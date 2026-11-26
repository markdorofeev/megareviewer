import type { CaseLabels } from "../../labels.ts";

const duration = "h_9d47948fcd5c81cd";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "A call under a minute, or of no length, is shown as nothing: both parts are left out, where it read 0 min before",
      type: "logic",
      at: [{ hunkId: duration, side: "new", lines: [2, 8] }],
      mustHave: true,
    },
  ],
  mismatches: [],
  // Nothing in the harness speaks to it, so any mark is wrong.
  guidance: [],
  reads: [],
};
