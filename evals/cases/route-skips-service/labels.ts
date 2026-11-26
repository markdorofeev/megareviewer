import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "The restore route runs its own SQL on projects, past ProjectService and ProjectRepository, which the archive route beside it and everything else go through",
      type: "architecture",
      mustHave: true,
      at: [
        { hunkId: "h_c716168796aa7a38", side: "new", lines: [20, 30] },
        { hunkId: "h_c00c67ff7ca35fe5", side: "new", lines: [2, 5] },
      ],
    },
  ],
  mismatches: [],
};
