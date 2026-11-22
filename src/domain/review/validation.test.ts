import { describe, expect, it } from "vitest";
import { HunkId, type HunkPart, PartId } from "../diff/index.ts";
import { validateHunkReferences, validateRiskCoverage } from "./index.ts";

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
