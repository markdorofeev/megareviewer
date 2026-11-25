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
  guidelines: [
    {
      ref: "g1",
      path: "REVIEW.md",
      linkedFrom: null,
      content: "# Review\n\nNo raw SQL in routes.\n",
    },
  ],
};

/** A root and the files it imports, one of which imports the other. */
export const linkedGuidance: InputGuidance = {
  preferences: [],
  guidelines: [
    { ref: "g1", path: "CLAUDE.md", linkedFrom: null, content: "@docs/rules.md\n" },
    {
      ref: "g2",
      path: "docs/rules.md",
      linkedFrom: "CLAUDE.md",
      content: "# Rules\n\n@naming.md\n",
    },
    { ref: "g3", path: "docs/naming.md", linkedFrom: "docs/rules.md", content: "# Naming\n" },
  ],
};

export const withGuidance = (input: AnalysisInput): AnalysisInput => ({ ...input, guidance });

/** One file for the passes to read, and nothing else of guidance. */
export const withHarness = (input: AnalysisInput): AnalysisInput => ({
  ...input,
  harness: {
    files: [
      {
        ref: "g1",
        path: "harness/docs/rules.md",
        bytes: 8,
        lines: 1,
        linkedFrom: "CLAUDE.md",
        headings: [],
      },
    ],
    contents: new Map([["harness/docs/rules.md", "# Rules\n"]]),
  },
});

/** How the guidance block starts, right before the PR's. */
export const GUIDANCE_BLOCK = /<reviewer_guidance>\n<preferences>\np1 look-for \(everywhere\): /;
