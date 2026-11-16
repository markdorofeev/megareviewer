import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createShikiHighlighter,
  type Highlighter,
  HighlighterContext,
  type SyntaxToken,
  syntaxTokens,
  syntaxType,
  tokensForHunk,
  useHunkTokens,
} from "./syntax.ts";
import { firstHunk, modifiedFile } from "./testing.ts";

describe("syntaxType", () => {
  it("reads the type from the CSS-variables theme's color", () => {
    expect(syntaxType("var(--shiki-token-keyword)")).toBe("keyword");
    expect(syntaxType("var(--shiki-token-string-expression)")).toBe("string");
    expect(syntaxType("var(--shiki-token-constant)")).toBe("number");
    expect(syntaxType("var(--shiki-token-punctuation)")).toBeNull();
    expect(syntaxType("var(--shiki-foreground)")).toBeNull();
    expect(syntaxType("#ff0000")).toBeNull();
    expect(syntaxType(undefined)).toBeNull();
  });
});

describe("syntaxTokens", () => {
  it("merges neighbors of one type", () => {
    expect(
      syntaxTokens([
        { content: "return", color: "var(--shiki-token-keyword)" },
        { content: " ", color: "var(--shiki-foreground)" },
        { content: "(", color: "var(--shiki-token-punctuation)" },
        { content: "1", color: "var(--shiki-token-constant)" },
      ]),
    ).toEqual([
      { text: "return", type: "keyword" },
      { text: " (", type: null },
      { text: "1", type: "number" },
    ]);
  });
});

describe("tokensForHunk", () => {
  const hunk = firstHunk(modifiedFile("a.ts", ["@@ -1,2 +1,2 @@", " a", "-b", "+c"]));
  const plain = (text: string) => [{ text, type: null }];

  it("takes deleted lines from the old side and the rest from the new side", () => {
    expect(tokensForHunk(hunk, [plain("a"), plain("b")], [plain("a"), plain("c")])).toEqual([
      plain("a"),
      plain("b"),
      plain("c"),
    ]);
  });

  it("leaves a line plain when its tokens spell something else", () => {
    expect(tokensForHunk(hunk, [plain("a"), plain("x")], [plain("a"), plain("c")])[1]).toBeNull();
  });
});

describe("createShikiHighlighter", () => {
  it("returns null for a language without a grammar", async () => {
    expect(await createShikiHighlighter().highlight("a", "weird")).toBeNull();
  });

  it("types tokens by the CSS-variables theme and keeps long lines whole", async () => {
    const long = `const a = "${"x".repeat(1200)}";`;
    const tokens = await createShikiHighlighter().highlight(`let b = 1;\n${long}`, "typescript");
    expect(tokens?.[0]).toContainEqual({ text: "let", type: "keyword" });
    expect(tokens?.[0]).toContainEqual({ text: "1", type: "number" });
    expect(tokens?.[1]).toEqual([{ text: long, type: null }]);
  });

  it("colors a changed line inside a multi-line string as part of the string", async () => {
    const hunk = firstHunk(
      modifiedFile("src/query.ts", [
        "@@ -1,4 +1,4 @@",
        " const query = `",
        "-  SELECT id",
        "+  SELECT id, name",
        "   FROM users`;",
        " run(query);",
      ]),
    );
    const highlighter = createShikiHighlighter();
    const tokens = tokensForHunk(
      hunk,
      await highlighter.highlight(
        "const query = `\n  SELECT id\n  FROM users`;\nrun(query);",
        "typescript",
      ),
      await highlighter.highlight(
        "const query = `\n  SELECT id, name\n  FROM users`;\nrun(query);",
        "typescript",
      ),
    );
    expect(tokens[1]).toEqual([{ text: "  SELECT id", type: "string" }]);
    expect(tokens[2]).toEqual([{ text: "  SELECT id, name", type: "string" }]);
    expect(tokens[4]?.[0]).toEqual({ text: "run", type: "function" });
  });
});

/** The type of each whole-word occurrence of `word` on a line, or "mixed" when it spans two. */
const typesOf = (line: readonly SyntaxToken[] | undefined, word: string) => {
  const spans: { start: number; end: number; type: SyntaxToken["type"] }[] = [];
  for (const token of line ?? []) {
    const start = spans.at(-1)?.end ?? 0;
    spans.push({ start, end: start + token.text.length, type: token.type });
  }
  const text = (line ?? []).map((token) => token.text).join("");
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = /^[\w$]/.test(word) ? "(?<![\\w$])" : "";
  const after = /[\w$]$/.test(word) ? "(?![\\w$])" : "";
  return [...text.matchAll(new RegExp(`${before}${escaped}${after}`, "g"))].map(({ index }) => {
    const types = new Set(
      spans
        .filter(({ start, end }) => start < index + word.length && end > index)
        .map(({ type }) => type),
    );
    return types.size === 1 ? [...types][0] : "mixed";
  });
};

