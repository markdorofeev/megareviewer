import { describe, expect, it } from "vitest";
import { composeBody, parseBlocks, parseBody, parseSpans, suggestionOf } from "./thread-body.ts";

describe("parseSpans", () => {
  it("reads code spans and leaves the rest as text", () => {
    expect(parseSpans("call `retry()` twice")).toEqual([
      { kind: "text", text: "call " },
      { kind: "code", text: "retry()" },
      { kind: "text", text: " twice" },
    ]);
  });

  it("matches a run of backticks only with one as long", () => {
    expect(parseSpans("``a`b`` and `c`")).toEqual([
      { kind: "code", text: "a`b" },
      { kind: "text", text: " and " },
      { kind: "code", text: "c" },
    ]);
    expect(parseSpans("`` ` ``")).toEqual([{ kind: "code", text: "`" }]);
  });

  it("keeps an unmatched backtick as text", () => {
    expect(parseSpans("a ` b ``c")).toEqual([{ kind: "text", text: "a ` b ``c" }]);
  });

  it("reads images, keeping only the URLs of the host's own attachments", () => {
    const asset = "https://github.com/user-attachments/assets/771a3d24-9ce2-4554-96da-50a773965ff5";
    expect(
      parseSpans(
        `see <img width="819" height="401" alt="Screenshot 16 45" src="${asset}" /> and ![diagram](https://evil.test/a.png) or <IMG src=x>`,
      ),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "image", text: "Screenshot 16 45", url: asset, size: { width: 819, height: 401 } },
      { kind: "text", text: " and " },
      { kind: "image", text: "diagram", url: null },
      { kind: "text", text: " or " },
      { kind: "image", text: "", url: null },
    ]);
    expect(parseSpans("`<img alt='x' src=y>`")).toEqual([
      { kind: "code", text: "<img alt='x' src=y>" },
    ]);
    expect(parseSpans(`<img alt='single' src='${asset}'>`)).toEqual([
      { kind: "image", text: "single", url: asset },
    ]);
  });

  it("reads a GitHub attachment alone on a line as a video, and leaves it as text inside a sentence", () => {
    const asset = "https://github.com/user-attachments/assets/0f9a-12";
    expect(parseSpans(`Repro:\n${asset}\nafter`)).toEqual([
      { kind: "text", text: "Repro:\n" },
      { kind: "video", text: "", url: asset },
      { kind: "text", text: "\nafter" },
    ]);
    expect(parseSpans(`see ${asset} here`)).toEqual([{ kind: "text", text: `see ${asset} here` }]);
  });

  it("keeps HTML and links as text", () => {
    expect(parseSpans("<script>alert(1)</script> [x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "<script>alert(1)</script> [x](javascript:alert(1))" },
    ]);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs on blank lines and keeps line breaks inside one", () => {
    expect(parseBlocks("one\ntwo\n\n\nthree\r\n")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "one\ntwo" }] },
      { kind: "paragraph", spans: [{ kind: "text", text: "three" }] },
    ]);
  });

  it("reads fenced code with its language", () => {
    expect(parseBlocks("Try:\n```ts\nconst a = 1;\n```\nafter")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "Try:" }] },
      { kind: "code", language: "ts", text: "const a = 1;" },
      { kind: "paragraph", spans: [{ kind: "text", text: "after" }] },
    ]);
  });

  it("reads a suggestion's lines, blank ones included", () => {
    expect(parseBlocks("```suggestion\n  a\n\n  b\n```")).toEqual([
      { kind: "suggestion", lines: ["  a", "", "  b"] },
    ]);
  });

  it("reads an empty suggestion as one that deletes the lines", () => {
    expect(parseBlocks("```suggestion\n```")).toEqual([{ kind: "suggestion", lines: [] }]);
  });

  it("shows a fence that doesn't close as text, never as a suggestion", () => {
    expect(parseBlocks("```suggestion\nreturn 1;")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "```suggestion\nreturn 1;" }] },
    ]);
    expect(suggestionOf("```suggestion\nreturn 1;")).toBeNull();
  });

  it("needs a closing fence at least as long as the opening one", () => {
    expect(parseBlocks("````suggestion\n```\ninner\n```\n````")).toEqual([
      { kind: "suggestion", lines: ["```", "inner", "```"] },
    ]);
  });

  it("shows a suggestion with a fence of its own length inside as code", () => {
    const body = "```suggestion\n```suggestion\nx\n```\n```";
    expect(parseBlocks(body)[0]).toEqual({
      kind: "code",
      language: null,
      text: "```suggestion\nx",
    });
    expect(suggestionOf(body)).toBeNull();
  });

  it("doesn't read a fence with backticks in its info string", () => {
    const blocks = parseBlocks("``` a`b\nx\n```");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });
});

describe("parseBody and suggestionOf", () => {
  it("reads the blocks", () => {
    expect(parseBody("Use `const`\n```suggestion\nconst a = 1;\n```")).toEqual({
      blocks: [
        {
          kind: "paragraph",
          spans: [
            { kind: "text", text: "Use " },
            { kind: "code", text: "const" },
          ],
        },
        { kind: "suggestion", lines: ["const a = 1;"] },
      ],
    });
  });

  it("keeps a prefix like **major:** in the text", () => {
    expect(parseBody("**major:** Retries forever").blocks).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "**major:** Retries forever" }] },
    ]);
  });

  it("finds no suggestion when there are two", () => {
    expect(suggestionOf("```suggestion\na\n```\n```suggestion\nb\n```")).toBeNull();
    expect(suggestionOf("no suggestion")).toBeNull();
  });
});

describe("composeBody", () => {
  it("writes what parseBody reads back", () => {
    const body = composeBody({ body: " Use const ", suggestion: ["const a = 1;"] });
    expect(body).toBe("Use const\n\n```suggestion\nconst a = 1;\n```");
    expect(suggestionOf(body)).toEqual(["const a = 1;"]);
  });

  it("writes a suggestion alone, and text alone", () => {
    expect(composeBody({ body: "", suggestion: [] })).toBe("```suggestion\n```");
    expect(composeBody({ body: "plain", suggestion: null })).toBe("plain");
  });

  it("fences a suggestion that holds fences with more backticks", () => {
    const lines = ["```ts", "x", "````"];
    const body = composeBody({ body: "", suggestion: lines });
    expect(body.startsWith("`````suggestion\n")).toBe(true);
    expect(suggestionOf(body)).toEqual(lines);
  });
});
