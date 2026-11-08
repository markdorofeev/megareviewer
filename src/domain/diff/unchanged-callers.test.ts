import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import {
  changedDefinitions,
  type FileChange,
  type FileSymbols,
  findUnchangedCallers,
  type Hunk,
  type HunkPart,
  mentionsAny,
  partId,
  type UnchangedFile,
} from "./index.ts";

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  py: "python",
  go: "go",
  rs: "rust",
};
const languageOf = (path: string): string => LANGUAGES[path.slice(path.lastIndexOf(".") + 1)] ?? "";

const file = (
  path: string,
  hunks: Hunk[],
  status: FileChange["status"] = "modified",
): FileChange => ({
  path,
  oldPath: null,
  status,
  binary: false,
  oldMode: null,
  newMode: null,
  language: languageOf(path) || null,
  hunks,
  additions: 0,
  deletions: 0,
});

type Span = [name: string, startLine: number, endLine: number];
const spans = (list: Span[]) =>
  list.map(([name, startLine, endLine]) => ({ name, startLine, endLine }));

/** An unchanged file: its lines, the names it uses by line, and its imports. */
const unchanged = (
  path: string,
  lines: string[],
  references: [name: string, line: number, kind?: "name" | "member" | "type"][],
  imports: FileSymbols["imports"],
  definitions: Span[] = [],
): UnchangedFile => ({
  path,
  language: languageOf(path),
  content: lines.join("\n"),
  symbols: {
    definitions: spans(definitions),
    references: references.map(([name, line, kind = "name"]) => ({ name, line, kind })),
    imports,
  },
});

// services/sources.py changes the body of clone_credentials (lines 10–14 at head).
const credentialsHunk = hunk("services/sources.py", "@@ -10,4 +10,4 @@", [
  " def clone_credentials(host):",
  "-    return [env_token(host), saved_token(host)]",
  "+    return [saved_token(host), env_token(host)]",
  "     # Saved tokens first.",
]);
const sources = file("services/sources.py", [credentialsHunk]);
const sourcesSpans = {
  head: spans([["clone_credentials", 10, 13]]),
  base: spans([["clone_credentials", 10, 13]]),
};

const callerLines = [
  "from services.sources import clone_credentials",
  "",
  "def sync(host):",
  "    for credential in clone_credentials(host):",
  "        try_clone(credential)",
  "    return True",
];

const callersOf = (callers: UnchangedFile[], generated: ReadonlySet<string> = new Set()) =>
  findUnchangedCallers(
    [sources],
    changedDefinitions([sources], new Map([[sources.path, sourcesSpans]])),
    callers,
    generated,
  );

describe("changedDefinitions", () => {
  it("names a definition whose own lines the PR changes, with its part", () => {
    expect(changedDefinitions([sources], new Map([[sources.path, sourcesSpans]]))).toEqual([
      { partId: credentialsHunk.id, path: "services/sources.py", name: "clone_credentials" },
    ]);
  });

  it("leaves out a class whose PR only adds a method, and the method, which is new", () => {
    const added = hunk("app.py", "@@ -20,2 +20,6 @@", [
      "     def search(self):",
      "         pass",
      "+",
      "+    def connections(self):",
      "+        return []",
      "+",
    ]);
    const definitions = {
      head: spans([
        ["DelphiCode", 1, 30],
        ["search", 20, 21],
        ["connections", 23, 24],
      ]),
      base: spans([
        ["DelphiCode", 1, 26],
        ["search", 20, 21],
      ]),
    };
    expect(
      changedDefinitions([file("app.py", [added])], new Map([["app.py", definitions]])),
    ).toEqual([]);
  });

  it("names a definition the PR deletes lines of, by the base file", () => {
    const removed = hunk("app.py", "@@ -5,3 +5,1 @@", [
      " def create_app():",
      "-    app = App()",
      "-    return app",
    ]);
    const definitions = {
      head: spans([["create_app", 5, 5]]),
      base: spans([["create_app", 5, 7]]),
    };
    expect(
      changedDefinitions([file("app.py", [removed])], new Map([["app.py", definitions]])),
    ).toEqual([{ partId: removed.id, path: "app.py", name: "create_app" }]);
  });

  it("leaves out added files, and lines outside any definition", () => {
    const top = hunk("a.py", "@@ -1,1 +1,2 @@", [" import os", "+import sys"]);
    const definitions = { head: spans([["main", 5, 9]]), base: spans([["main", 4, 8]]) };
    expect(changedDefinitions([file("a.py", [top])], new Map([["a.py", definitions]]))).toEqual([]);
    expect(
      changedDefinitions([file("a.py", [top], "added")], new Map([["a.py", definitions]])),
    ).toEqual([]);
  });

  it("names the part of a split hunk that changes the definition, once per name", () => {
    const split = hunk("a.py", "@@ -1,4 +1,4 @@", [
      " def first():",
      "-    return 1",
      "+    return 2",
      " def second():",
      "-    return 3",
      "+    return first()",
    ]);
    const parts: HunkPart[] = [
      { id: partId(split.id, 1), hunkId: split.id, start: 0, end: 3, definitions: ["first"] },
      { id: partId(split.id, 2), hunkId: split.id, start: 3, end: 6, definitions: ["second"] },
    ];
    const definitions = {
      head: spans([
        ["first", 1, 2],
        ["second", 3, 4],
      ]),
      base: spans([
        ["first", 1, 2],
        ["second", 3, 4],
      ]),
    };
    expect(
      changedDefinitions([file("a.py", [split])], new Map([["a.py", definitions]]), parts),
    ).toEqual([
      { partId: partId(split.id, 1), path: "a.py", name: "first" },
      { partId: partId(split.id, 2), path: "a.py", name: "second" },
    ]);
  });
});

