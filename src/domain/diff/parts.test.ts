import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import {
  type CallGraphHint,
  type DefinitionSpan,
  type DiffLine,
  type FileChange,
  type Hunk,
  HunkId,
  hunkIdOf,
  PartId,
  partHunk,
  partsByHunk,
  piecesOf,
  renameHints,
  splitByDefinition,
  splitHunks,
} from "./index.ts";

const spans = (...definitions: [name: string, startLine: number, endLine: number][]) =>
  definitions.map(([name, startLine, endLine]): DefinitionSpan => ({ name, startLine, endLine }));

/** Each part as its definitions and its lines' text, without the diff markers. */
const shape = (of: Hunk, head: DefinitionSpan[], base: DefinitionSpan[] = []) =>
  splitByDefinition(of, { head, base }).map((part) => [
    part.definitions,
    of.lines.slice(part.start, part.end).map((line) => line.text.trim()),
  ]);

// Three routes added in one hunk, after an unchanged router, as on delphi-code #2.
const routes = hunk("api/routes.py", "@@ -5,6 +5,22 @@", [
  " from ..models import Item",
  "+from ..models import Token",
  " ",
  " router = APIRouter()",
  "+changes = APIRouter()",
  "+",
  "+",
  '+@router.get("/items")',
  "+def list_items():",
  "+    return items()",
  "+",
  "+",
  '+@changes.put("/items/{id}")',
  "+def save_item(id: str):",
  "+    return save(id)",
  "+",
  "+",
  '+@changes.delete("/items/{id}")',
  "+def forget_item(id: str):",
  "+    return forget(id)",
  " ",
  " ",
  ' @router.get("/other")',
]);

