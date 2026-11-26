import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import {
  buildDefinitionCalls,
  type FileChange,
  type FileSymbols,
  type Hunk,
  splitByDefinition,
} from "./index.ts";

const file = (path: string, language: string, ...hunks: Hunk[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language,
  hunks,
  additions: 0,
  deletions: 0,
});

type Definition = FileSymbols["definitions"][number];
type Reference = FileSymbols["references"][number];

const symbols = (
  definitions: [name: string, kind: Definition["kind"], startLine: number, endLine: number][],
  references: [name: string, line: number, kind?: Reference["kind"]][] = [],
  imports: FileSymbols["imports"] = [],
): FileSymbols => ({
  definitions: definitions.map(([name, kind, startLine, endLine]) => ({
    name,
    kind,
    startLine,
    endLine,
  })),
  references: references.map(([name, line, kind = "name"]) => ({ name, line, kind })),
  imports,
});

/** Each definition by name with the names of those it calls. */
const callsOf = (
  files: readonly FileChange[],
  byPath: ReadonlyMap<string, FileSymbols>,
  parts?: Parameters<typeof buildDefinitionCalls>[2],
) => {
  const found = buildDefinitionCalls(files, byPath, parts);
  return found.map((one) => [one.name, one.calls.map((at) => found[at]?.name)]);
};

// An added class is one part: two methods, one of which calls the other file's writer.
const recorderHunk = hunk("src/pgo/Recorder.java", "@@ -0,0 +1,10 @@", [
  "+class Recorder {",
  "+  Recorder() { Writer.open(); }",
  "+  static boolean needed() {",
  "+    return flag();",
  "+  }",
  "+  static boolean flag() { return true; }",
  "+  static void dump() {",
  "+    Writer.write();",
  "+  }",
  "+}",
]);
const writerHunk = hunk("src/pgo/Writer.java", "@@ -0,0 +1,4 @@", [
  "+class Writer {",
  "+  static void open() {}",
  "+  static void write() {}",
  "+}",
]);
const recorder = file("src/pgo/Recorder.java", "java", recorderHunk);
const writer = file("src/pgo/Writer.java", "java", writerHunk);
const recorderSymbols = symbols(
  [
    ["Recorder", "class", 1, 10],
    ["Recorder", "method", 2, 2],
    ["needed", "method", 3, 5],
    ["flag", "method", 6, 6],
    ["dump", "method", 7, 9],
  ],
  [
    ["Writer", 2],
    ["open", 2, "member"],
    ["flag", 4],
    ["Writer", 8],
    ["write", 8, "member"],
  ],
);
const writerSymbols = symbols([
  ["Writer", "class", 1, 4],
  ["open", "method", 2, 2],
  ["write", "method", 3, 3],
]);
const pgo = new Map([
  [recorder.path, recorderSymbols],
  [writer.path, writerSymbols],
]);