describe("Java", () => {
  const java = (...lines: string[]) => createShikiHighlighter().highlight(lines.join("\n"), "java");

  // A hunk's side starts inside a class, where Java's grammar read a method declaration as a call:
  // the name, its parameters and their parentheses one color, and `throws` and its type plain.
  it("reads a method declared in a hunk as a declaration", async () => {
    const tokens = await java(
      '    @GetMapping("/{id}")',
      '    public Optional<Order> find(@PathVariable("id") String id) throws NotFoundException {',
      "        return repository.findById(id);",
      "    }",
    );
    const signature = tokens?.[1];
    expect(typesOf(signature, "find")).toEqual(["function"]);
    expect(typesOf(signature, "throws")).toEqual(["keyword"]);
    expect(typesOf(signature, "@PathVariable")).toEqual(["number"]);
    for (const plain of ["Optional<Order>", "(", ") String id)", "NotFoundException"]) {
      expect(typesOf(signature, plain).every((type) => type === null)).toBe(true);
    }
  });

  // In a class body the grammar read a statement as a method: `if` was a function, `return` plain.
  it("reads statements in a hunk that starts inside a method", async () => {
    const tokens = await java(
      "        if (order instanceof PersistentOrder persistent) {",
      "            return persistent;",
      "        }",
      "    }",
      "",
      "    public void save(Path path) throws IOException {",
    );
    expect(typesOf(tokens?.[0], "if")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[0], "instanceof")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[1], "return")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[5], "save")).toEqual(["function"]);
    expect(typesOf(tokens?.[5], "throws")).toEqual(["keyword"]);
  });

  it("reads what follows a hunk that starts deeper than a method's body", async () => {
    const tokens = await java(
      '            default -> "Unknown";',
      "        };",
      "    }",
      "",
      "    public void save(Path path) throws IOException {",
      "        log.error(path);",
      "    }",
    );
    expect(typesOf(tokens?.[4], "save")).toEqual(["function"]);
    expect(typesOf(tokens?.[4], "throws")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[4], "Path")).toEqual([null]);
  });

  it("colors the rest of a Javadoc a hunk starts inside as a comment", async () => {
    const tokens = await java("     * Finds the order.", "     */", "    public Order find() {");
    expect(tokens?.[0]).toEqual([{ text: "     * Finds the order.", type: "comment" }]);
    expect(typesOf(tokens?.[2], "find")).toEqual(["function"]);
  });

  // The grammar named a type storage.type in a declaration and nothing in a cast, a method
  // reference or before a static call, so one type was two colors.
  it("leaves a type plain wherever it's used, and colors what a declaration declares", async () => {
    const tokens = await java(
      "public class OrderService<T extends Item> implements Service {",
      "    private final Map<String, List<Line>> bySku = new HashMap<>();",
      "    Order cast(Object o) { return (Order) Order.of(o, Line::sku); }",
    );
    expect(typesOf(tokens?.[0], "OrderService")).toEqual(["function"]);
    for (const type of ["T", "Item", "Service"]) {
      expect(typesOf(tokens?.[0], type)).toEqual([null]);
    }
    for (const type of ["Map", "String", "List", "Line", "HashMap"]) {
      expect(typesOf(tokens?.[1], type)).toEqual([null]);
    }
    expect(typesOf(tokens?.[1], "private")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[1], "new")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[2], "Order")).toEqual([null, null, null]);
    expect(typesOf(tokens?.[2], "cast")).toEqual(["function"]);
    expect(typesOf(tokens?.[2], "of")).toEqual(["function"]);
  });

  // A call's scope covers its arguments, which the theme then colored as the call.
  it("colors a call's name and not its arguments", async () => {
    const tokens = await java(
      "    void fail(Status status) {",
      '        throw new IllegalStateException("Unknown: " + status);',
      "        return price() * quantity;",
    );
    expect(typesOf(tokens?.[1], "IllegalStateException")).toEqual(["function"]);
    expect(typesOf(tokens?.[1], "status")).toEqual([null]);
    expect(typesOf(tokens?.[1], "(")).toEqual([null]);
    expect(typesOf(tokens?.[1], ");")).toEqual([null]);
    expect(typesOf(tokens?.[2], "price")).toEqual(["function"]);
    expect(typesOf(tokens?.[2], "()")).toEqual([null]);
  });

  it("colors annotations, constants, literals and super apart from types and calls", async () => {
    const tokens = await java(
      "@RestController",
      "public class Orders {",
      "    private static final int MAX_ITEMS = 1_000;",
      "    @Override",
      "    public String label(Status status) {",
      '        LOG.debug("{}", TimeUnit.SECONDS);',
      "        if (status == Status.PENDING) return super.label(null);",
      '        return switch (status) { case SHIPPED -> "On its way"; default -> MAX_ITEMS + "" + true; };',
    );
    expect(typesOf(tokens?.[0], "@RestController")).toEqual(["number"]);
    expect(typesOf(tokens?.[3], "@Override")).toEqual(["number"]);
    expect(typesOf(tokens?.[2], "MAX_ITEMS")).toEqual(["number"]);
    expect(typesOf(tokens?.[2], "1_000")).toEqual(["number"]);
    expect(typesOf(tokens?.[5], "LOG")).toEqual(["number"]);
    expect(typesOf(tokens?.[5], "SECONDS")).toEqual(["number"]);
    expect(typesOf(tokens?.[5], "TimeUnit")).toEqual([null]);
    expect(typesOf(tokens?.[5], "debug")).toEqual(["function"]);
    expect(typesOf(tokens?.[6], "PENDING")).toEqual(["number"]);
    expect(typesOf(tokens?.[6], "super")).toEqual(["number"]);
    expect(typesOf(tokens?.[6], "null")).toEqual(["number"]);
    expect(typesOf(tokens?.[7], "SHIPPED")).toEqual(["number"]);
    expect(typesOf(tokens?.[7], "MAX_ITEMS")).toEqual(["number"]);
    expect(typesOf(tokens?.[7], "true")).toEqual(["number"]);
    expect(typesOf(tokens?.[7], "->")).toEqual(["keyword", "keyword"]);
  });

  it("leaves import paths, receivers, fields and operators plain", async () => {
    const tokens = await java(
      "import java.util.List;",
      "class A {",
      "    void run() {",
      "        var order = orders.get(id);",
      "        this.count++;",
      "        int[] counts = new int[size > 0 ? size : 1];",
      "    }",
    );
    expect(typesOf(tokens?.[0], "import")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[0], "java")).toEqual([null]);
    expect(typesOf(tokens?.[0], "List")).toEqual([null]);
    expect(typesOf(tokens?.[3], "var")).toEqual(["keyword"]);
    expect(typesOf(tokens?.[3], "orders")).toEqual([null]);
    expect(typesOf(tokens?.[3], "=")).toEqual([null]);
    expect(typesOf(tokens?.[3], "get")).toEqual(["function"]);
    expect(typesOf(tokens?.[4], "count")).toEqual([null]);
    expect(typesOf(tokens?.[5], "int")).toEqual(["keyword", "keyword"]);
    expect(typesOf(tokens?.[5], "?")).toEqual([null]);
  });
});

describe("useHunkTokens", () => {
  const file = modifiedFile("src/a.ts", ["@@ -1,1 +1,1 @@", "-const a = 1;", "+const a = 2;"]);
  const hunk = firstHunk(file);
  const instant: Highlighter = {
    highlight: async (code) => code.split("\n").map((text) => [{ text, type: "keyword" }]),
  };
  const Probe = () => <p>{useHunkTokens(hunk, file) === null ? "plain" : "highlighted"}</p>;
  const act = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actBefore = act.IS_REACT_ACT_ENVIRONMENT;
  afterEach(() => {
    act.IS_REACT_ACT_ENVIRONMENT = actBefore;
  });

  it("shows tokens that are ready before its effect runs", async () => {
    // Outside act, React runs effects a task after the render, and a fast highlight resolves in
    // between: the card has to show it all the same, not stay plain.
    act.IS_REACT_ACT_ENVIRONMENT = false;
    const box = document.createElement("div");
    const root = createRoot(box);
    root.render(
      <HighlighterContext.Provider value={instant}>
        <Probe />
      </HighlighterContext.Provider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(box.textContent).toBe("highlighted");
    root.unmount();
  });
});
