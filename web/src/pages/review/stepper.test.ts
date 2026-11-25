import { describe, expect, it } from "vitest";
import { type Point, PointId } from "../../../../src/domain/review/index.ts";
import { stepFrom, stepperPlace } from "./stepper.ts";

const point = (id: string): Point => ({
  id: PointId.parse(id),
  title: id,
  explanation: "",
  hunkIds: [],
  path: null,
  lines: null,
  type: null,
  severity: null,
  suggestion: null,
  mismatch: null,
});
const POINTS = [point("f1"), point("f2"), point("m1")];
const id = (raw: string) => PointId.parse(raw);

describe("stepperPlace", () => {
  it("places the current point among all of them, or none before the first step", () => {
    expect(stepperPlace(POINTS, id("f2")).at).toBe(1);
    expect(stepperPlace(POINTS, null)).toEqual({ steps: POINTS, at: null });
    expect(stepperPlace(POINTS, id("f9")).at).toBeNull();
  });
});

describe("stepFrom", () => {
  it("goes on round, both ways", () => {
    expect(stepFrom(stepperPlace(POINTS, id("f1")), 1)).toBe("f2");
    expect(stepFrom(stepperPlace(POINTS, id("m1")), 1)).toBe("f1");
    expect(stepFrom(stepperPlace(POINTS, id("f1")), -1)).toBe("m1");
  });

  it("goes to the first or the last before the first step", () => {
    expect(stepFrom(stepperPlace(POINTS, null), 1)).toBe("f1");
    expect(stepFrom(stepperPlace(POINTS, null), -1)).toBe("m1");
  });

  it("stays on the one point there is, and goes nowhere without any", () => {
    const one = [point("f9")];
    expect(stepFrom(stepperPlace(one, id("f9")), 1)).toBe("f9");
    expect(stepFrom(stepperPlace(one, id("f9")), -1)).toBe("f9");
    expect(stepFrom(stepperPlace([], null), 1)).toBeNull();
  });
});
