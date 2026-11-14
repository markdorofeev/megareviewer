import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_5d61f179c40933a9: "contract", // authentication boundary
    h_c0a62759085678d3: "logic", // tests
  },
  riskAt: {
    h_5d61f179c40933a9: [
      { hunkId: "h_5d61f179c40933a9", side: "new", lines: [8, 12] },
      { hunkId: "h_5d61f179c40933a9", side: "new", lines: [17, 19] },
    ],
  },
  findings: [
    {
      description:
        "Accepts the session token in the URL query string on event streams, where it can leak into server and proxy logs, browser history and Referer headers",
      at: [{ hunkId: "h_5d61f179c40933a9", side: "new", lines: [8, 19] }],
      mustHave: true,
    },
    {
      description:
        "Uses the full long-lived session token in the URL rather than a short-lived, single-purpose stream token",
      at: [{ hunkId: "h_5d61f179c40933a9", side: "new", lines: [8, 19] }],
      mustHave: false,
    },
    {
      description:
        "Matches the stream route by path suffix (any GET path ending in /events), which may cover more endpoints than the order stream",
      at: [{ hunkId: "h_5d61f179c40933a9", side: "new", lines: [9, 9] }],
      mustHave: false,
    },
  ],
  decisions: [],
  mismatches: [],
};