describe("splitByDefinition", () => {
  it("cuts three routes in one hunk apart, decorators and leading lines with each", () => {
    const head = spans(
      ["router", 8, 8],
      ["changes", 9, 9],
      ["list_items", 13, 14],
      ["save_item", 18, 19],
      ["forget_item", 23, 24],
      ["other", 28, 29],
    );
    expect(shape(routes, head)).toEqual([
      [
        ["changes"],
        [
          "from ..models import Item",
          "from ..models import Token",
          "",
          "router = APIRouter()",
          "changes = APIRouter()",
        ],
      ],
      [["list_items"], ["", "", '@router.get("/items")', "def list_items():", "return items()"]],
      [
        ["save_item"],
        ["", "", '@changes.put("/items/{id}")', "def save_item(id: str):", "return save(id)"],
      ],
      [
        ["forget_item"],
        [
          "",
          "",
          '@changes.delete("/items/{id}")',
          "def forget_item(id: str):",
          "return forget(id)",
          "",
          "",
          '@router.get("/other")',
        ],
      ],
    ]);
  });

  it("cuts at the methods of a class that holds the whole hunk", () => {
    const methods = hunk("hosts.py", "@@ -12,7 +12,8 @@", [
      "     def token(self):",
      "-        return None",
      "+        return self._token",
      " ",
      "     def account(self):",
      "-        return self.name",
      "+        name = self.name",
      "+        return name",
    ]);
    const head = spans(["Host", 1, 40], ["token", 12, 13], ["account", 15, 17]);
    const base = spans(["Host", 1, 39], ["token", 12, 13], ["account", 15, 16]);
    expect(shape(methods, head, base)).toEqual([
      [["token"], ["def token(self):", "return None", "return self._token"]],
      [
        ["account"],
        ["", "def account(self):", "return self.name", "name = self.name", "return name"],
      ],
    ]);
  });

  it("doesn't split a hunk that changes one definition, or none", () => {
    const one = hunk("a.py", "@@ -3,3 +3,3 @@", [" def f():", "-    return 1", "+    return 2"]);
    expect(splitByDefinition(one, { head: spans(["f", 3, 5]), base: spans(["f", 3, 5]) })).toEqual(
      [],
    );
    expect(splitByDefinition(one, { head: [], base: [] })).toEqual([]);
  });

  it("cuts a new file at its components, with the imports before the first", () => {
    const page = hunk("web/src/pages/Setup.tsx", "@@ -0,0 +1,9 @@", [
      '+import { Section } from "./Section";',
      "+",
      "+export const Setup = () => <Section />;",
      "+",
      "+// The list of hosts.",
      "+export const Hosts = () => (",
      "+  <ul />",
      "+);",
      "+",
    ]);
    const head = spans(["Setup", 3, 3], ["Hosts", 6, 8]);
    expect(shape(page, head).map(([names]) => names)).toEqual([["Setup"], ["Hosts"]]);
    expect(shape(page, head)[0]?.[1]).toEqual([
      'import { Section } from "./Section";',
      "",
      "export const Setup = () => <Section />;",
    ]);
    // The comment above Hosts goes with it, and the trailing blank line with the last part.
    expect(shape(page, head)[1]?.[1]).toEqual([
      "",
      "// The list of hosts.",
      "export const Hosts = () => (",
      "<ul />",
      ");",
      "",
    ]);
  });

  it("puts a deleted definition where it was in the base file", () => {
    const replaced = hunk("a.py", "@@ -1,6 +1,6 @@", [
      "-def old():",
      "-    return 1",
      " ",
      " ",
      "+def new():",
      "+    return 2",
    ]);
    expect(
      shape(replaced, spans(["new", 3, 4]), spans(["old", 1, 2])).map(([names]) => names),
    ).toEqual([["old"], ["new"]]);
  });

  it("keeps a renamed definition whole, its old and new lines interleaved", () => {
    const renamed = hunk("repos.py", "@@ -10,5 +10,5 @@", [
      "-    def _with_credentials(self):",
      "+    def _known(self):",
      "         if self.find is not None:",
      "-        return configured()",
      "+        return known()",
      " ",
      "     def other(self):",
      "-        pass",
      "+        return 1",
    ]);
    const head = spans(["Repos", 1, 30], ["_known", 10, 12], ["other", 14, 15]);
    const base = spans(["Repos", 1, 30], ["_with_credentials", 10, 12], ["other", 14, 15]);
    expect(shape(renamed, head, base).map(([names]) => names)).toEqual([
      ["_with_credentials", "_known"],
      ["other"],
    ]);
  });

  it("leaves unchanged lines of an unchanged definition to the next part", () => {
    const between = hunk("a.py", "@@ -1,7 +1,8 @@", [
      " def f():",
      "-    return 1",
      "+    return 2",
      " def g():",
      "     return 3",
      " def h():",
      "-    return 4",
      "+    return 5",
      "+    # done",
    ]);
    const both = spans(["f", 1, 2], ["g", 3, 4], ["h", 5, 7]);
    expect(shape(between, both, spans(["f", 1, 2], ["g", 3, 4], ["h", 5, 6]))).toEqual([
      [["f"], ["def f():", "return 1", "return 2"]],
      [["h"], ["def g():", "return 3", "def h():", "return 4", "return 5", "# done"]],
    ]);
  });

  it("gives a part that changes nothing to the next one, or the last at the end", () => {
    // f's unchanged tail comes after g's lines, so it can't stand alone.
    const lines = [" e = 0", "-    a = 1", "+def g():", "+    pass", "     b = 2", "     c = 3"];
    const base = spans(["f", 2, 5]);
    const head = spans(["g", 2, 3], ["f", 4, 5], ["h", 6, 6]);
    const atEnd = hunk("a.py", "@@ -1,4 +1,5 @@", lines);
    expect(
      splitByDefinition(atEnd, { head, base }).map((part) => [
        part.definitions,
        part.start,
        part.end,
      ]),
    ).toEqual([
      [["f"], 0, 2],
      [["g"], 2, 6],
    ]);
    const beforeH = hunk("a.py", "@@ -1,4 +1,6 @@", [...lines, "+h = 1"]);
    expect(
      splitByDefinition(beforeH, { head, base }).map((part) => [
        part.definitions,
        part.start,
        part.end,
      ]),
    ).toEqual([
      [["f"], 0, 2],
      [["g"], 2, 4],
      [["h"], 4, 7],
    ]);
  });

  it("covers a hunk's lines exactly once, in order, each part changing a line, over random hunks", () => {
    // A small seeded generator, so a failure repeats.
    let seed = 28;
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    const definitionsOver = (length: number): DefinitionSpan[] =>
      Array.from({ length: random(6) }, (_, at) => {
        const startLine = 1 + random(Math.max(length, 1));
        return { name: `d${random(5)}${at % 2}`, startLine, endLine: startLine + random(8) };
      });
    for (let run = 0; run < 500; run++) {
      const kinds = Array.from({ length: 1 + random(30) }, (): DiffLine["kind"] => {
        const pick = random(3);
        return pick === 0 ? "context" : pick === 1 ? "add" : "del";
      });
      const [oldStart, newStart] = [1 + random(20), 1 + random(20)];
      let [oldLine, newLine] = [oldStart, newStart];
      const lines = kinds.map(
        (kind, at): DiffLine => ({
          kind,
          oldLine: kind === "add" ? null : oldLine++,
          newLine: kind === "del" ? null : newLine++,
          text: `line ${at}`,
          noNewlineAtEnd: false,
        }),
      );
      const random_hunk: Hunk = {
        id: HunkId.parse("h_00000000000000aa"),
        path: "a.py",
        oldStart,
        oldLines: oldLine - oldStart,
        newStart,
        newLines: newLine - newStart,
        sectionHeading: null,
        lines,
      };
      const parts = splitByDefinition(random_hunk, {
        head: definitionsOver(newLine),
        base: definitionsOver(oldLine),
      });
      if (parts.length === 0) continue;
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]?.start).toBe(0);
      expect(parts.at(-1)?.end).toBe(lines.length);
      parts.forEach((part, at) => {
        expect(part.id).toBe(`${random_hunk.id}.${at + 1}`);
        expect(part.end).toBeGreaterThan(part.start);
        if (at > 0) expect(part.start).toBe(parts[at - 1]?.end);
        expect(lines.slice(part.start, part.end).some((line) => line.kind !== "context")).toBe(
          true,
        );
      });
    }
  });
});

