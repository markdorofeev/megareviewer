import type { CaseLabels } from "../../labels.ts";

const publish = "h_5543f66d7be11384";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "The event is published as invoice.voided, without the version the handbook's Events section asks of every event name, so no subscription matches it and the broker drops it",
      type: "contract",
      at: [{ hunkId: publish, side: "new", lines: [22, 26] }],
      mustHave: true,
    },
    {
      description:
        "A failure to publish fails the request after the invoice was voided, so the client is told it wasn't and the event is lost",
      type: "logic",
      at: [{ hunkId: publish, side: "new", lines: [22, 27] }],
      mustHave: false,
    },
    {
      description: "Voiding an invoice that's already void publishes the event again",
      type: "logic",
      at: [{ hunkId: publish, side: "new", lines: [22, 27] }],
      mustHave: false,
    },
  ],
  mismatches: [],
  // g3: docs/handbook.md, which CLAUDE.md links.
  guidance: [{ ref: "g3", effect: "raised", findings: [0] }],
  reads: [{ pass: "findings", path: "docs/handbook.md" }],
};
