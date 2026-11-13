import { describe, expect, it } from "vitest";
import { type Point, PointId, type PointKind } from "../../../../src/domain/review/index.ts";
import { narrowTo, stepFrom, stepperPlace } from "./stepper.ts";

const point = (id: string, kind: PointKind): Point => ({
  id: PointId.parse(id),
  kind,
  title: id,
  explanation: "",
  hunkIds: [],
  path: null,
  lines: null,
});
const POINTS = [point("f1", "finding"), point("d1", "decision"), point("f2", "finding")];
const id = (raw: string) => PointId.parse(raw);

describe("stepperPlace", () => {
  it("places the current point among all of them, or none before the first step", () => {
    expect(stepperPlace(POINTS, null, id("d1")).at).toBe(1);
    expect(stepperPlace(POINTS, null, null)).toEqual({ steps: POINTS, at: null });
  });

  it("walks only the kind a chip narrowed it to", () => {
    const place = stepperPlace(POINTS, "finding", id("f2"));
    expect(place.steps.map((one) => one.id)).toEqual(["f1", "f2"]);
    expect(place.at).toBe(1);
    expect(stepperPlace(POINTS, "finding", id("d1")).at).toBeNull();
  });
});

describe("stepFrom", () => {
  it("goes on round, both ways", () => {
    expect(stepFrom(stepperPlace(POINTS, null, id("f1")), 1)).toBe("d1");
    expect(stepFrom(stepperPlace(POINTS, null, id("f2")), 1)).toBe("f1");
    expect(stepFrom(stepperPlace(POINTS, null, id("f1")), -1)).toBe("f2");
  });

  it("goes to the first or the last from outside the set", () => {
    expect(stepFrom(stepperPlace(POINTS, null, null), 1)).toBe("f1");
    expect(stepFrom(stepperPlace(POINTS, null, null), -1)).toBe("f2");
    expect(stepFrom(stepperPlace(POINTS, "finding", id("d1")), -1)).toBe("f2");
  });

  it("stays on the one point there is, and goes nowhere without any", () => {
    const one = [point("f9", "finding")];
    expect(stepFrom(stepperPlace(one, null, id("f9")), 1)).toBe("f9");
    expect(stepFrom(stepperPlace(one, null, id("f9")), -1)).toBe("f9");
    expect(stepFrom(stepperPlace([], null, null), 1)).toBeNull();
    expect(stepFrom(stepperPlace(POINTS, "risk", null), 1)).toBeNull();
  });
});

describe("narrowTo", () => {
  it("goes to the kind's first only when the current point isn't of it", () => {
    expect(narrowTo(POINTS, "finding", id("d1"))).toBe("f1");
    expect(narrowTo(POINTS, "finding", null)).toBe("f1");
    expect(narrowTo(POINTS, "finding", id("f2"))).toBeNull();
    expect(narrowTo(POINTS, null, id("d1"))).toBeNull();
    expect(narrowTo(POINTS, "risk", null)).toBeNull();
  });
});
