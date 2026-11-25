import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Doesn't validate PAYMENTS_TIMEOUT_MS: a non-numeric value gives NaN and breaks every refund",
      type: "logic",
      at: [{ hunkId: "h_ef35a3a93a2acbf9", side: "new", lines: [12, 12] }],
      mustHave: false,
    },
    {
      description:
        "An aborted refund may still have been processed by the provider, and the caller sees it as failed",
      type: "logic",
      at: [{ hunkId: "h_37ae4299382fa27e", side: "new", lines: [11, 11] }],
      mustHave: false,
    },
  ],
  mismatches: [],
};
