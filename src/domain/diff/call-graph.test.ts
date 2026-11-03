import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import { buildCallGraphHints, type FileChange, type FileSymbols, type Hunk } from "./index.ts";

const file = (path: string, ...hunks: Hunk[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: "typescript",
  hunks,
  additions: 0,
  deletions: 0,
});

const symbols = (
  definitions: [name: string, startLine: number, endLine: number][],
  references: [name: string, line: number][] = [],
): FileSymbols => ({
  definitions: definitions.map(([name, startLine, endLine]) => ({ name, startLine, endLine })),
  references: references.map(([name, line]) => ({ name, line })),
});

// src/text.ts lines 1–3 add a new function; src/page.ts line 11 calls it.
const definingHunk = hunk("src/text.ts", "@@ -0,0 +1,3 @@", [
  "+export function slugify(input: string): string {",
  '+  return input.replace(/ /g, "-");',
  "+}",
]);
const callingHunk = hunk("src/page.ts", "@@ -10,2 +10,2 @@", [
  " const title = read();",
  "-const slug = title;",
  "+const slug = slugify(title);",
]);

describe("buildCallGraphHints", () => {
  it("points a hunk that calls a new function to the hunk that defines it", () => {
    const hints = buildCallGraphHints(
      [file("src/text.ts", definingHunk), file("src/page.ts", callingHunk)],
      new Map([
        ["src/text.ts", symbols([["slugify", 1, 3]], [["replace", 2]])],
        [
          "src/page.ts",
          symbols(
            [],
            [
              ["read", 10],
              ["slugify", 11],
            ],
          ),
        ],
      ]),
    );
    expect(hints).toEqual([
      { fromHunkId: callingHunk.id, toHunkId: definingHunk.id, symbol: "slugify", line: 11 },
    ]);
  });

  it("gives no hints for references to symbols no hunk changes", () => {
    const hints = buildCallGraphHints(
      [file("src/text.ts", definingHunk), file("src/page.ts", callingHunk)],
      new Map([
        // slugify is defined on lines the hunk doesn't add.
        ["src/text.ts", symbols([["slugify", 20, 30]])],
        ["src/page.ts", symbols([], [["slugify", 11]])],
      ]),
    );
    expect(hints).toEqual([]);
  });

  it("counts references on context lines but not on lines outside the hunk", () => {
    const files = [file("src/text.ts", definingHunk), file("src/page.ts", callingHunk)];
    const withReference = (line: number) =>
      buildCallGraphHints(
        files,
        new Map([
          ["src/text.ts", symbols([["slugify", 1, 3]])],
          ["src/page.ts", symbols([], [["slugify", line]])],
        ]),
      ).length;
    expect(withReference(10)).toBe(1);
    expect(withReference(12)).toBe(0);
  });

  it("doesn't count deleted lines as changing a definition", () => {
    const deletion = hunk("src/text.ts", "@@ -2,2 +2,1 @@", [" a", "-b"]);
    const hints = buildCallGraphHints(
      [file("src/text.ts", deletion), file("src/page.ts", callingHunk)],
      new Map([
        ["src/text.ts", symbols([["slugify", 1, 3]])],
        ["src/page.ts", symbols([], [["slugify", 11]])],
      ]),
    );
    expect(hints).toEqual([]);
  });

  it("never points a hunk to itself", () => {
    const recursive = hunk("src/a.ts", "@@ -0,0 +1,1 @@", ["+function f() { f(); }"]);
    const hints = buildCallGraphHints(
      [file("src/a.ts", recursive)],
      new Map([["src/a.ts", symbols([["f", 1, 1]], [["f", 1]])]]),
    );
    expect(hints).toEqual([]);
  });

  it("links both ways when two files define a symbol with the same name", () => {
    const a = hunk("src/a.ts", "@@ -0,0 +1,1 @@", ["+function parse() { return parse(); }"]);
    const b = hunk("src/b.ts", "@@ -0,0 +1,1 @@", ["+function parse() { return parse(); }"]);
    const both = symbols([["parse", 1, 1]], [["parse", 1]]);
    const hints = buildCallGraphHints(
      [file("src/a.ts", a), file("src/b.ts", b)],
      new Map([
        ["src/a.ts", both],
        ["src/b.ts", both],
      ]),
    );
    expect(hints).toEqual([
      { fromHunkId: a.id, toHunkId: b.id, symbol: "parse", line: 1 },
      { fromHunkId: b.id, toHunkId: a.id, symbol: "parse", line: 1 },
    ]);
  });

  it("gives one hint per symbol and hunk, on the first reference's line", () => {
    const hints = buildCallGraphHints(
      [file("src/text.ts", definingHunk), file("src/page.ts", callingHunk)],
      new Map([
        ["src/text.ts", symbols([["slugify", 1, 3]])],
        [
          "src/page.ts",
          symbols(
            [],
            [
              ["slugify", 11],
              ["slugify", 10],
              ["slugify", 12],
            ],
          ),
        ],
      ]),
    );
    expect(hints.map((hint) => hint.line)).toEqual([10]);
  });

  it("keeps at most 10 hints per hunk, same file first, then by symbol name", () => {
    const names = Array.from({ length: 12 }, (_, index) => `s${String(index).padStart(2, "0")}`);
    // One hunk per name in src/other.ts, and one hunk in src/main.ts defining "zz".
    const others = names.map((name, index) =>
      hunk("src/other.ts", `@@ -${index * 10 + 1},0 +${index * 10 + 1},1 @@`, [`+let ${name};`]),
    );
    const local = hunk("src/main.ts", "@@ -50,0 +50,1 @@", ["+let zz;"]);
    const caller = hunk("src/main.ts", "@@ -1,0 +1,1 @@", ["+use(everything);"]);
    const hints = buildCallGraphHints(
      [file("src/main.ts", caller, local), file("src/other.ts", ...others)],
      new Map([
        [
          "src/main.ts",
          symbols(
            [["zz", 50, 50]],
            [...names, "zz"].map((name): [string, number] => [name, 1]),
          ),
        ],
        [
          "src/other.ts",
          symbols(
            names.map((name, index): [string, number, number] => [
              name,
              index * 10 + 1,
              index * 10 + 1,
            ]),
          ),
        ],
      ]),
    );
    expect(hints.map((h) => h.symbol)).toEqual(["zz", ...names.slice(0, 9)]);
    expect(hints.every((h) => h.fromHunkId === caller.id)).toBe(true);
  });
  it("orders hints by symbol name, then by position in the diff", () => {
    const first = hunk("src/b.ts", "@@ -1,0 +1,2 @@", ["+let beta;", "+let alpha;"]);
    const second = hunk("src/b.ts", "@@ -20,0 +21,1 @@", ["+let alpha;"]);
    const caller = hunk("src/a.ts", "@@ -1,0 +1,1 @@", ["+use(beta, alpha);"]);
    const hints = buildCallGraphHints(
      [file("src/a.ts", caller), file("src/b.ts", first, second)],
      new Map([
        [
          "src/a.ts",
          symbols(
            [],
            [
              ["beta", 1],
              ["alpha", 1],
            ],
          ),
        ],
        [
          "src/b.ts",
          symbols([
            ["beta", 1, 1],
            ["alpha", 2, 2],
            ["alpha", 21, 21],
          ]),
        ],
      ]),
    );
    expect(hints.map((h) => [h.symbol, h.toHunkId])).toEqual([
      ["alpha", first.id],
      ["alpha", second.id],
      ["beta", first.id],
    ]);
  });

  it("gives no hints for files without symbols", () => {
    expect(
      buildCallGraphHints(
        [file("src/text.ts", definingHunk), file("src/page.ts", callingHunk)],
        new Map(),
      ),
    ).toEqual([]);
  });
});
