import { describe, expect, it } from "vitest";
import type { FileChange, Hunk } from "../../../../src/domain/diff/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import {
  CLOSED,
  canOpen,
  type Fold,
  fileLines,
  foldSize,
  foldsOf,
  openMore,
  openRanges,
} from "./folds.ts";
import { partIndex } from "./model.ts";

const analysis = fixtureAnalysisView.analysis;
const fileAt = (path: string): FileChange => {
  const file = analysis.files.find((one) => one.path === path);
  if (file === undefined) throw new Error(`no ${path}`);
  return file;
};

/** A file of one hunk at these places, with these lines after its last change. */
const oneHunk = (
  place: Pick<Hunk, "oldStart" | "oldLines" | "newStart" | "newLines">,
  trailing: { context: number; noNewlineAtEnd?: boolean },
) => {
  const base = fileAt("src/routes/orders.ts").hunks[0];
  if (base === undefined) throw new Error("no hunk");
  const context = (n: number) => ({
    kind: "context" as const,
    oldLine: n,
    newLine: n,
    text: "",
    noNewlineAtEnd: false,
  });
  const hunk: Hunk = {
    ...base,
    ...place,
    lines: [
      { kind: "add", oldLine: null, newLine: place.newStart, text: "", noNewlineAtEnd: false },
      ...Array.from({ length: trailing.context }, (_, i) => ({
        ...context(i),
        noNewlineAtEnd: trailing.noNewlineAtEnd === true && i === trailing.context - 1,
      })),
    ],
  };
  const file = fileAt("src/routes/orders.ts");
  return {
    ids: [hunk.id],
    index: partIndex({ ...analysis, parts: [], files: [{ ...file, hunks: [hunk] }] }),
  };
};

describe("foldsOf", () => {
  it("folds between parts that don't touch and below the last, with each one's offset", () => {
    const file = fileAt("src/routes/orders.ts");
    const index = partIndex(analysis);
    const folds = foldsOf(index.partsInFile(file), index);
    expect(folds.map(({ start, end, offset }) => ({ start, end, offset }))).toEqual([
      { start: 9, end: 9, offset: -2 },
      { start: 25, end: 28, offset: -11 },
      { start: 35, end: null, offset: -6 },
    ]);
    expect(folds[0]?.after).not.toBeNull();
    expect(folds.at(-1)?.before).toBeNull();
  });

  it("folds above a first part that starts past line 1", () => {
    const { ids, index } = oneHunk(
      { oldStart: 10, oldLines: 3, newStart: 12, newLines: 4 },
      { context: 3 },
    );
    expect(foldsOf(ids, index)[0]).toMatchObject({ after: null, start: 1, end: 11, offset: 0 });
  });

  it("doesn't fold below a hunk the diff shows at the end of its file", () => {
    for (const trailing of [{ context: 2 }, { context: 3, noNewlineAtEnd: true }]) {
      const { ids, index } = oneHunk(
        { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 },
        trailing,
      );
      expect(foldsOf(ids, index)).toEqual([]);
    }
  });

  it("counts a deleting hunk's empty side from the line before it", () => {
    const { ids, index } = oneHunk(
      { oldStart: 5, oldLines: 2, newStart: 4, newLines: 0 },
      { context: 3 },
    );
    expect(foldsOf(ids, index)).toMatchObject([
      { start: 1, end: 4, offset: 0 },
      { start: 5, end: null, offset: 2 },
    ]);
  });
});

describe("canOpen", () => {
  it("opens only files in both commits", () => {
    const file = fileAt("src/routes/orders.ts");
    expect(canOpen(file)).toBe(true);
    expect(canOpen({ ...file, status: "added" })).toBe(false);
    expect(canOpen({ ...file, status: "deleted" })).toBe(false);
    expect(canOpen({ ...file, binary: true })).toBe(false);
  });
});

describe("opening", () => {
  const fold: Fold = { before: null, after: null, start: 11, end: 60, offset: 3 };

  it("opens a step from either end, never past the fold, or all of it", () => {
    const down = openMore(CLOSED, "down", 20, 50);
    expect(down).toEqual({ top: 20, bottom: 0 });
    const both = openMore(openMore(down, "up", 20, 50), "up", 20, 50);
    expect(both).toEqual({ top: 20, bottom: 30 });
    expect(openMore(CLOSED, "all", 20, 50)).toEqual({ top: 50, bottom: 0 });
  });

  it("opens below the last part before the file's length is known", () => {
    expect(openMore(CLOSED, "down", 20, null)).toEqual({ top: 20, bottom: 0 });
    const all = openMore(CLOSED, "all", 20, null);
    const below: Fold = { ...fold, end: null };
    expect(openRanges(below, all, 14)).toEqual({ top: [11, 12, 13, 14], hidden: 0, bottom: [] });
    expect(foldSize(below, null)).toBeNull();
    expect(foldSize(below, 5)).toBe(0);
  });

  it("gives the open lines above and below the row, and how many stay folded", () => {
    expect(openRanges(fold, { top: 2, bottom: 1 }, 100)).toEqual({
      top: [11, 12],
      hidden: 47,
      bottom: [60],
    });
  });
});

describe("fileLines", () => {
  it("drops the empty line after a final newline and each line's CR", () => {
    expect(fileLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(fileLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});
