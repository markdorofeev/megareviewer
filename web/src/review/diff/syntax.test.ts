import { describe, expect, it } from "vitest";
import { firstHunk, modifiedFile } from "../../diff/testing.ts";
import { syntaxTokens, syntaxType, tokensForHunk } from "./syntax.ts";

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
