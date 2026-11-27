import { describe, expect, it } from "vitest";
import { type FindingType, type Point, PointId } from "../../../../src/domain/review/index.ts";
import { stepFrom, stepperPlace } from "./stepper.ts";

const point = (id: string, type: FindingType | null): Point => ({
  id: PointId.parse(id),
  title: id,
  explanation: "",
  hunkIds: [],
  path: null,
  lines: null,
  type,
  severity: null,
  suggestion: null,
  mismatch: null,
});
const POINTS = [
  point("f1", "contract"),
  point("f2", "logic"),
  point("f3", "contract"),
  point("m1", null),
];
const id = (raw: string) => PointId.parse(raw);

describe("stepperPlace", () => {
  it("places the current point among all of them, or none before the first step", () => {
    expect(stepperPlace(POINTS, null, id("f2")).at).toBe(1);
    expect(stepperPlace(POINTS, null, null)).toEqual({ steps: POINTS, at: null });
    expect(stepperPlace(POINTS, null, id("f9")).at).toBeNull();
  });

  it("walks only the type the list narrowed it to, never a mismatch", () => {
    const place = stepperPlace(POINTS, "contract", id("f3"));
    expect(place.steps.map((one) => one.id)).toEqual(["f1", "f3"]);
    expect(place.at).toBe(1);
    expect(stepperPlace(POINTS, "contract", id("m1")).at).toBeNull();
  });
});

describe("stepFrom", () => {
  it("goes on round, both ways", () => {
    expect(stepFrom(stepperPlace(POINTS, null, id("f1")), 1)).toBe("f2");
    expect(stepFrom(stepperPlace(POINTS, null, id("m1")), 1)).toBe("f1");
    expect(stepFrom(stepperPlace(POINTS, null, id("f1")), -1)).toBe("m1");
    expect(stepFrom(stepperPlace(POINTS, "contract", id("f1")), 1)).toBe("f3");
  });

  it("goes to the first or the last from outside the steps", () => {
    expect(stepFrom(stepperPlace(POINTS, null, null), 1)).toBe("f1");
    expect(stepFrom(stepperPlace(POINTS, null, null), -1)).toBe("m1");
    expect(stepFrom(stepperPlace(POINTS, "contract", id("f2")), -1)).toBe("f3");
  });

  it("stays on the one point there is, and goes nowhere without any", () => {
    const one = [point("f9", "logic")];
    expect(stepFrom(stepperPlace(one, null, id("f9")), 1)).toBe("f9");
    expect(stepFrom(stepperPlace(one, null, id("f9")), -1)).toBe("f9");
    expect(stepFrom(stepperPlace([], null, null), 1)).toBeNull();
    expect(stepFrom(stepperPlace(POINTS, "architecture", null), 1)).toBeNull();
  });
});