const file = (path: string, ...hunks: Hunk[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: "python",
  hunks,
  additions: 0,
  deletions: 0,
});

describe("splitHunks", () => {
  const head = spans(
    ["router", 8, 8],
    ["changes", 9, 9],
    ["list_items", 13, 14],
    ["save_item", 18, 19],
    ["forget_item", 23, 24],
  );

  it("splits each hunk of a file with definitions", () => {
    const parts = splitHunks(
      [file("api/routes.py", routes)],
      new Map([["api/routes.py", { head, base: [] }]]),
      new Set(),
    );
    expect(parts.map((part) => part.id)).toEqual([1, 2, 3, 4].map((n) => `${routes.id}.${n}`));
  });

  it("never splits a hunk with a proof, or a file it has no definitions for", () => {
    expect(
      splitHunks(
        [file("api/routes.py", routes)],
        new Map([["api/routes.py", { head, base: [] }]]),
        new Set([routes.id]),
      ),
    ).toEqual([]);
    expect(splitHunks([file("api/routes.py", routes)], new Map(), new Set())).toEqual([]);
  });
});

describe("partHunk", () => {
  it("numbers a part's lines from where they are in the hunk", () => {
    const [first, second] = splitByDefinition(routes, {
      head: spans(["changes", 9, 9], ["list_items", 13, 14], ["save_item", 18, 19]),
      base: [],
    });
    if (first === undefined || second === undefined) throw new Error("routes didn't split");
    expect(partHunk(routes, first)).toMatchObject({
      oldStart: 5,
      oldLines: 3,
      newStart: 5,
      newLines: 5,
    });
    // The second part only adds, so its old side is empty, after line 7.
    expect(partHunk(routes, second)).toMatchObject({ oldStart: 7, oldLines: 0, newStart: 10 });
  });

  it("starts an empty side at the line before, in a hunk that only adds", () => {
    const added = hunk("a.py", "@@ -0,0 +1,2 @@", ["+a = 1", "+b = 2"]);
    expect(partHunk(added, { start: 1, end: 2 })).toMatchObject({
      oldStart: 0,
      oldLines: 0,
      newStart: 2,
      newLines: 1,
    });
  });
});

describe("piecesOf", () => {
  it("replaces each split hunk by its parts", () => {
    const other = hunk("api/routes.py", "@@ -40,1 +56,1 @@", ["-x = 1", "+x = 2"]);
    const parts = splitByDefinition(routes, {
      head: spans(["changes", 9, 9], ["list_items", 13, 14]),
      base: [],
    });
    const pieces = piecesOf(file("api/routes.py", routes, other), partsByHunk(parts));
    expect(pieces.map((piece) => piece.id)).toEqual([`${routes.id}.1`, `${routes.id}.2`, other.id]);
    expect(pieces.map((piece) => piece.hunk.id)).toEqual([routes.id, routes.id, other.id]);
  });
});

describe("renameHints", () => {
  const p = (n: number): PartId => PartId.parse(`${routes.id}.${n}`);
  const hint = (from: PartId, to: PartId, line: number, symbol = "f"): CallGraphHint => ({
    fromPartId: from,
    toPartId: to,
    symbol,
    line,
    use: "call",
  });

  it("maps parts to hunks, drops hints within one, and keeps the first line of repeats", () => {
    const other = HunkId.parse("h_00000000000000bb");
    expect(
      renameHints(
        [
          hint(p(1), p(2), 5),
          hint(p(1), other, 9),
          hint(p(2), other, 7),
          hint(p(2), other, 8, "g"),
        ],
        hunkIdOf,
      ),
    ).toEqual([hint(routes.id, other, 7), hint(routes.id, other, 8, "g")]);
  });
});
