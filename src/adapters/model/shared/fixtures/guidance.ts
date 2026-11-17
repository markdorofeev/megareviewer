// Test support: a reviewer's guidance as a model run would send it.

import type { AnalysisInput, InputGuidance } from "../../../../application/ports/index.ts";

export const guidance: InputGuidance = {
  preferences: [
    {
      ref: "p1",
      kind: "look-for",
      text: "Tenant isolation: every query on a tenant's data filters by tenant ID",
      scope: "global",
    },
    { ref: "p2", kind: "dont-flag", text: "Naming of test helpers", scope: "repo" },
  ],
  guidelines: [{ ref: "g1", path: "REVIEW.md", content: "# Review\n\nNo raw SQL in routes.\n" }],
};

export const withGuidance = (input: AnalysisInput): AnalysisInput => ({ ...input, guidance });

/** How the guidance block starts, right before the PR's. */
export const GUIDANCE_BLOCK = /<reviewer_guidance>\n<preferences>\np1 look-for \(everywhere\): /;
