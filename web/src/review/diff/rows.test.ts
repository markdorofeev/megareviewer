import { describe, expect, it } from "vitest";
import {
  hiddenBefore,
  linesOf,
  pairLines,
  selectedRange,
  splitRows,
  unifiedRows,
  viewLines,
} from "./rows.ts";
import { firstHunk, modifiedFile } from "./testing.ts";

const FILE = modifiedFile(
  "src/retry.ts",
  ["@@ -10,4 +10,3 @@ export function retry", " a", "-b", "-c", "+B", " d"],
  ["@@ -30,2 +30,3 @@", " x", "+y", " z"],
);

describe("unifiedRows", () => {
  it("puts a gap before each hunk that hides lines, then its header and lines", () => {
    const rows = unifiedRows(FILE);
    expect(rows.map((row) => row.type)).toEqual([
      "gap",
      "hunk",
      ...Array(5).fill("line"),
      "gap",
      "hunk",
      ...Array(3).fill("line"),
    ]);
    expect(rows[0]).toMatchObject({ type: "gap", hidden: 9 });
    // The first hunk covers new lines 10–12; the second starts at 30.
    expect(rows[7]).toMatchObject({ type: "gap", hidden: 17 });
    expect(rows[1]).toMatchObject({ type: "hunk", position: 1 });
  });

  it("numbers lines from the hunk's starts and marks word changes", () => {
    const lines = viewLines(
      firstHunk(modifiedFile("a.ts", ["@@ -1,1 +1,1 @@", "-let x = 1;", "+let x = 2;"])),
    );
    expect(lines.map((line) => [line.kind, line.oldNo, line.newNo])).toEqual([
      ["del", 1, null],
      ["add", null, 1],
    ]);
    expect(lines[0]?.wordRanges).toEqual([{ start: 8, end: 9 }]);
    expect(lines[1]?.wordRanges).toEqual([{ start: 8, end: 9 }]);
  });
});

describe("hiddenBefore", () => {
  it("counts from the top of the file, then from the previous hunk's end", () => {
    const [first, second] = FILE.hunks;
    if (first === undefined || second === undefined) throw new Error("two hunks");
    expect(hiddenBefore(null, first)).toBe(9);
    expect(hiddenBefore(first, second)).toBe(17);
  });

  it("hides nothing before a hunk at line 1", () => {
    expect(hiddenBefore(null, firstHunk(modifiedFile("a.ts", ["@@ -1 +1 @@", "-a", "+b"])))).toBe(
      0,
    );
  });
});

describe("pairLines", () => {
  it("pairs a deleted run with the added run after it, and leaves the extra lines alone", () => {
    const hunk = firstHunk(
      modifiedFile("a.ts", ["@@ -1,5 +1,3 @@", " a", "-b", "-c", "+B", " d", "-e"]),
    );
    const rows = pairLines(viewLines(hunk));
    expect(rows.map((row) => [row.old?.text ?? null, row.new?.text ?? null])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", null],
      ["d", "d"],
      ["e", null],
    ]);
  });

  it("keeps every line of the hunk", () => {
    const lines = linesOf(splitRows(FILE));
    expect(lines).toHaveLength(FILE.hunks.flatMap((hunk) => hunk.lines).length);
  });
});

describe("selectedRange", () => {
  it("selects from anchor to focus either way", () => {
    const lines = linesOf(unifiedRows(FILE));
    const [a, , c] = lines;
    if (a === undefined || c === undefined) throw new Error("lines");
    expect([...selectedRange(lines, a.key, c.key)]).toHaveLength(3);
    expect(selectedRange(lines, c.key, a.key)).toEqual(selectedRange(lines, a.key, c.key));
    expect(selectedRange(lines, "missing", a.key).size).toBe(0);
  });
});
