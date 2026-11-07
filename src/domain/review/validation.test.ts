import { describe, expect, it } from "vitest";
import { HunkId } from "../diff/index.ts";
import { validateHunkReferences, validateRiskCoverage, validateTour } from "./index.ts";

const h = (n: number): HunkId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

describe("validateHunkReferences", () => {
  const known = new Set([h(1), h(2)]);

  it.each([
    [[], []],
    [[h(1), h(2)], []],
    [[h(3)], [h(3)]],
    [
      [h(3), h(1), h(4), h(3)],
      [h(3), h(4)],
    ],
  ])("returns the unknown IDs of %j", (referenced, unknown) => {
    expect(validateHunkReferences(known, referenced)).toEqual(unknown);
  });
});

describe("validateTour", () => {
  const required = new Set([h(1), h(2), h(3)]);
  const tour = (...steps: HunkId[][]) => ({ steps: steps.map((partIds) => ({ partIds })) });

  it.each([
    ["a valid tour", tour([h(1)], [h(2), h(3)]), []],
    ["a missing hunk", tour([h(1)], [h(3)]), [{ kind: "missing", id: h(2) }]],
    ["a hunk in two steps", tour([h(1), h(2)], [h(2), h(3)]), [{ kind: "duplicate", id: h(2) }]],
    ["a hunk twice in one step", tour([h(1), h(1), h(2), h(3)]), [{ kind: "duplicate", id: h(1) }]],
    [
      "a hunk three times, reported once",
      tour([h(1), h(1), h(1), h(2), h(3)]),
      [{ kind: "duplicate", id: h(1) }],
    ],
    [
      "an unknown or mechanical hunk, reported once",
      tour([h(1), h(9)], [h(2), h(3), h(9)]),
      [{ kind: "unknown", id: h(9) }],
    ],
    [
      "every problem at once, listed problems first",
      tour([h(9), h(1)], [h(1)]),
      [
        { kind: "unknown", id: h(9) },
        { kind: "duplicate", id: h(1) },
        { kind: "missing", id: h(2) },
        { kind: "missing", id: h(3) },
      ],
    ],
  ])("reports %s", (_, candidate, problems) => {
    expect(validateTour(candidate, required)).toEqual(problems);
  });

  it("accepts an empty tour when nothing is required", () => {
    expect(validateTour(tour(), new Set())).toEqual([]);
  });

  it("reports every required hunk missing from an empty tour", () => {
    expect(validateTour(tour(), required).map((p) => p.kind)).toEqual([
      "missing",
      "missing",
      "missing",
    ]);
  });
});

describe("validateRiskCoverage", () => {
  const required = new Set([h(1), h(2)]);
  const risk = (...ids: HunkId[]) => ids.map((hunkId) => ({ hunkId }));

  it.each([
    ["full coverage", risk(h(2), h(1)), []],
    ["a missing hunk", risk(h(1)), [{ kind: "missing", id: h(2) }]],
    ["a duplicate", risk(h(1), h(2), h(1)), [{ kind: "duplicate", id: h(1) }]],
    ["an unknown hunk", risk(h(1), h(2), h(5)), [{ kind: "unknown", id: h(5) }]],
  ])("reports %s", (_, assessments, problems) => {
    expect(validateRiskCoverage(assessments, required)).toEqual(problems);
  });
});