describe("buildDefinitionCalls", () => {
  it("links each method of an added class to what it calls, within the class too", () => {
    expect(callsOf([recorder, writer], pgo)).toEqual([
      ["Recorder", ["Recorder"]],
      ["Recorder", ["Writer", "open"]],
      ["needed", ["flag"]],
      ["flag", []],
      ["dump", ["Writer", "write"]],
      ["Writer", []],
      ["open", []],
      ["write", []],
    ]);
  });

  it("names the parts each is in, which can be a class's one part", () => {
    const found = buildDefinitionCalls([recorder, writer], pgo);
    expect(new Set(found.flatMap((one) => one.partIds))).toEqual(
      new Set([recorderHunk.id, writerHunk.id]),
    );
    expect(found.filter((one) => one.partIds.includes(recorderHunk.id))).toHaveLength(5);
  });

  it("names every part that changes a definition, in diff order", () => {
    const first = hunk("a.py", "@@ -1,2 +1,3 @@", [" def run():", "+    start()", "     pass"]);
    const second = hunk("a.py", "@@ -20,1 +21,2 @@", ["     pass", "+    stop()"]);
    expect(
      buildDefinitionCalls(
        [file("a.py", "python", first, second)],
        new Map([["a.py", symbols([["run", "function", 1, 30]])]]),
      ),
    ).toEqual([{ name: "run", partIds: [first.id, second.id], calls: [], requests: [] }]);
  });

  it("runs a class's constructor with it, by its own name or as the language has it", () => {
    const added = hunk("a.py", "@@ -0,0 +1,6 @@", [
      "+class Store:",
      "+    def __init__(self):",
      "+        connect()",
      "+    def get(self): ...",
      "+def connect(): ...",
      "+store = Store()",
    ]);
    const found = callsOf(
      [file("a.py", "python", added)],
      new Map([
        [
          "a.py",
          symbols(
            [
              ["Store", "class", 1, 4],
              ["__init__", "method", 2, 3],
              ["get", "method", 4, 4],
              ["connect", "function", 5, 5],
              ["store", "variable", 6, 6],
            ],
            [
              ["connect", 3],
              ["Store", 6],
            ],
          ),
        ],
      ]),
    );
    expect(found).toEqual([
      ["Store", ["__init__"]],
      ["__init__", ["connect"]],
      ["get", []],
      ["connect", []],
      ["store", ["Store"]],
    ]);
  });

  it("runs a function's inner functions with it, and one of them alone when it's named", () => {
    const added = hunk("a.ts", "@@ -0,0 +1,6 @@", [
      "+const createStore = () => {",
      "+  const get = () => read();",
      "+  const put = () => write();",
      "+};",
      "+const read = () => {};",
      "+const write = () => {};",
    ]);
    const caller = hunk("b.ts", "@@ -0,0 +1,1 @@", ["+const load = () => store.get();"]);
    const found = callsOf(
      [file("a.ts", "typescript", added), file("b.ts", "typescript", caller)],
      new Map([
        [
          "a.ts",
          symbols(
            [
              ["createStore", "function", 1, 4],
              ["get", "function", 2, 2],
              ["put", "function", 3, 3],
              ["read", "function", 5, 5],
              ["write", "function", 6, 6],
            ],
            [
              ["read", 2],
              ["write", 3],
            ],
          ),
        ],
        [
          "b.ts",
          symbols(
            [["load", "function", 1, 1]],
            [["get", 1, "member"]],
            [{ module: "./a.ts", names: ["store"] }],
          ),
        ],
      ]),
    );
    expect(found).toEqual([
      ["createStore", ["get", "put"]],
      ["get", ["read"]],
      ["put", ["write"]],
      ["read", []],
      ["write", []],
      ["load", ["get"]],
    ]);
  });

  it("keeps calls made outside any definition, and leaves out context that calls nothing", () => {
    const first = hunk("a.py", "@@ -1,3 +1,4 @@", [
      " def before():",
      "     pass",
      " ",
      "+connect()",
    ]);
    const second = hunk("a.py", "@@ -10,0 +11,1 @@", ["+def connect(): ..."]);
    const found = buildDefinitionCalls(
      [file("a.py", "python", first, second)],
      new Map([
        [
          "a.py",
          symbols(
            [
              ["before", "function", 1, 2],
              ["connect", "function", 11, 11],
            ],
            [["connect", 4]],
          ),
        ],
      ]),
    );
    expect(found).toEqual([
      { name: "", partIds: [first.id], calls: [1], requests: [] },
      { name: "connect", partIds: [second.id], calls: [], requests: [] },
    ]);
  });

  it("calls in the order the lines do, once each, and never by a type's name", () => {
    const added = hunk("a.ts", "@@ -0,0 +1,6 @@", [
      "+function run(store: Store) {",
      "+  second();",
      "+  first(); second();",
      "+}",
      "+function first() {}",
      "+function second() {}",
      "+class Store {}",
    ]);
    const found = callsOf(
      [file("a.ts", "typescript", added)],
      new Map([
        [
          "a.ts",
          symbols(
            [
              ["run", "function", 1, 4],
              ["first", "function", 5, 5],
              ["second", "function", 6, 6],
              ["Store", "class", 7, 7],
            ],
            [
              ["Store", 1, "type"],
              ["first", 3],
              ["second", 3],
              ["second", 2],
            ],
          ),
        ],
      ]),
    );
    expect(found[0]).toEqual(["run", ["second", "first"]]);
  });

  it("puts a request on the definition that sends it", () => {
    const routes = hunk("api/orders.py", "@@ -0,0 +1,3 @@", [
      '+@router.post("/orders")',
      "+def create(): ...",
      "+",
    ]);
    const page = hunk("web/orders.ts", "@@ -0,0 +1,4 @@", [
      "+function load() {}",
      "+function save() {",
      '+  return fetch("/orders", { method: "POST" });',
      "+}",
    ]);
    const found = buildDefinitionCalls(
      [file("api/orders.py", "python", routes), file("web/orders.ts", "typescript", page)],
      new Map([
        [
          "web/orders.ts",
          symbols([
            ["load", "function", 1, 1],
            ["save", "function", 2, 4],
          ]),
        ],
      ]),
    );
    expect(found).toEqual([
      { name: "load", partIds: [page.id], calls: [], requests: [] },
      {
        name: "save",
        partIds: [page.id],
        calls: [],
        requests: [{ symbol: "POST /orders", toPartId: routes.id }],
      },
    ]);
  });

  it("names the parts of a split hunk", () => {
    const added = hunk("a.py", "@@ -1,1 +1,3 @@", [
      " import os",
      "+def first(): second()",
      "+def second(): ...",
    ]);
    const changed = file("a.py", "python", added);
    const found = symbols(
      [
        ["first", "function", 2, 2],
        ["second", "function", 3, 3],
      ],
      [["second", 2]],
    );
    const parts = splitByDefinition(added, { head: found.definitions, base: [] });
    expect(
      buildDefinitionCalls([changed], new Map([["a.py", found]]), parts).map((one) => [
        one.name,
        one.partIds,
      ]),
    ).toEqual([
      ["first", [`${added.id}.1`]],
      ["second", [`${added.id}.2`]],
    ]);
  });
});
