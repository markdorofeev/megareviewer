import { describe, expect, it } from "vitest";
import { displayLines, hunkLocation, lineCounts } from "./lines.ts";
import { firstHunk, modifiedFile } from "./testing.ts";

describe("displayLines", () => {
  it("drops a trailing carriage return without marking it when every line has one", () => {
    const hunk = firstHunk(modifiedFile("a.ini", ["@@ -1,2 +1,2 @@", " a\r", "-b\r", "+c\r"]));
    expect(
      displayLines(hunk.lines).map(({ text, carriageReturn }) => [text, carriageReturn]),
    ).toEqual([
      ["a", false],
      ["b", false],
      ["c", false],
    ]);
  });

  it("marks lines that end in a carriage return when others in the hunk don't", () => {
    const hunk = firstHunk(modifiedFile("a.ini", ["@@ -1,2 +1,2 @@", "-b", "+b\r", " c\r"]));
    expect(
      displayLines(hunk.lines).map(({ text, carriageReturn }) => [text, carriageReturn]),
    ).toEqual([
      ["b", false],
      ["b", true],
      ["c", true],
    ]);
  });

  it("keeps a carriage return inside a line", () => {
    const hunk = firstHunk(modifiedFile("a.txt", ["@@ -1 +1 @@", "-a\rb", "+a"]));
    expect(displayLines(hunk.lines)[0]?.text).toBe("a\rb");
  });
});

describe("hunk labels", () => {
  it("counts added and deleted lines", () => {
    const hunk = firstHunk(modifiedFile("a.ts", ["@@ -1,3 +1,2 @@", " a", "-b", "-c", "+d"]));
    expect(lineCounts(hunk)).toEqual({ added: 1, deleted: 2 });
  });

  it("names the new lines, or the old ones when nothing is left", () => {
    const changed = firstHunk(modifiedFile("a.ts", ["@@ -8,2 +10,3 @@", " a", "+b", " c"]));
    expect(hunkLocation(changed)).toBe("lines 10–12");

    const single = firstHunk(modifiedFile("a.ts", ["@@ -8 +8 @@", "-a", "+b"]));
    expect(hunkLocation(single)).toBe("lines 8");

    const removed = firstHunk(modifiedFile("a.ts", ["@@ -4,2 +3,0 @@", "-a", "-b"]));
    expect(hunkLocation(removed)).toBe("deleted lines 4–5");
  });
});
