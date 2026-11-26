import type { CaseLabels } from "../../labels.ts";

const route = "h_ab18dd9c4996e4c6";
const removeMember = "h_873911e7bd5a7d88";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Removing a member isn't recorded: the handler takes away someone's access without calling recordAccess, which docs/service-rules.md asks of every change to access",
      type: "logic",
      at: [
        { hunkId: route, side: "new", lines: [14, 25] },
        { hunkId: removeMember, side: "new", lines: [15, 27] },
      ],
      mustHave: true,
    },
    {
      description:
        "Answers 404 member_not_found for an owner, who is a member, so the client can't tell why they weren't removed",
      type: "logic",
      at: [
        { hunkId: route, side: "new", lines: [20, 23] },
        { hunkId: removeMember, side: "new", lines: [20, 27] },
      ],
      mustHave: false,
    },
  ],
  mismatches: [],
  // g2: docs/service-rules.md, which CLAUDE.md imports.
  guidance: [{ ref: "g2", effect: "raised", findings: [0] }],
};
