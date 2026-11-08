import { z } from "zod";
import { type HunkId, type HunkPart, PartId } from "../diff/index.ts";
import type { Tour } from "./tour.ts";
import { MAX_EXPLANATION, MAX_TITLE, type TourTitles } from "./tour-titles.ts";

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

/**
 * A problem with the model's titles for the code's tour. Titles: a step without one, with more
 * than one, or one for a step the tour doesn't have; blank or too long. Merges: of a step that
 * isn't supporting, into a step the tour doesn't have or that is merged itself, or twice.
 */
export type TourTitlesProblem =
  | { readonly kind: "missing" | "duplicate" | "unknown"; readonly stepId: string }
  | {
      readonly kind: "blank" | "too-long";
      readonly stepId: string;
      readonly field: "title" | "explanation";
    }
  | {
      readonly kind: "merge-of-flow" | "merge-unknown" | "merged-twice" | "merge-no-reason";
      readonly stepId: string;
    }
  | {
      readonly kind: "merge-into-unknown" | "merge-into-merged";
      readonly stepId: string;
      readonly intoStepId: string;
    };

/** Every step of the code's tour has exactly one title, and every merge is of a supporting step. */
export const validateTourTitles = (titles: TourTitles, skeleton: Tour): TourTitlesProblem[] => {
  const problems: TourTitlesProblem[] = [];
  const kindOf = new Map<string, Tour["steps"][number]["kind"]>(
    skeleton.steps.map((step) => [step.id, step.kind]),
  );
  const titled = new Set<string>();
  const reported = new Set<string>();
  for (const step of titles.steps) {
    const { stepId } = step;
    if (!kindOf.has(stepId) || titled.has(stepId)) {
      if (!reported.has(stepId)) {
        problems.push({ kind: kindOf.has(stepId) ? "duplicate" : "unknown", stepId });
      }
      reported.add(stepId);
      continue;
    }
    titled.add(stepId);
    for (const [field, max] of [
      ["title", MAX_TITLE],
      ["explanation", MAX_EXPLANATION],
    ] as const) {
      const text = step[field].trim();
      if (text === "") problems.push({ kind: "blank", stepId, field });
      else if (text.length > max) problems.push({ kind: "too-long", stepId, field });
    }
  }
  for (const id of kindOf.keys()) {
    if (!titled.has(id) && !reported.has(id)) problems.push({ kind: "missing", stepId: id });
  }

  const merging = new Set(titles.merges.map((merge) => merge.stepId));
  const merged = new Set<string>();
  for (const { stepId, intoStepId, reason } of titles.merges) {
    const kind = kindOf.get(stepId);
    if (merged.has(stepId)) {
      problems.push({ kind: "merged-twice", stepId });
      continue;
    }
    merged.add(stepId);
    if (kind === undefined) problems.push({ kind: "merge-unknown", stepId });
    else if (kind === "flow") problems.push({ kind: "merge-of-flow", stepId });
    if (!kindOf.has(intoStepId)) problems.push({ kind: "merge-into-unknown", stepId, intoStepId });
    else if (merging.has(intoStepId)) {
      problems.push({ kind: "merge-into-merged", stepId, intoStepId });
    }
    if (reason.trim() === "") problems.push({ kind: "merge-no-reason", stepId });
  }
  return problems;
};
