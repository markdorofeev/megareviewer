import type { Point, PointId } from "../../../../src/domain/review/index.ts";

/** Where the stepper is: the points it walks, and the current one's place among them. */
export interface StepperPlace {
  readonly steps: readonly Point[];
  /** The current point's place in `steps`, from 0; null before the first step. */
  readonly at: number | null;
}

export const stepperPlace = (points: readonly Point[], current: PointId | null): StepperPlace => {
  const at = points.findIndex((point) => point.id === current);
  return { steps: points, at: at === -1 ? null : at };
};

/**
 * The point a step goes to, round from the last to the first and back. Before the first step, Next
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
