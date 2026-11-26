import type { CaseLabels } from "../../labels.ts";

const query = "h_40cb732c8cf37cf7";
const tests = "h_0f363a82d18bf6e4";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Without a status filter the ticket query has no tenant condition, so the list returns every tenant's tickets, and with only an assignee any tenant's: the tenant ID is added inside the status branch",
      type: "contract",
      at: [
        { hunkId: query, side: "new", lines: [29, 32] },
        { hunkId: query, side: "new", lines: [37, 40] },
      ],
      mustHave: true,
    },
    {
      description:
        "The test for listing without a status only checks that the query has no status condition, so nothing checks the tenant filter on that path",
      type: "logic",
      at: [{ hunkId: tests, side: "new", lines: [28, 32] }],
      mustHave: false,
    },
  ],
  // The description asks for the filters and says nothing of tenants, so the leak is a bug it
  // doesn't speak of, a finding and no mismatch, as auth-middleware's token in the URL is.
  mismatches: [],
  // p1: tenant isolation. Its mark belongs on the leak; the finding about the test may carry it too.
  guidance: [
    {
      ref: "p1",
      effect: "raised",
      findings: [0],
      alsoOn: [1],
    },
  ],
};
