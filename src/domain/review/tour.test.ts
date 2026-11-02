import { describe, expect, it } from "vitest";
import { type FileChange, type Hunk, HunkId } from "../diff/index.ts";
import { fallbackTour, Tour, validateTour } from "./index.ts";

const h = (n: number): HunkId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

const hunk = (id: HunkId, path: string): Hunk => ({
  id,
  path,
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  sectionHeading: null,
  lines: [{ kind: "add", oldLine: null, newLine: 1, text: "x", noNewlineAtEnd: false }],
});

const file = (path: string, ...ids: HunkId[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: null,
  hunks: ids.map((id) => hunk(id, path)),
  additions: ids.length,
  deletions: 0,
});

describe("fallbackTour", () => {
  it("makes one step per file in path order, hunks in file order", () => {
    const files = [file("src/b.ts", h(3), h(2)), file("README.md", h(5)), file("src/a.ts", h(1))];
    const tour = fallbackTour(files, new Set([h(1), h(2), h(3), h(5)]));

    expect(tour.builtBy).toBe("file-order");
    expect(tour.steps.map((step) => [step.id, step.title, step.hunkIds])).toEqual([
      ["s1", "README.md", [h(5)]],
      ["s2", "src/a.ts", [h(1)]],
      ["s3", "src/b.ts", [h(3), h(2)]],
    ]);
  });

  it("leaves out mechanical hunks and files with only mechanical hunks", () => {
    const files = [file("a.ts", h(1), h(2)), file("pnpm-lock.yaml", h(3))];
    const tour = fallbackTour(files, new Set([h(2)]));

    expect(tour.steps.map((step) => [step.id, step.hunkIds])).toEqual([["s1", [h(2)]]]);
  });

  it("is empty when nothing is required", () => {
    expect(fallbackTour([file("a.ts", h(1))], new Set())).toEqual({
      steps: [],
      builtBy: "file-order",
    });
  });

  it("passes validateTour and parses as a Tour", () => {
    const files = [file("b.ts", h(2)), file("a.ts", h(1), h(4)), file("c.ts", h(3))];
    const required = new Set([h(1), h(2), h(4)]);
    const tour = fallbackTour(files, required);

    expect(validateTour(tour, required)).toEqual([]);
    expect(Tour.parse(tour)).toEqual(tour);
  });

  it("does not reorder the input", () => {
    const files = [file("b.ts", h(1)), file("a.ts", h(2))];
    fallbackTour(files, new Set([h(1), h(2)]));
    expect(files.map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
  });
});
