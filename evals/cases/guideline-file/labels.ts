import type { CaseLabels } from "../../labels.ts";

const migration = "h_dcc1fbe3f6a29adf";
const route = "h_cda7fd95ffdf660f";

export const labels: CaseLabels = {
  risk: {
    [migration]: "contract", // schema: a column and an index on subscriptions
    [route]: "contract", // new POST /subscriptions/:id/pause
    h_795da19db7c8ef04: "logic", // the field and column, following from the migration
    h_e41c5502431d69d2: "logic", // the update, called only by the new route
    h_cfa357a78312f67d: "logic", // import
  },
  riskAt: {
    [migration]: [
      { hunkId: migration, side: "new", lines: [2, 2] },
      { hunkId: migration, side: "new", lines: [4, 4] },
    ],
    [route]: [{ hunkId: route, side: "new", lines: [15, 21] }],
  },
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
  decisions: [
    {
      description:
        "Why pausing a subscription that's already paused keeps the time it was first paused at instead of the latest",
      mustHave: false,
    },
  ],
  mismatches: [],
  // g1: REVIEW.md. The missing down section may come as the finding or as the migration's risk;
  // either one naming the file follows it.
  guidance: [{ ref: "g1", effect: "raised", findings: [0], risks: [migration] }],
};