describe("findUnchangedCallers", () => {
  it("finds a call in an unchanged file that imports the changed one, with lines around it", () => {
    const caller = unchanged(
      "jobs/sync.py",
      callerLines,
      [
        ["clone_credentials", 4],
        ["try_clone", 5],
      ],
      [{ module: "services.sources", names: ["clone_credentials"] }],
      [["sync", 3, 6]],
    );
    expect(callersOf([caller])).toEqual([
      {
        partId: credentialsHunk.id,
        symbol: "clone_credentials",
        uses: [
          {
            path: "jobs/sync.py",
            line: 4,
            use: "call",
            excerpt: { start: 2, lines: callerLines.slice(1, 6) },
          },
        ],
        more: 0,
      },
    ]);
  });

  it("finds a call through a module, as a member", () => {
    const caller = unchanged(
      "jobs/sync.py",
      ["from services import sources", "sources.clone_credentials(host)"],
      [
        ["sources", 2],
        ["clone_credentials", 2, "member"],
      ],
      [{ module: "services", names: ["sources"] }],
    );
    expect(callersOf([caller])[0]?.uses.map((use) => [use.line, use.excerpt.start])).toEqual([
      [2, 1],
    ]);
  });

  it("finds nothing in a file that uses the same name without importing it", () => {
    const caller = unchanged(
      "other/clone.py",
      ["from other.creds import clone_credentials", "clone_credentials(host)"],
      [["clone_credentials", 2]],
      [{ module: "other.creds", names: ["clone_credentials"] }],
    );
    expect(callersOf([caller])).toEqual([]);
  });

  it("leaves a name the file defines itself to that definition", () => {
    const caller = unchanged(
      "jobs/sync.py",
      ["from services.sources import *", "def clone_credentials(): pass", "clone_credentials()"],
      [["clone_credentials", 3]],
      [{ module: "services.sources", names: null }],
      [["clone_credentials", 2, 2]],
    );
    expect(callersOf([caller])).toEqual([]);
  });

  it("finds tests calling code, after the code", () => {
    const imports = [{ module: "services.sources", names: ["clone_credentials"] }];
    const test = unchanged(
      "tests/test_sources.py",
      ["clone_credentials(h)"],
      [["clone_credentials", 1]],
      imports,
    );
    const code = unchanged(
      "z/late.py",
      ["clone_credentials(h)"],
      [["clone_credentials", 1]],
      imports,
    );
    expect(callersOf([test, code])[0]?.uses.map((use) => use.path)).toEqual([
      "z/late.py",
      "tests/test_sources.py",
    ]);
  });

  it("never finds code calling into a test", () => {
    const helper = hunk("tests/helpers.py", "@@ -1,2 +1,2 @@", [
      " def make_user():",
      "-    return User()",
      "+    return User(admin=True)",
    ]);
    const changed = file("tests/helpers.py", [helper]);
    const definitions = { head: spans([["make_user", 1, 2]]), base: spans([["make_user", 1, 2]]) };
    const caller = unchanged(
      "app/seed.py",
      ["make_user()"],
      [["make_user", 1]],
      [{ module: "tests.helpers", names: ["make_user"] }],
    );
    expect(
      findUnchangedCallers(
        [changed],
        changedDefinitions([changed], new Map([[changed.path, definitions]])),
        [caller],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("counts type uses, except of a generated file", () => {
    const caller = unchanged(
      "jobs/sync.py",
      ["from services.sources import clone_credentials", "x: clone_credentials = None"],
      [["clone_credentials", 2, "type"]],
      [{ module: "services.sources", names: ["clone_credentials"] }],
    );
    expect(callersOf([caller])[0]?.uses[0]?.use).toBe("type");
    expect(callersOf([caller], new Set(["services/sources.py"]))).toEqual([]);
  });

  it("calls a line that both calls a definition and names it as a type a call", () => {
    const caller = unchanged(
      "jobs/sync.py",
      [
        "from services.sources import clone_credentials",
        "x: clone_credentials = clone_credentials()",
      ],
      [
        ["clone_credentials", 2, "type"],
        ["clone_credentials", 2],
      ],
      [{ module: "services.sources", names: ["clone_credentials"] }],
    );
    expect(callersOf([caller])[0]?.uses.map((use) => use.use)).toEqual(["call"]);
  });

  it("keeps 50 uses and counts the rest", () => {
    const lines = Array.from({ length: 60 }, () => "clone_credentials(host)");
    const caller = unchanged(
      "jobs/sync.py",
      lines,
      lines.map((_, at): [string, number] => ["clone_credentials", at + 1]),
      [{ module: "services.sources", names: ["clone_credentials"] }],
    );
    const [callers] = callersOf([caller]);
    expect(callers?.uses).toHaveLength(50);
    expect(callers?.uses.at(-1)?.line).toBe(50);
    expect(callers?.more).toBe(10);
  });

  it("finds Go callers in the same package without an import, and skips unread languages", () => {
    const changedHunk = hunk("pkg/store/save.go", "@@ -3,2 +3,2 @@", [
      " func Save() error {",
      "-\treturn nil",
      "+\treturn errSaved",
    ]);
    const changed = file("pkg/store/save.go", [changedHunk]);
    const rust = file("src/lib.rs", [
      hunk("src/lib.rs", "@@ -1,2 +1,2 @@", [" fn save() {", "-    a();", "+    b();"]),
    ]);
    const definitions = new Map([
      [changed.path, { head: spans([["Save", 3, 5]]), base: spans([["Save", 3, 5]]) }],
      [rust.path, { head: spans([["save", 1, 3]]), base: spans([["save", 1, 3]]) }],
    ]);
    const callers = findUnchangedCallers(
      [changed, rust],
      changedDefinitions([changed, rust], definitions),
      [
        unchanged("pkg/store/load.go", ["Save()"], [["Save", 1]], []),
        unchanged("pkg/other/load.go", ["Save()"], [["Save", 1]], []),
        unchanged("src/main.rs", ["save();"], [["save", 1]], []),
      ],
      new Set(),
    );
    expect(callers.map((one) => [one.symbol, one.uses.map((use) => use.path)])).toEqual([
      ["Save", ["pkg/store/load.go"]],
    ]);
  });

  it("ignores a file the PR changes", () => {
    const caller = unchanged(
      "services/sources.py",
      ["clone_credentials(host)"],
      [["clone_credentials", 1]],
      [],
    );
    expect(callersOf([caller])).toEqual([]);
  });
});

describe("mentionsAny", () => {
  it("matches whole names only", () => {
    const names = new Set(["state", "create_app"]);
    expect(mentionsAny("app = create_app()", names)).toBe(true);
    expect(mentionsAny("restate(estates)", names)).toBe(false);
    expect(mentionsAny("", names)).toBe(false);
  });
});
