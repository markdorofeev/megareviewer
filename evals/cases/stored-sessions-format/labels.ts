import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Sessions stored before the change are `user|time` strings kept for 30 days, and decode now runs JSON.parse on them, which throws: every user signed in before the deploy gets an error instead of their session",
      type: "contract",
      mustHave: true,
      at: [{ hunkId: "h_7c2a641ae4e4d9d0", side: "new", lines: [14, 16] }],
    },
  ],
  mismatches: [],
};
