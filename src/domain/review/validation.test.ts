import { describe, expect, it } from "vitest";
import { HunkId } from "../diff/index.ts";
import { validateHunkReferences } from "./index.ts";

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
