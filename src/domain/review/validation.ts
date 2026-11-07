import { z } from "zod";
import { type HunkId, type HunkPart, PartId } from "../diff/index.ts";

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

/** A coverage problem, or a step passing through a part no earlier step reads. */
export type TourProblem = CoverageProblem | { readonly kind: "via"; readonly id: PartId };
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

/** Each hunk's parts, in order: its parts in `parts`, or the hunk itself when it isn't split. */
export const partsOfHunks = (
  hunkIds: Iterable<HunkId>,
  parts: readonly HunkPart[],
): Map<HunkId, readonly PartId[]> => {
  const split = new Map<HunkId, PartId[]>();
  for (const part of parts) split.set(part.hunkId, [...(split.get(part.hunkId) ?? []), part.id]);
  return new Map([...hunkIds].map((id) => [id, split.get(id) ?? [id]]));
};

/**
 * Every part of every required hunk must appear in exactly one step, and no other part may
 * appear. A step that names a split hunk, as the model's do, names all of its parts. A step may
 * pass through only parts that earlier steps read.
 */
export const validateTour = (
  tour: {
    readonly steps: readonly {
      readonly partIds: readonly PartId[];
      readonly via?: readonly PartId[];
    }[];
  },
  requiredHunkIds: ReadonlySet<HunkId>,
  parts: readonly HunkPart[] = [],
): TourProblem[] => {
  const partsOf = partsOfHunks(requiredHunkIds, parts);
  const splitParts: ReadonlyMap<PartId, readonly PartId[]> = partsOfHunks(
    parts.map((part) => part.hunkId),
    parts,
  );
  const expanded = tour.steps.map((step) =>
    step.partIds.flatMap((id) => splitParts.get(id) ?? [id]),
  );
  const read = new Set<PartId>();
  const via: TourProblem[] = [];
  tour.steps.forEach((step, at) => {
    for (const id of step.via ?? []) if (!read.has(id)) via.push({ kind: "via", id });
    for (const id of expanded[at] ?? []) read.add(id);
  });
  return [...coverageProblems(expanded.flat(), new Set([...partsOf.values()].flat())), ...via];
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
