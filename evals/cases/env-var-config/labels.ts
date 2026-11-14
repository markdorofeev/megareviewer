import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_ef35a3a93a2acbf9: "contract", // PAYMENTS_TIMEOUT_MS
    h_37ae4299382fa27e: "contract", // timeout on the payment provider call
    h_dec7b75148469e68: "logic", // docs
  },
  riskAt: {
    h_ef35a3a93a2acbf9: [{ hunkId: "h_ef35a3a93a2acbf9", side: "new", lines: [12, 12] }],
    h_37ae4299382fa27e: [{ hunkId: "h_37ae4299382fa27e", side: "new", lines: [11, 11] }],
  },
  findings: [
    {
      description:
        "Doesn't validate PAYMENTS_TIMEOUT_MS: a non-numeric value gives NaN and breaks every refund",
      at: [{ hunkId: "h_ef35a3a93a2acbf9", side: "new", lines: [12, 12] }],
      mustHave: false,
    },
    {
      description:
        "An aborted refund may still have been processed by the provider, and the caller sees it as failed",
      at: [{ hunkId: "h_37ae4299382fa27e", side: "new", lines: [11, 11] }],
      mustHave: false,
    },
  ],
  decisions: [
    {
      description:
        "Why abort refund requests after 5 seconds by default, so slow refunds that used to complete now fail: they could hang forever when the provider is slow",
      mustHave: true,
    },
  ],
  mismatches: [],
};
