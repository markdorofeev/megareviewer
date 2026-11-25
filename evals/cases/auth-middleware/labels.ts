import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Accepts the session token in the URL query string on event streams, where it can leak into server and proxy logs, browser history and Referer headers",
      type: "contract",
      at: [{ hunkId: "h_5d61f179c40933a9", side: "new", lines: [8, 19] }],
      mustHave: true,
    },
    {
      description:
        "Uses the full long-lived session token in the URL rather than a short-lived, single-purpose stream token",
      type: "contract",
      at: [{ hunkId: "h_5d61f179c40933a9", side: "new", lines: [8, 19] }],
      mustHave: false,
    },
    {
      description:
        "Matches the stream route by path suffix (any GET path ending in /events), which may cover more endpoints than the order stream",
      type: "contract",
      at: [{ hunkId: "h_5d61f179c40933a9", side: "new", lines: [9, 9] }],
      mustHave: false,
    },
  ],
  mismatches: [],
};
