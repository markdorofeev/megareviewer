import type { CaseLabels } from "../../labels.ts";

const migration = "h_dcc1fbe3f6a29adf";
const route = "h_cda7fd95ffdf660f";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "The migration has an up section and no down section, so it can't be rolled back, and REVIEW.md asks every migration to be reversible or the PR to say why it isn't",
      at: [{ hunkId: migration, side: "new", lines: [1, 4] }],
      mustHave: true,
    },
    {
      description:
        "Answers 404 subscription_not_found for a subscription that exists but is cancelled, so the client can't tell why it wasn't paused",
      at: [
        { hunkId: route, side: "new", lines: [16, 19] },
        { hunkId: "h_e41c5502431d69d2", side: "new", lines: [31, 33] },
      ],
      mustHave: false,
    },
    {
      description:
        "Builds the index without CONCURRENTLY, which blocks writes to subscriptions while it builds",
      at: [{ hunkId: migration, side: "new", lines: [4, 4] }],
      mustHave: false,
    },
  ],
  mismatches: [],
  // g1: REVIEW.md, which the missing down section breaks.
  guidance: [{ ref: "g1", effect: "raised", findings: [0] }],
};
