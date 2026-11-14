import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_8ef6c88894532fc5: "contract", // session lifetime, cookie and analytics call
    h_c436db7f164080f1: "logic", // checkbox
    // The 30-day lifetime is set here and applied in the next hunk, which carries the risk; the
    // optional rememberMe field breaks no client. Either is fair.
    h_8308e79dfd07ed71: "either",
  },
  riskAt: {
    h_8ef6c88894532fc5: [
      { hunkId: "h_8ef6c88894532fc5", side: "new", lines: [25, 33] },
      { hunkId: "h_8ef6c88894532fc5", side: "new", lines: [34, 39] },
    ],
  },
  findings: [
    {
      description: "Sends each user's email and IP address to the analytics service on every login",
      at: [{ hunkId: "h_8ef6c88894532fc5", side: "new", lines: [34, 39] }],
      mustHave: true,
      mismatch: 0,
    },
  ],
  decisions: [
    {
      description:
        "Why remembered sessions and their cookies last 30 days: the ticket asks to keep customers signed in for 30 days",
      mustHave: false,
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
