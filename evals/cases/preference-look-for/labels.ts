import type { CaseLabels } from "../../labels.ts";

const query = "h_40cb732c8cf37cf7";
const tests = "h_0f363a82d18bf6e4";

export const labels: CaseLabels = {
  risk: {
    [query]: "contract", // which tenant's tickets the list query reads
    // Callers that send no status now get every status, not the open ones; the query's risk may
    // fairly carry it.
    h_c3e143bd1562c027: "either",
    h_c19b040b96f3a528: "logic", // a test's call, following the new signature
    [tests]: "logic", // tests
  },
  riskAt: {
    [query]: [
      { hunkId: query, side: "new", lines: [29, 32] },
      { hunkId: query, side: "new", lines: [37, 40] },
    ],
  },
  // Two tests assert the tenant condition where a status is set; none where it isn't, which is
  // the path that loses it.
  checkedBy: { [query]: "either" },
  findings: [
    {
      description:
        "Without a status filter the ticket query has no tenant condition, so the list returns every tenant's tickets, and with only an assignee any tenant's: the tenant ID is added inside the status branch",
      at: [
        { hunkId: query, side: "new", lines: [29, 32] },
        { hunkId: query, side: "new", lines: [37, 40] },
      ],
      mustHave: true,
    },
    {
      description:
        "The test for listing without a status only checks that the query has no status condition, so nothing checks the tenant filter on that path",
      at: [{ hunkId: tests, side: "new", lines: [28, 32] }],
      mustHave: false,
    },
  ],
  decisions: [
    {
      description:
        "Why a missing or unknown status lists tickets of every status instead of falling back to open: the All tab sends none",
      mustHave: false,
    },
  ],
  mismatches: [],
  // p1: tenant isolation. Its mark belongs on the finding; the risk on the query and the finding
  // about the test may carry it too.
  guidance: [
    {
      ref: "p1",
      effect: "raised",
      findings: [0],
      alsoOn: { findings: [1], risks: [query] },
    },
  ],
};
