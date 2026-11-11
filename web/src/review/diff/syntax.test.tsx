import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createShikiHighlighter,
  type Highlighter,
  HighlighterContext,
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
