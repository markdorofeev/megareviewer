import type { CaseLabels } from "../../labels.ts";

const publish = "h_5543f66d7be11384";

export const labels: CaseLabels = {
  risk: {
    [publish]: "contract", // a new event other systems subscribe to
    h_2f41bc6e8e7f66b9: "logic", // import
  },
  riskAt: {
    [publish]: [{ hunkId: publish, side: "new", lines: [22, 26] }],
  },
  findings: [
    {
      description:
        "The event is published as invoice.voided, without the version the handbook's Events section asks of every event name, so no subscription matches it and the broker drops it",
      at: [{ hunkId: publish, side: "new", lines: [22, 26] }],
      mustHave: true,
    },
    {
      description:
        "A failure to publish fails the request after the invoice was voided, so the client is told it wasn't and the event is lost",
      at: [{ hunkId: publish, side: "new", lines: [22, 27] }],
      mustHave: false,
    },
    {
      description: "Voiding an invoice that's already void publishes the event again",
      at: [{ hunkId: publish, side: "new", lines: [22, 27] }],
      mustHave: false,
    },
  ],
  decisions: [],
  mismatches: [],
  // g3: docs/handbook.md, which CLAUDE.md links. The unversioned name may come as the finding or
  // as the risk; either one naming the handbook follows it.
  guidance: [{ ref: "g3", effect: "raised", findings: [0], risks: [publish] }],
  reads: [{ pass: "findings", path: "docs/handbook.md" }],
};
