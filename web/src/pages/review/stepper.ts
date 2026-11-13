import type { Point, PointId, PointKind } from "../../../../src/domain/review/index.ts";

/** Where the stepper is: the points it walks, and the current one's place among them. */
export interface StepperPlace {
  /** The points it walks: all of them, or those of the kind a chip narrowed it to. */
  readonly steps: readonly Point[];
  /** The current point's place in `steps`, from 0; null before the first step or outside the set. */
  readonly at: number | null;
}

export const stepperPlace = (
  points: readonly Point[],
  kind: PointKind | null,
  current: PointId | null,
): StepperPlace => {
  const steps = kind === null ? points : points.filter((point) => point.kind === kind);
  const at = steps.findIndex((point) => point.id === current);
  return { steps, at: at === -1 ? null : at };
};

/**
 * The point a step goes to, round from the last to the first and back. From outside the set,
 * Next goes to its first and Previous to its last.
 */
export const stepFrom = (place: StepperPlace, direction: 1 | -1): PointId | null => {
  const { steps, at } = place;
  if (steps.length === 0) return null;
  const to =
    at === null
      ? direction === 1
        ? 0
        : steps.length - 1
      : (at + direction + steps.length) % steps.length;
  return steps[to]?.id ?? null;
};

/**
 * The point narrowing to a kind goes to: none while the current point is of that kind, else the
 * kind's first. Widening to every point goes nowhere.
 */
export const narrowTo = (
  points: readonly Point[],
  kind: PointKind | null,
  current: PointId | null,
): PointId | null => {
  if (kind === null) return null;
  const place = stepperPlace(points, kind, current);
  return place.at === null ? (place.steps[0]?.id ?? null) : null;
};
