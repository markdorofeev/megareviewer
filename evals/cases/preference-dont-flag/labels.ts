import type { CaseLabels } from "../../labels.ts";

const route = "h_760e73c73c497808";
const query = "h_3c995365613ccd2f";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Page 1 starts at the 51st event and the last page is empty: the offset is the page number times the page size, though pages count from 1",
      at: [{ hunkId: route, side: "new", lines: [14, 15] }],
      mustHave: true,
      mismatch: 0,
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
  // The description says the console can page back through the whole log, newest first, and the
  // code can't reach the newest 50: as test-named-coverage's bug does, it defeats what was asked.
  // None was expected at first. The console.log is no mismatch: a leftover, not a behavior.
  mismatches: [
    {
      kind: "contradicts",
      description:
        "Page 1 skips the newest 50 events, so the log can't be paged through whole, newest first, as the description says",
    },
  ],
  // p2: leftover debug logging. It covers the console.log and nothing else: the paging bug two
  // lines up is a must-have, which leftOutRight fails when it's folded. p1, hard-coded secrets,
  // matches nothing here, so it has no label and any mark of it is wrong.
  guidance: [{ ref: "p2", effect: "left-out", findings: [1] }],
};
