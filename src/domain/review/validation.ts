import { z } from "zod";
import { type HunkId, PartId } from "../diff/index.ts";

/**
 * A hunk or part a pass must cover exactly once, but didn't: missing, listed more than once,
 * or not one it may list at all (unknown, or mechanical).
 */
export const CoverageProblem = z
  .object({
    kind: z.enum(["missing", "duplicate", "unknown"]),
    id: PartId,
  })
  .readonly();
export type CoverageProblem = z.infer<typeof CoverageProblem>;

export type RiskProblem = CoverageProblem;

/** The referenced IDs that aren't known, each once, in first-seen order. */
export const validateHunkReferences = (
  known: ReadonlySet<HunkId>,
  referenced: readonly HunkId[],
): HunkId[] => [...new Set(referenced.filter((id) => !known.has(id)))];

const coverageProblems = (
  listed: readonly PartId[],
  required: ReadonlySet<PartId>,
): CoverageProblem[] => {
  const problems: CoverageProblem[] = [];
  const seen = new Set<PartId>();
  const reported = new Set<PartId>();
  for (const id of listed) {
    if (!required.has(id)) {
      if (!reported.has(id)) problems.push({ kind: "unknown", id });
      reported.add(id);
    } else if (seen.has(id)) {
      if (!reported.has(id)) problems.push({ kind: "duplicate", id });
      reported.add(id);
    }
    seen.add(id);
  }
  for (const id of required) {
    if (!seen.has(id)) problems.push({ kind: "missing", id });
  }
  return problems;
};

/** Every required hunk must be assessed exactly once, and no other hunk may be. */
export const validateRiskCoverage = (
  assessments: readonly { readonly hunkId: HunkId }[],
  requiredHunkIds: ReadonlySet<HunkId>,
): RiskProblem[] =>
  coverageProblems(
    assessments.map((assessment) => assessment.hunkId),
    requiredHunkIds,
  );
