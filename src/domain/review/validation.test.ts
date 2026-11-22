import { describe, expect, it } from "vitest";
import { HunkId, type HunkPart, PartId } from "../diff/index.ts";
import { validateFlows, validateHunkReferences, validateRiskCoverage } from "./index.ts";

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

describe("validateFlows", () => {
  const required = new Set([h(1), h(2), h(3)]);
  const flows = (...steps: HunkId[][]) => ({ steps: steps.map((partIds) => ({ partIds })) });

  it.each([
    ["valid flows", flows([h(1)], [h(2), h(3)]), []],
    ["a missing hunk", flows([h(1)], [h(3)]), [{ kind: "missing", id: h(2) }]],
    ["a hunk in two steps", flows([h(1), h(2)], [h(2), h(3)]), [{ kind: "duplicate", id: h(2) }]],
    [
      "a hunk twice in one step",
      flows([h(1), h(1), h(2), h(3)]),
      [{ kind: "duplicate", id: h(1) }],
    ],
    [
      "a hunk three times, reported once",
      flows([h(1), h(1), h(1), h(2), h(3)]),
      [{ kind: "duplicate", id: h(1) }],
    ],
    [
      "an unknown or mechanical hunk, reported once",
      flows([h(1), h(9)], [h(2), h(3), h(9)]),
      [{ kind: "unknown", id: h(9) }],
    ],
    [
      "every problem at once, listed problems first",
      flows([h(9), h(1)], [h(1)]),
      [
        { kind: "unknown", id: h(9) },
        { kind: "duplicate", id: h(1) },
        { kind: "missing", id: h(2) },
        { kind: "missing", id: h(3) },
      ],
    ],
  ])("reports %s", (_, candidate, problems) => {
    expect(validateFlows(candidate, required)).toEqual(problems);
  });

  it("accepts no flows when nothing is required", () => {
    expect(validateFlows(flows(), new Set())).toEqual([]);
  });

  it("reports every required hunk missing from no flows", () => {
    expect(validateFlows(flows(), required).map((p) => p.kind)).toEqual([
      "missing",
      "missing",
      "missing",
    ]);
  });
});

describe("validateFlows with parts", () => {
  const required = new Set([h(1), h(2)]);
  const part = (n: number): PartId => PartId.parse(`${h(1)}.${n}`);
  const parts: HunkPart[] = [1, 2].map((n) => ({
    id: part(n),
    hunkId: h(1),
    start: n - 1,
    end: n,
    definitions: [],
  }));
  const flows = (...steps: (PartId[] | { partIds: PartId[]; via: PartId[] })[]) => ({
    steps: steps.map((step) => (Array.isArray(step) ? { partIds: step } : step)),
  });

  it.each([
    ["every part once", flows([part(1), h(2)], [part(2)]), []],
    ["a missing part", flows([part(1), h(2)]), [{ kind: "missing", id: part(2) }]],
    [
      "a part in two steps",
      flows([part(1), part(2)], [part(2), h(2)]),
      [{ kind: "duplicate", id: part(2) }],
    ],
    ["a step naming a split hunk, as the model's do", flows([h(1)], [h(2)]), []],
    [
      "a split hunk and one of its parts",
      flows([h(1)], [part(1), h(2)]),
      [{ kind: "duplicate", id: part(1) }],
    ],
    [
      "a step passing through a part no earlier step reads",
      flows({ partIds: [part(1), h(2)], via: [part(2)] }, { partIds: [part(2)], via: [part(1)] }),
      [{ kind: "via", id: part(2) }],
    ],
  ])("reports %s", (_, candidate, problems) => {
    expect(validateFlows(candidate, required, parts)).toEqual(problems);
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
