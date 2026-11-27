import type { FindingType, Point, PointId } from "../../../../src/domain/review/index.ts";

/** Where the pager is: the points it walks, and the current one's place among them. */
export interface StepperPlace {
  /** All of them, or the findings of the type the list narrowed it to. */
  readonly steps: readonly Point[];
  /** The current point's place in `steps`, from 0; null before the first step or outside them. */
  readonly at: number | null;
}

export const stepperPlace = (
  points: readonly Point[],
  type: FindingType | null,
  current: PointId | null,
): StepperPlace => {
  const steps = type === null ? points : points.filter((point) => point.type === type);
  const at = steps.findIndex((point) => point.id === current);
  return { steps, at: at === -1 ? null : at };
};

/**
 * The point a step goes to, round from the last to the first and back. From outside the steps, Next
 * goes to the first and Previous to the last.
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
