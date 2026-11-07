import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import {
  buildCallGraphHints,
  changedDefinitionNames,
  type FileChange,
  type FileSymbols,
  type Hunk,
  splitByDefinition,
} from "./index.ts";

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  go: "go",
  java: "java",
  rs: "rust",
};

const file = (path: string, ...hunks: Hunk[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: LANGUAGES[path.slice(path.lastIndexOf(".") + 1)] ?? null,
  hunks,
  additions: 0,
  deletions: 0,
});

type Kind = FileSymbols["references"][number]["kind"];

const symbols = (
  definitions: [name: string, startLine: number, endLine: number][],
  references: ([name: string, line: number] | [name: string, line: number, kind: Kind])[] = [],
  imports: FileSymbols["imports"] = [],
): FileSymbols => ({
  definitions: definitions.map(([name, startLine, endLine]) => ({ name, startLine, endLine })),
  references: references.map(([name, line, kind = "name"]) => ({ name, line, kind })),
  imports,
});

const importsSlugify = [{ module: "./text.ts", names: ["slugify"] }];

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
            importsSlugify,
          ),
        ],
      ]),
    );
    expect(hints).toEqual([
      {
        fromPartId: callingHunk.id,
        toPartId: definingHunk.id,
        symbol: "slugify",
        line: 11,
        use: "call",
      },
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
          ["src/page.ts", symbols([], [["slugify", line]], importsSlugify)],
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

  it("doesn't link a symbol to a same-named one in a file that isn't imported", () => {
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
    expect(hints).toEqual([]);
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
            importsSlugify,
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
            [{ module: "./other.ts", names }],
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
    expect(hints.every((h) => h.fromPartId === caller.id)).toBe(true);
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
            [{ module: "./b.ts", names: ["alpha", "beta"] }],
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
    expect(hints.map((h) => [h.symbol, h.toPartId])).toEqual([
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

/** A hunk in `from` uses `name` on its one added line, and a hunk in `to` defines it. */
const links = (
  from: string,
  to: string,
  imports: FileSymbols["imports"] = [],
  kind: Kind = "name",
): boolean => {
  const caller = hunk(from, "@@ -1,0 +1,1 @@", ["+use();"]);
  const callee = hunk(to, "@@ -1,0 +1,1 @@", ["+define();"]);
  return buildCallGraphHints(
    [file(from, caller), file(to, callee)],
    new Map([
      [from, symbols([], [["target", 1, kind]], imports)],
      [to, symbols([["target", 1, 1]])],
    ]),
  ).some((hint) => hint.use === "call");
};

const named = (module: string, ...names: string[]) => [{ module, names }];
const whole = (module: string) => [{ module, names: null }];

describe("which definitions a reference reaches", () => {
  it.each([
    [
      "a named relative import",
      "web/page.tsx",
      "web/lib/text.ts",
      named("./lib/text.ts", "target"),
    ],
    ["an import with a .js extension", "web/page.ts", "web/text.ts", named("./text.js", "target")],
    ["a default or namespace import", "web/page.ts", "web/text.ts", whole("./text")],
    [
      "an index file",
      "web/pages/page.tsx",
      "web/api/client.ts",
      named("../api/index.ts", "target"),
    ],
    ["a directory", "web/pages/page.tsx", "web/api/client.ts", named("../api", "target")],
    ["a path alias", "src/pages/page.ts", "src/lib/text.ts", named("@/lib/text", "target")],
    [
      "a Python relative import",
      "pkg/http/routes.py",
      "pkg/services/app.py",
      named("..services.app", "target"),
    ],
    [
      "a Python package",
      "pkg/http/routes.py",
      "pkg/services/__init__.py",
      named("..services", "target"),
    ],
    [
      "a Python package's module",
      "pkg/http/routes.py",
      "pkg/services/app.py",
      named("..services", "target"),
    ],
    ["a Python wildcard import", "pkg/routes.py", "pkg/models.py", whole(".models")],
    ["a Python absolute import", "src/pkg/a.py", "src/pkg/b.py", named("pkg.b", "target")],
    ["a Go package in the same directory", "store/a.go", "store/b.go", []],
    ["a Go import", "cmd/main.go", "internal/store/b.go", whole("github.com/o/r/internal/store")],
    ["a Java class in the same package", "src/com/x/A.java", "src/com/x/B.java", []],
    ["a Java class import", "src/com/y/A.java", "src/com/x/B.java", whole("com.x.B")],
    ["a Java wildcard import", "src/com/y/A.java", "src/com/x/B.java", named("com.x", "*")],
    ["a Java static import", "src/com/y/A.java", "src/com/x/B.java", whole("com.x.B.target")],
    ["a name in a language whose imports aren't read", "src/a.rs", "src/b.rs", []],
    ["code from its test", "tests/test_app.py", "app/core.py", named("app.core", "target")],
  ])("links through %s", (_, from, to, imports) => {
    expect(links(from, to, imports)).toBe(true);
  });

  it.each([
    ["a file that isn't imported", "web/page.ts", "web/text.ts", []],
    ["a name the import doesn't list", "web/page.ts", "web/text.ts", named("./text.ts", "other")],
    ["a package import", "web/page.ts", "web/react.ts", named("react", "target")],
    [
      "an import that climbs out of the repository",
      "page.ts",
      "text.ts",
      named("../text.ts", "target"),
    ],
    ["a Python import that climbs out of the repository", "a.py", "b.py", named("...b", "target")],
    ["another Python module of the package", "pkg/a.py", "pkg/c.py", named(".b", "target")],
    ["a Go package in another directory", "cmd/main.go", "store/b.go", []],
    ["a Go package at the repository root", "cmd/main.go", "b.go", whole("github.com/o/r")],
    ["a Java class in another package", "src/com/y/A.java", "src/com/x/B.java", []],
    [
      "another language with the same name",
      "web/Form.tsx",
      "app/forms.py",
      named("../app/forms", "target"),
    ],
    ["another language whose imports aren't read", "src/a.rs", "src/b.cs", []],
    [
      "a test fake from production code",
      "app/core.py",
      "tests/fakes.py",
      named("tests.fakes", "target"),
    ],
  ])("doesn't link to %s", (_, from, to, imports) => {
    expect(links(from, to, imports)).toBe(false);
  });

  it("follows a member to any file the import reaches, whatever names it lists", () => {
    expect(links("web/page.ts", "web/client.ts", named("./client.ts", "Client"), "member")).toBe(
      true,
    );
    expect(links("web/page.ts", "web/other.ts", named("./client.ts", "Client"), "member")).toBe(
      false,
    );
  });

  it("follows a member through `from pkg import module` to that module only", () => {
    const routes = named(".", "routes");
    expect(links("pkg/app.py", "pkg/routes.py", routes, "member")).toBe(true);
    expect(links("pkg/app.py", "pkg/other.py", routes, "member")).toBe(false);
    expect(links("pkg/app.py", "pkg/__init__.py", routes, "member")).toBe(true);
    expect(links("src/pkg/app.py", "src/pkg/routes.py", named("pkg", "routes"), "member")).toBe(
      true,
    );
  });

  it("doesn't follow a type annotation as a call, but records it as a type use", () => {
    expect(links("web/page.ts", "web/text.ts", named("./text.ts", "target"), "type")).toBe(false);
    const caller = hunk("web/page.ts", "@@ -1,0 +1,2 @@", ["+let a: Target;", "+build(a);"]);
    const callee = hunk("web/text.ts", "@@ -1,0 +1,1 @@", ["+define();"]);
    const hintsFor = (references: [string, number, Kind][]) =>
      buildCallGraphHints(
        [file("web/page.ts", caller), file("web/text.ts", callee)],
        new Map([
          ["web/page.ts", symbols([], references, named("./text.ts", "Target", "build"))],
          [
            "web/text.ts",
            symbols([
              ["Target", 1, 1],
              ["build", 1, 1],
            ]),
          ],
        ]),
      ).map(({ symbol, line, use }) => [symbol, line, use]);
    expect(hintsFor([["Target", 1, "type"]])).toEqual([["Target", 1, "type"]]);
    // A symbol the hunk also calls is a call.
    expect(
      hintsFor([
        ["Target", 1, "type"],
        ["Target", 2, "name"],
        ["build", 2, "name"],
      ]),
    ).toEqual([
      ["Target", 2, "call"],
      ["build", 2, "call"],
    ]);
  });

  it("doesn't link files without a language", () => {
    expect(links("web/page.ts", "web/text.vue", named("./text.vue", "target"))).toBe(false);
  });

  it("changes the innermost definition an added line falls in", () => {
    // Store spans lines 1–10, and its method save spans 3–5.
    const store = symbols([
      ["Store", 1, 10],
      ["save", 3, 5],
    ]);
    const linkedSymbols = (added: number) => {
      const callee = hunk("src/store.ts", `@@ -${added},0 +${added},1 @@`, ["+change();"]);
      const caller = hunk("src/page.ts", "@@ -1,0 +1,1 @@", ["+new Store().save();"]);
      return buildCallGraphHints(
        [file("src/page.ts", caller), file("src/store.ts", callee)],
        new Map([
          [
            "src/page.ts",
            symbols(
              [],
              [
                ["Store", 1],
                ["save", 1, "member"],
              ],
              named("./store.ts", "Store"),
            ),
          ],
          ["src/store.ts", store],
        ]),
      ).map((hint) => hint.symbol);
    };
    expect(linkedSymbols(4)).toEqual(["save"]);
    expect(linkedSymbols(2)).toEqual(["Store"]);
  });

  it("links a definition changed by several hunks once, to the first", () => {
    const top = hunk("src/store.ts", "@@ -2,0 +2,1 @@", ["+  a = 1;"]);
    const bottom = hunk("src/store.ts", "@@ -8,0 +9,1 @@", ["+  b = 2;"]);
    const caller = hunk("src/page.ts", "@@ -1,0 +1,1 @@", ["+new Store();"]);
    const hints = buildCallGraphHints(
      [file("src/page.ts", caller), file("src/store.ts", top, bottom)],
      new Map([
        ["src/page.ts", symbols([], [["Store", 1]], named("./store.ts", "Store"))],
        ["src/store.ts", symbols([["Store", 1, 10]])],
      ]),
    );
    expect(hints.map((hint) => hint.toPartId)).toEqual([top.id]);
  });

  it("links a call in a class to the same-named method of that class", () => {
    // GitHub (1–10) and Bitbucket (11–20) each change their own method auth; GitHub.load calls it.
    const github = hunk("src/hosts.py", "@@ -2,0 +2,1 @@", ["+        return token"]);
    const bitbucket = hunk("src/hosts.py", "@@ -12,0 +12,1 @@", ["+        return token"]);
    const load = hunk("src/hosts.py", "@@ -5,0 +5,1 @@", ["+        self.auth()"]);
    const hints = buildCallGraphHints(
      [file("src/hosts.py", github, load, bitbucket)],
      new Map([
        [
          "src/hosts.py",
          symbols(
            [
              ["GitHub", 1, 10],
              ["auth", 2, 3],
              ["load", 4, 6],
              ["Bitbucket", 11, 20],
              ["auth", 12, 13],
            ],
            [["auth", 5, "member"]],
          ),
        ],
      ]),
    );
    expect(hints).toEqual([
      { fromPartId: load.id, toPartId: github.id, symbol: "auth", line: 5, use: "call" },
    ]);
  });

  it("links a method to the same-named one it delegates to, not to itself", () => {
    const own = hunk("src/app.ts", "@@ -2,0 +2,2 @@", ["+  save() {", "+    this.store.save();"]);
    const other = hunk("src/store.ts", "@@ -1,0 +1,1 @@", ["+  save() {}"]);
    const hints = buildCallGraphHints(
      [file("src/app.ts", own), file("src/store.ts", other)],
      new Map([
        [
          "src/app.ts",
          symbols(
            [
              ["App", 1, 10],
              ["save", 2, 4],
            ],
            [["save", 3, "member"]],
            whole("./store.ts"),
          ),
        ],
        ["src/store.ts", symbols([["save", 1, 1]])],
      ]),
    );
    expect(hints).toEqual([
      { fromPartId: own.id, toPartId: other.id, symbol: "save", line: 3, use: "call" },
    ]);
  });
});

describe("changedDefinitionNames", () => {
  it("names the innermost definitions each hunk adds lines to", () => {
    const method = hunk("src/store.ts", "@@ -4,0 +4,1 @@", ["+change();"]);
    const field = hunk("src/store.ts", "@@ -1,0 +2,1 @@", ["+  a = 1;"]);
    const outside = hunk("src/store.ts", "@@ -20,0 +20,1 @@", ["+// end"]);
    const names = changedDefinitionNames(
      [file("src/store.ts", field, method, outside)],
      new Map([
        [
          "src/store.ts",
          symbols([
            ["Store", 1, 10],
            ["save", 3, 5],
          ]),
        ],
      ]),
    );
    expect(names).toEqual(
      new Map([
        [field.id, ["Store"]],
        [method.id, ["save"]],
        [outside.id, []],
      ]),
    );
  });
});

describe("hints and definitions on parts", () => {
  // Two routes in one hunk, each calling its own service function in a later hunk.
  const routes = hunk("app.py", "@@ -1,0 +1,4 @@", [
    "+def read():",
    "+    return load()",
    "+def write():",
    "+    return store()",
  ]);
  const service = hunk("app.py", "@@ -1,0 +10,4 @@", [
    "+def load():",
    "+    pass",
    "+def store():",
    "+    pass",
  ]);
  const appSymbols = symbols(
    [
      ["read", 1, 2],
      ["write", 3, 4],
      ["load", 10, 11],
      ["store", 12, 13],
    ],
    [
      ["load", 2],
      ["store", 4],
    ],
  );
  const byPath = new Map([["app.py", appSymbols]]);
  const files = [file("app.py", routes, service)];
  const parts = [routes, service].flatMap((one) =>
    splitByDefinition(one, { head: appSymbols.definitions, base: [] }),
  );
  const [read, write, load, store] = parts.map((part) => part.id);

  it("points each part at the parts it calls", () => {
    expect(
      buildCallGraphHints(files, byPath, parts).map((hint) => [hint.fromPartId, hint.toPartId]),
    ).toEqual([
      [read, load],
      [write, store],
    ]);
  });

  it("names each part's changed definitions", () => {
    expect([...changedDefinitionNames(files, byPath, parts)]).toEqual([
      [read, ["read"]],
      [write, ["write"]],
      [load, ["load"]],
      [store, ["store"]],
    ]);
  });
});
