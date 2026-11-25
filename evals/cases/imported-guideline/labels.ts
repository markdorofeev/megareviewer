import type { CaseLabels } from "../../labels.ts";

const route = "h_ab18dd9c4996e4c6";
const removeMember = "h_873911e7bd5a7d88";

export const labels: CaseLabels = {
  risk: {
    [route]: "contract", // new DELETE that takes away someone's access
    [removeMember]: "either", // the query only the new route calls, and what it deletes
    h_6f14bd88380d101e: "logic", // import
  },
  riskAt: {
    [route]: [{ hunkId: route, side: "new", lines: [14, 25] }],
  },
  findings: [
    {
      description:
        "Removing a member isn't recorded: the handler takes away someone's access without calling recordAccess, which docs/service-rules.md asks of every change to access",
      at: [
        { hunkId: route, side: "new", lines: [14, 25] },
        { hunkId: removeMember, side: "new", lines: [15, 27] },
      ],
      mustHave: true,
    },
    {
      description:
        "Answers 404 member_not_found for an owner, who is a member, so the client can't tell why they weren't removed",
      at: [
        { hunkId: route, side: "new", lines: [20, 23] },
        { hunkId: removeMember, side: "new", lines: [20, 27] },
      ],
      mustHave: false,
    },
  ],
  decisions: [
    {
      description: "Why someone who can't administer the project gets a 404 and not a 403",
      mustHave: false,
    },
  ],
  mismatches: [],
  // g2: docs/service-rules.md, which CLAUDE.md imports. The unrecorded removal may come as the
  // finding or as the route's risk; either one naming the file the rule is in follows it.
  guidance: [{ ref: "g2", effect: "raised", findings: [0], risks: [route] }],
};
