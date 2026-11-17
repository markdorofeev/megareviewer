import type { CaseLabels } from "../../labels.ts";

const route = "h_760e73c73c497808";
const query = "h_3c995365613ccd2f";

export const labels: CaseLabels = {
  risk: {
    // GET /audit-log answers 50 events a page where it answered the latest 200, with new fields.
    [route]: "contract",
    [query]: "logic", // the page's query, called only by the route
  },
  riskAt: {
    [route]: [{ hunkId: route, side: "new", lines: [14, 21] }],
  },
  findings: [
    {
      description:
        "Page 1 starts at the 51st event and the last page is empty: the offset is the page number times the page size, though pages count from 1",
      at: [{ hunkId: route, side: "new", lines: [14, 15] }],
      mustHave: true,
    },
    {
      description: "Leaves a console.log of the page and offset in the request handler",
      at: [{ hunkId: route, side: "new", lines: [16, 16] }],
      mustHave: false,
    },
    {
      description:
        "Orders pages by the event time alone, so events with the same timestamp can repeat or go missing between pages",
      at: [{ hunkId: query, side: "new", lines: [25, 28] }],
      mustHave: false,
    },
  ],
  decisions: [
    {
      description:
        "Why a page that isn't a positive whole number shows the first page instead of answering an error",
      mustHave: false,
    },
  ],
  mismatches: [],
  // p2: leftover debug logging. It covers the console.log and nothing else: the paging bug two
  // lines up is a must-have, which leftOutRight fails when it's folded. p1, hard-coded secrets,
  // matches nothing here, so it has no label and any mark of it is wrong.
  guidance: [{ ref: "p2", effect: "left-out", findings: [1] }],
};
