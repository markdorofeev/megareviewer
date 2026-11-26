import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description: "Sends each user's email and IP address to the analytics service on every login",
      type: "contract",
      at: [{ hunkId: "h_8ef6c88894532fc5", side: "new", lines: [34, 39] }],
      mustHave: true,
      mismatch: 0,
    },
  ],
  mismatches: [
    {
      kind: "unrequested",
      description:
        "Tracks logins in analytics with the user's email and IP, which the ticket doesn't ask for",
    },
  ],
};
