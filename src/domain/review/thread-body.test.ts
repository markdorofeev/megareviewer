import { describe, expect, it } from "vitest";
import { threadLines } from "./thread.ts";
import {
  applyEdits,
  composeBody,
  editsOverlap,
  parseBlocks,
  parseBody,
  parseSpans,
  splitSeverity,
  suggestionOf,
} from "./thread-body.ts";

describe("splitSeverity", () => {
  it.each([
    ["**major:** Retries forever", "major", "Retries forever"],
    ["**minor:** Name it", "minor", "Name it"],
    ["**blocking:**\nLeaks the token", "blocking", "Leaks the token"],
    ["**blocking:**", "blocking", ""],
  ] as const)("reads %j", (body, severity, rest) => {
    expect(splitSeverity(body)).toEqual({ severity, rest });
  });

  it.each([
    "**Major:** capitalized",
    "major: no bold",
    "**major**: colon outside",
    " **major:** leading space",
    "Looks fine. **major:** in the middle",
    "**nit:** not a level",
    "**major:**glued",
    "*major:* italics",
  ])("gives no severity for the near miss %j", (body) => {
    expect(splitSeverity(body)).toEqual({ severity: null, rest: body });
  });
});

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

  it("names images instead of showing their tags, and never in code", () => {
    expect(
      parseSpans(
        'see <img width="819" alt="Screenshot 16 45" src="https://github.com/user-attachments/assets/1" /> and ![diagram](https://x.test/a.png) or <IMG src=x>',
      ),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "image", text: "Screenshot 16 45" },
      { kind: "text", text: " and " },
      { kind: "image", text: "diagram" },
      { kind: "text", text: " or " },
      { kind: "image", text: "" },
    ]);
    expect(parseSpans("`<img alt='x' src=y>`")).toEqual([
      { kind: "code", text: "<img alt='x' src=y>" },
    ]);
    expect(parseSpans("<img alt='single' src=y>")).toEqual([{ kind: "image", text: "single" }]);
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
  it("reads the severity, then the blocks", () => {
    expect(parseBody("**major:** Use `const`\n```suggestion\nconst a = 1;\n```")).toEqual({
      severity: "major",
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

  it("finds no suggestion when there are two", () => {
    expect(suggestionOf("```suggestion\na\n```\n```suggestion\nb\n```")).toBeNull();
    expect(suggestionOf("no suggestion")).toBeNull();
  });
});

describe("composeBody", () => {
  it("writes what parseBody reads back", () => {
    const body = composeBody({
      body: " Use const ",
      severity: "minor",
      suggestion: ["const a = 1;"],
    });
    expect(body).toBe("**minor:** Use const\n\n```suggestion\nconst a = 1;\n```");
    expect(parseBody(body).severity).toBe("minor");
    expect(suggestionOf(body)).toEqual(["const a = 1;"]);
  });

  it("writes a suggestion alone, and a severity alone", () => {
    expect(composeBody({ body: "", suggestion: [] })).toBe("```suggestion\n```");
    expect(composeBody({ body: "", severity: "major" })).toBe("**major:**");
    expect(composeBody({ body: "plain", severity: null, suggestion: null })).toBe("plain");
  });

  it("fences a suggestion that holds fences with more backticks", () => {
    const lines = ["```ts", "x", "````"];
    const body = composeBody({ body: "", suggestion: lines });
    expect(body.startsWith("`````suggestion\n")).toBe(true);
    expect(suggestionOf(body)).toEqual(lines);
  });
});

describe("applyEdits", () => {
  it("replaces lines from the last edit up, keeping the final newline", () => {
    const result = applyEdits("a\nb\nc\nd\n", [
      { start: 1, end: 1, lines: ["A", "A2"] },
      { start: 3, end: 4, lines: ["CD"] },
    ]);
    expect(result).toEqual({ ok: true, value: "A\nA2\nb\nCD\n" });
  });

  it("deletes lines with an empty edit and keeps CRLF and a missing final newline", () => {
    expect(applyEdits("a\r\nb\r\nc", [{ start: 2, end: 2, lines: [] }])).toEqual({
      ok: true,
      value: "a\r\nc",
    });
    expect(applyEdits("a\n", [{ start: 1, end: 1, lines: [] }])).toEqual({ ok: true, value: "" });
  });

  it("refuses overlapping edits, naming the second", () => {
    expect(
      applyEdits("a\nb\nc\n", [
        { start: 1, end: 2, lines: ["x"] },
        { start: 3, end: 3, lines: ["y"] },
        { start: 2, end: 3, lines: ["z"] },
      ]),
    ).toEqual({ ok: false, error: { kind: "overlap", at: 2 } });
  });

  it("refuses lines the file doesn't have", () => {
    expect(applyEdits("a\n", [{ start: 2, end: 2, lines: [] }])).toEqual({
      ok: false,
      error: { kind: "out-of-range", at: 0 },
    });
    expect(applyEdits("a\nb\n", [{ start: 2, end: 1, lines: [] }])).toEqual({
      ok: false,
      error: { kind: "out-of-range", at: 0 },
    });
  });

  it("tells overlapping ranges from touching ones", () => {
    expect(editsOverlap({ start: 1, end: 3 }, { start: 3, end: 5 })).toBe(true);
    expect(editsOverlap({ start: 1, end: 2 }, { start: 3, end: 5 })).toBe(false);
  });
});

describe("threadLines", () => {
  it("gives a thread's range, its line alone, or nothing", () => {
    expect(threadLines({ line: 7, startLine: 5 })).toEqual({ start: 5, end: 7 });
    expect(threadLines({ line: 7, startLine: null })).toEqual({ start: 7, end: 7 });
    expect(threadLines({ line: null, startLine: 3 })).toBeNull();
  });
});
