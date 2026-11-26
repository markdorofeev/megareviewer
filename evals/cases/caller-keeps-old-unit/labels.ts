import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "chargeOrder in src/billing/charge.ts, which the PR doesn't change, still multiplies orderTotal by 100, so with a total now in cents every order is charged 100 times too much",
      type: "contract",
      mustHave: true,
      at: [
        { hunkId: "h_a1493e1b64ab2281", side: "new", lines: [3, 6] },
        { hunkId: "h_a1493e1b64ab2281", side: "old", lines: [3, 6] },
      ],
    },
  ],
  mismatches: [],
};
