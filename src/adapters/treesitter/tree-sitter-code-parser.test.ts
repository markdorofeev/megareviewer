import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  CodeParser,
  SymbolDefinition,
  SymbolReference,
} from "../../application/ports/index.ts";
import { createTreeSitterCodeParser } from "./index.ts";
import { LANGUAGES } from "./languages.ts";

const grammarsDir = fileURLToPath(new URL("grammars", import.meta.url));

let parser: CodeParser;
beforeAll(async () => {
  parser = await createTreeSitterCodeParser({ grammarsDir, maxFileBytes: 10_000 });
});

const symbolsOf = async (source: string, language: string) => {
  const result = await parser.symbols(source, language);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

type Definition = [name: string, kind: SymbolDefinition["kind"], start: number, end: number];

/** Per language: a source, the definitions it has, and the references it makes. */
const cases: [
  language: string,
  source: string,
  definitions: Definition[],
  references: [name: string, line: number, kind: SymbolReference["kind"]][],
][] = [
  [
    "typescript",
    `export class Store extends Base {
  get(key: Key): Value {
    return this.cache.read(key) ?? load(new Request(key));
  }
}
export interface Key { id: string }
export type Value = string;
enum Mode { A }
export const limit = 10;
const handler = (input: Key) => process(input);
function process(input: Key): void {}
`,
    [
      ["Store", "class", 1, 5],
      ["get", "method", 2, 4],
      ["Key", "type", 6, 6],
      ["Value", "type", 7, 7],
      ["Mode", "type", 8, 8],
      ["limit", "variable", 9, 9],
      ["handler", "function", 10, 10],
      ["process", "function", 11, 11],
    ],
    [
      ["Base", 1, "name"],
      ["Key", 2, "type"],
      ["Value", 2, "type"],
      ["Request", 3, "name"],
      ["cache", 3, "member"],
      ["load", 3, "name"],
      ["read", 3, "member"],
      ["Key", 10, "type"],
      ["process", 10, "name"],
      ["Key", 11, "type"],
    ],
  ],
  [
    "tsx",
    `export function Page(props: Props) {
  return <Layout.Main><Header title={props.title} /></Layout.Main>;
}
`,
    [["Page", "function", 1, 3]],
    [
      ["Props", 1, "type"],
      ["Header", 2, "name"],
      ["Layout", 2, "name"],
      ["Main", 2, "member"],
      ["props", 2, "name"],
      ["title", 2, "member"],
    ],
  ],
  [
    "javascript",
    `class Store extends Base {
  get(key) {
    return load(new Request(key)).body;
  }
}
export const view = () => <Header />;
`,
    [
      ["Store", "class", 1, 5],
      ["get", "method", 2, 4],
      ["view", "function", 6, 6],
    ],
    [
      ["Base", 1, "name"],
      ["Request", 3, "name"],
      ["body", 3, "member"],
      ["load", 3, "name"],
      ["Header", 6, "name"],
    ],
  ],
  [
    "python",
    `LIMIT = 10

class Store(Base):
    @cached
    def get(self, key: Key) -> Value:
        return load(Request(key)).body

def helper():
    pass
`,
    [
      ["LIMIT", "variable", 1, 1],
      ["Store", "class", 3, 6],
      ["get", "method", 5, 6],
      ["helper", "function", 8, 9],
    ],
    [
      ["Key", 5, "type"],
      ["Value", 5, "type"],
      ["Request", 6, "name"],
      ["body", 6, "member"],
      ["load", 6, "name"],
    ],
  ],
  [
    "go",
    `package store

var Limit = 10

type Store struct{ cache Cache }

type Reader interface{ Read() }

func (s *Store) Get(key Key) Value {
	return load(s.cache.Read(key))
}

func load(v Value) Value { return v }
`,
    [
      ["Limit", "variable", 3, 3],
      ["Store", "class", 5, 5],
      ["Reader", "type", 7, 7],
      ["Get", "method", 9, 11],
      ["load", "function", 13, 13],
    ],
    [
      ["Cache", 5, "type"],
      ["Key", 9, "type"],
      ["Store", 9, "type"],
      ["Value", 9, "type"],
      ["Read", 10, "member"],
      ["cache", 10, "member"],
      ["load", 10, "name"],
      ["s", 10, "name"],
      ["Value", 13, "type"],
    ],
  ],
  [
    "java",
    `class Store extends Base {
  private int limit = 10;

  Store() {}

  Value get(Key key) {
    return loader.load(new Request(key));
  }
}
interface Key {}
`,
    [
      ["Store", "class", 1, 9],
      ["limit", "variable", 2, 2],
      ["Store", "method", 4, 4],
      ["get", "method", 6, 8],
      ["Key", "type", 10, 10],
    ],
    [
      ["Base", 1, "type"],
      ["Key", 6, "type"],
      ["Value", 6, "type"],
      ["Request", 7, "name"],
      ["load", 7, "member"],
      ["loader", 7, "name"],
    ],
  ],
  [
    "rust",
    `const LIMIT: usize = 10;

struct Store { cache: Cache }

impl Store {
    fn get(&self, key: Key) -> Value {
        load(self.cache.read(key), Request::new(key))
    }
}

fn load(v: Value) -> Value { v }
`,
    [
      ["LIMIT", "variable", 1, 1],
      ["Store", "class", 3, 3],
      ["get", "method", 6, 8],
      ["load", "function", 11, 11],
    ],
    [
      ["Cache", 3, "type"],
      ["Store", 5, "type"],
      ["Key", 6, "type"],
      ["Value", 6, "type"],
      ["cache", 7, "member"],
      ["load", 7, "name"],
      ["new", 7, "member"],
      ["read", 7, "member"],
      ["Value", 11, "type"],
    ],
  ],
  [
    "c_sharp",
    `class Store : IStore {
    private int limit = 10;

    public Value Get(Key key) {
        return Loader.Load(new Request(key));
    }
}
interface IStore {}
`,
    [
      ["Store", "class", 1, 7],
      ["limit", "variable", 2, 2],
      ["Get", "method", 4, 6],
      ["IStore", "type", 8, 8],
    ],
    [
      ["IStore", 1, "name"],
      ["Key", 4, "type"],
      ["Value", 4, "type"],
      ["Load", 5, "member"],
      ["Loader", 5, "name"],
      ["Request", 5, "name"],
    ],
  ],
];

describe("createTreeSitterCodeParser", () => {
  it.each(cases)("finds %s definitions and references", async (language, source, defs, refs) => {
    const { definitions, references } = await symbolsOf(source, language);
    expect(definitions).toEqual(
      defs.map(([name, kind, startLine, endLine]) => ({ name, kind, startLine, endLine })),
    );
    expect(references).toEqual(refs.map(([name, line, kind]) => ({ name, line, kind })));
  });

  it("covers every language", () => {
    expect(cases.map(([language]) => language)).toEqual(LANGUAGES.map((spec) => spec.name));
  });

  it.each([
    [
      "python",
      `from ..models import A, B as C
from . import routes
from x import *
import a.b
import a.b as c
`,
      [
        { module: "..models", names: ["A", "B"] },
        { module: ".", names: ["routes"] },
        { module: "x", names: null },
        { module: "a.b", names: null },
        { module: "a.b", names: null },
      ],
    ],
    [
      "typescript",
      `import D, { a, b as c } from "./m.ts";
import * as ns from "../n";
import type { T } from "@/t";
import "./side";
export { x } from "./y";
const z = require("./r");
`,
      [
        { module: "./m.ts", names: null },
        { module: "../n", names: null },
        { module: "@/t", names: ["T"] },
        { module: "./r", names: null },
      ],
    ],
    ["tsx", `import { Page } from "./page";\n`, [{ module: "./page", names: ["Page"] }]],
    [
      "javascript",
      `const x = require("./m");
import { a } from "./m.js";
require(name);
load("./z");
`,
      [
        { module: "./m", names: null },
        { module: "./m.js", names: ["a"] },
      ],
    ],
    [
      "go",
      `package p
import "fmt"
import (
  s "github.com/o/r/store"
  "github.com/o/r/x"
)
`,
      [
        { module: "fmt", names: null },
        { module: "github.com/o/r/store", names: null },
        { module: "github.com/o/r/x", names: null },
      ],
    ],
    [
      "java",
      `import com.x.Foo;
import com.x.*;
import static com.x.Foo.bar;
class A {}
`,
      [
        { module: "com.x.Foo", names: null },
        { module: "com.x", names: ["*"] },
        { module: "com.x.Foo.bar", names: null },
      ],
    ],
    ["rust", "use crate::a::b;\n", []],
    ["c_sharp", "using System;\n", []],
  ])("finds %s imports", async (language, source, imports) => {
    expect((await symbolsOf(source, language)).imports).toEqual(imports);
  });

  it.each([
    ["java", "class A { void f() { load(x); } }\n", [["load", 1, "name"]]],
    [
      "go",
      "package p\nfunc f() { _ = Store{}; _ = pkg.Store{} }\n",
      [
        ["Store", 2, "member"],
        ["Store", 2, "name"],
      ],
    ],
    ["rust", "fn f() { let s = Store { cache: c }; }\n", [["Store", 1, "name"]]],
  ])("counts a %s call or construction as a use by name", async (language, source, refs) => {
    expect((await symbolsOf(source, language)).references).toEqual(
      refs.map(([name, line, kind]) => ({ name, line, kind })),
    );
  });

  it.each([
    ["src/a.ts", "typescript"],
    ["src/a.d.ts", "typescript"],
    ["src/a.mts", "typescript"],
    ["src/a.cts", "typescript"],
    ["src/A.tsx", "tsx"],
    ["a.js", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.jsx", "javascript"],
    ["pkg/a.py", "python"],
    ["pkg/a.pyi", "python"],
    ["main.go", "go"],
    ["A.java", "java"],
    ["lib.rs", "rust"],
    ["A.cs", "c_sharp"],
    ["A.TS", "typescript"],
    ["README.md", null],
    ["Makefile", null],
    [".ts", null],
    ["dir.ts/file", null],
  ])("maps %s to %s", (path, language) => {
    expect(parser.languageFor(path)).toBe(language);
  });

  it("lists every node in pre-order, with text on leaves and an end after inner nodes", async () => {
    const end = { type: "", text: "" };
    expect(await parser.syntaxNodes("f(x);", "javascript")).toEqual({
      ok: true,
      value: [
        { type: "program", text: "" },
        { type: "expression_statement", text: "" },
        { type: "call_expression", text: "" },
        { type: "identifier", text: "f" },
        { type: "arguments", text: "" },
        { type: "(", text: "(" },
        { type: "identifier", text: "x" },
        { type: ")", text: ")" },
        end,
        end,
        { type: ";", text: ";" },
        end,
        end,
      ],
    });
  });

  it("keeps comments and non-ASCII text", async () => {
    const result = await parser.syntaxNodes('// é\nconst s = "日本";', "typescript");
    if (!result.ok) throw new Error(result.error.message);
    const leaves = result.value.flatMap((node) => (node.text === "" ? [] : [node.text]));
    expect(leaves).toEqual(["// é", "const", "s", "=", '"', "日本", '"', ";"]);
  });

  it("keeps text no node covers, such as a raw string's delimiters", async () => {
    const result = await parser.syntaxNodes('const S: &str = r#" a "#;', "rust");
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContainEqual({ type: "", text: 'r#" ' });
  });

  it.each([
    ["a syntax error", "function (", "javascript"],
    ["a missing token", "def f(:\n  pass", "python"],
    ["an unclosed block", "class A {", "java"],
  ])("returns parse-error for %s", async (_, source, language) => {
    for (const result of [
      await parser.syntaxNodes(source, language),
      await parser.symbols(source, language),
    ]) {
      expect(result).toEqual({
        ok: false,
        error: { kind: "parse-error", message: "the file has a syntax error" },
      });
    }
  });

  it("refuses a file larger than maxFileBytes, counted in UTF-8", async () => {
    // 3,400 characters but 10,200 bytes.
    const source = `// ${"日".repeat(3_400)}`;
    expect(await parser.syntaxNodes(source, "typescript")).toEqual({
      ok: false,
      error: { kind: "unsupported-language", message: "file too large to parse" },
    });
    expect((await parser.symbols(source, "typescript")).ok).toBe(false);
  });

  it("refuses a language it has no grammar for", async () => {
    expect(await parser.syntaxNodes("x", "cobol")).toEqual({
      ok: false,
      error: { kind: "unsupported-language", message: "no grammar for cobol" },
    });
  });

  it("parses an empty file", async () => {
    expect(await parser.syntaxNodes("", "python")).toEqual({
      ok: true,
      value: [{ type: "module", text: "" }],
    });
  });

  it("shares the runtime between parsers", async () => {
    const second = await createTreeSitterCodeParser({ grammarsDir });
    expect((await second.syntaxNodes("x", "go")).ok).toBe(false);
    expect((await second.symbols("package p", "go")).ok).toBe(true);
  });
});
