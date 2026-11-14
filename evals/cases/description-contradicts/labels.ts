import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_b5e69834271ab368: "contract", // retries calls to the payment provider
    h_a4aefd56480883b9: "logic", // the retry's constants, which the retry loop carries
  },
  riskAt: {
    h_b5e69834271ab368: [{ hunkId: "h_b5e69834271ab368", side: "new", lines: [46, 52] }],
  },
  findings: [
    {
      description:
        "Retries charges without an idempotency key, so a charge that succeeded but timed out or errored can be made twice",
      at: [{ hunkId: "h_b5e69834271ab368", side: "new", lines: [45, 54] }],
      mustHave: true,
    },
    {
      description:
        "Retries every error, including declines and other 4xx responses that won't succeed on retry",
      at: [{ hunkId: "h_b5e69834271ab368", side: "new", lines: [49, 52] }],
      mustHave: true,
    },
    {
      description:
        "Waits a fixed 1 second between up to 10 attempts (no backoff), not the exponential backoff the description promises",
      at: [
        { hunkId: "h_a4aefd56480883b9", side: "new", lines: [24, 25] },
        { hunkId: "h_b5e69834271ab368", side: "new", lines: [46, 51] },
      ],
      mustHave: true,
      mismatch: 0,
    },
  ],
  decisions: [],
  mismatches: [
    {
      kind: "contradicts",
      description:
        "The description promises exponential backoff from 200 ms and at most 5 attempts; the code waits a fixed 1 s and tries up to 10 times",
    },
  ],
};
