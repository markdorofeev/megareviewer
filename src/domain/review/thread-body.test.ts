import { describe, expect, it } from "vitest";
import {
  composeBody,
  parseBlocks,
  parseBody,
  parseSpans,
  previewOf,
  suggestionOf,
} from "./thread-body.ts";

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

  it("reads a GitHub attachment alone on a line as a video, and as a link inside a sentence", () => {
    const asset = "https://github.com/user-attachments/assets/0f9a-12";
    expect(parseSpans(`Repro:\n${asset}\nafter`)).toEqual([
      { kind: "text", text: "Repro:\n" },
      { kind: "video", text: "", url: asset },
      { kind: "text", text: "\nafter" },
    ]);
    expect(parseSpans(`see ${asset} here`)).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", url: asset, spans: [{ kind: "text", text: asset }] },
      { kind: "text", text: " here" },
    ]);
  });

  it("keeps HTML as text, and gives a link no URL unless it's http(s)", () => {
    expect(parseSpans("<script>alert(1)</script> [x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "<script>alert(1)</script> " },
      { kind: "link", url: null, spans: [{ kind: "text", text: "x" }] },
    ]);
    expect(parseSpans("[a](data:text/html,x) [b](README.md) [c](HTTPS://Example.com/x)")).toEqual([
      { kind: "link", url: null, spans: [{ kind: "text", text: "a" }] },
      { kind: "text", text: " " },
      { kind: "link", url: null, spans: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "link", url: "https://example.com/x", spans: [{ kind: "text", text: "c" }] },
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

  it("reads a prefix like **major:** as bold text, not a severity", () => {
    expect(parseBody("**major:** Retries forever").blocks).toEqual([
      {
        kind: "paragraph",
        spans: [
          { kind: "strong", spans: [{ kind: "text", text: "major:" }] },
          { kind: "text", text: " Retries forever" },
        ],
      },
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

const text = (value: string) => ({ kind: "text", text: value }) as const;
const paragraph = (...spans: unknown[]) => ({ kind: "paragraph", spans });

describe("inline Markdown", () => {
  it("reads strong, emphasis and strikethrough, nested", () => {
    expect(parseSpans("**bold** *it* _it_ ***both*** ~~gone~~ **a *b* c**")).toEqual([
      { kind: "strong", spans: [text("bold")] },
      text(" "),
      { kind: "emphasis", spans: [text("it")] },
      text(" "),
      { kind: "emphasis", spans: [text("it")] },
      text(" "),
      { kind: "strong", spans: [{ kind: "emphasis", spans: [text("both")] }] },
      text(" "),
      { kind: "strike", spans: [text("gone")] },
      text(" "),
      {
        kind: "strong",
        spans: [text("a "), { kind: "emphasis", spans: [text("b")] }, text(" c")],
      },
    ]);
  });

  it("leaves markers that don't open or close as text", () => {
    expect(parseSpans("2 * 3 * 4, snake_case_name, **open, a*")).toEqual([
      text("2 * 3 * 4, snake_case_name, **open, a*"),
    ]);
    expect(parseSpans("`*not em*` *em `*` too*")).toEqual([
      { kind: "code", text: "*not em*" },
      text(" "),
      { kind: "emphasis", spans: [text("em "), { kind: "code", text: "*" }, text(" too")] },
    ]);
  });

  it("reads backslash escapes and entities outside code", () => {
    expect(parseSpans("AWS\\_KEY \\(maybe\\) \\*x\\* &lt;b&gt; &#65;&#x42; &#0; `a\\_b`")).toEqual([
      text("AWS_KEY (maybe) *x* <b> AB � "),
      { kind: "code", text: "a\\_b" },
    ]);
  });

  it("reads links with code and emphasis in their text, and autolinks", () => {
    expect(
      parseSpans('[the `retry` docs](https://example.com/a_(b) "title") and <https://x.test/?q=1>'),
    ).toEqual([
      {
        kind: "link",
        url: "https://example.com/a_(b)",
        spans: [text("the "), { kind: "code", text: "retry" }, text(" docs")],
      },
      text(" and "),
      { kind: "link", url: "https://x.test/?q=1", spans: [text("https://x.test/?q=1")] },
    ]);
  });

  it("reads escapes in a link's URL and an image's alt", () => {
    expect(
      parseSpans("[x](https://a.test/\\{y\\}_%7B) ![a\\_b &amp; c](https://e.test/i.png)"),
    ).toEqual([
      { kind: "link", url: "https://a.test/%7By%7D_%7B", spans: [text("x")] },
      text(" "),
      { kind: "image", text: "a_b & c", url: null },
    ]);
  });

  it("links a bare URL without the punctuation after it", () => {
    expect(parseSpans("See https://example.com/a?b=1. Or (https://example.com/c).")).toEqual([
      text("See "),
      {
        kind: "link",
        url: "https://example.com/a?b=1",
        spans: [text("https://example.com/a?b=1")],
      },
      text(". Or ("),
      { kind: "link", url: "https://example.com/c", spans: [text("https://example.com/c")] },
      text(")."),
    ]);
  });

  it("drops the attribute list Bitbucket's editor writes after a link card", () => {
    expect(
      parseSpans("doc [https://docs.test/a](https://docs.test/a){: data-inline-card='' } end"),
    ).toEqual([
      text("doc "),
      { kind: "link", url: "https://docs.test/a", spans: [text("https://docs.test/a")] },
      text(" end"),
    ]);
  });

  it("doesn't nest a link in a link", () => {
    expect(parseSpans("[a [b](https://b.test) c](https://a.test)")).toEqual([
      {
        kind: "link",
        url: "https://a.test/",
        spans: [text("a [b](https://b.test) c")],
      },
    ]);
  });

  it("stays fast on input built to backtrack", () => {
    const started = performance.now();
    parseSpans(
      `${"*a ".repeat(20_000)}${"[".repeat(20_000)}${"_b ".repeat(20_000)}${"`".repeat(5_000)} ${"``x".repeat(2_000)}`,
    );
    parseBlocks(`${"> ".repeat(5_000)}x\n${"- ".repeat(5_000)}y\n${"```a\n".repeat(5_000)}`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("stops nesting at a depth and reads the rest as text", () => {
    const quotes = parseBlocks(`${">".repeat(20)} deep`);
    let depth = 0;
    let block = quotes[0];
    while (block?.kind === "quote") {
      depth += 1;
      block = block.blocks[0];
    }
    expect(depth).toBe(8);
    expect(block?.kind).toBe("paragraph");
  });
});

describe("block Markdown", () => {
  it("reads headings, rules and quotes", () => {
    expect(parseBlocks("##### 🔥 Code Bugs  \n\n---\n> quoted **bold**\nlazy\n\n#tag")).toEqual([
      { kind: "heading", level: 5, spans: [text("🔥 Code Bugs")] },
      { kind: "rule" },
      {
        kind: "quote",
        blocks: [
          paragraph(text("quoted "), { kind: "strong", spans: [text("bold")] }, text("\nlazy")),
        ],
      },
      paragraph(text("#tag")),
    ]);
  });

  it("reads bulleted, ordered and task lists, nested, with code under an item", () => {
    const body = [
      "Try:",
      "* pass `EXTRA_ARGS`",
      "* pass the env:",
      "",
      "    ```yaml",
      "    a: 1",
      "    ```",
      "  - nested",
      "",
      "3. three",
      "4. four",
      "",
      "- [x] done",
      "- [ ] not yet",
    ].join("\n");
    expect(parseBlocks(body)).toEqual([
      paragraph(text("Try:")),
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          {
            checked: null,
            blocks: [paragraph(text("pass "), { kind: "code", text: "EXTRA_ARGS" })],
          },
          {
            checked: null,
            blocks: [
              paragraph(text("pass the env:")),
              { kind: "code", language: "yaml", text: "a: 1" },
              {
                kind: "list",
                ordered: false,
                start: 1,
                items: [{ checked: null, blocks: [paragraph(text("nested"))] }],
              },
            ],
          },
        ],
      },
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [
          { checked: null, blocks: [paragraph(text("three"))] },
          { checked: null, blocks: [paragraph(text("four"))] },
        ],
      },
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          { checked: true, blocks: [paragraph(text("done"))] },
          { checked: false, blocks: [paragraph(text("not yet"))] },
        ],
      },
    ]);
  });

  it("doesn't start a list mid-paragraph from a number other than 1", () => {
    expect(parseBlocks("Released in\n2019. Then:\n- a")).toEqual([
      paragraph(text("Released in\n2019. Then:")),
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [{ checked: null, blocks: [paragraph(text("a"))] }],
      },
    ]);
  });

  it("reads a table with its alignment, padding short rows", () => {
    expect(
      parseBlocks("| case | code |\n| :--- | ---: |\n| `a\\|b` | 201 |\n| only |\n\nafter"),
    ).toEqual([
      {
        kind: "table",
        align: ["left", "right"],
        head: [[text("case")], [text("code")]],
        rows: [
          [[{ kind: "code", text: "a\\|b" }], [text("201")]],
          [[text("only")], []],
        ],
      },
      paragraph(text("after")),
    ]);
  });

  it("reads a suggestion only at the top, never quoted or in a list", () => {
    expect(parseBlocks("> ```suggestion\n> x\n> ```")).toEqual([
      { kind: "quote", blocks: [{ kind: "code", language: null, text: "x" }] },
    ]);
    expect(suggestionOf("- ```suggestion\n  x\n  ```")).toBeNull();
  });

  it("keeps HTML blocks as text", () => {
    expect(parseBlocks("<details><summary>More</summary>\n\nhidden\n</details>")).toEqual([
      paragraph(text("<details><summary>More</summary>")),
      paragraph(text("hidden\n</details>")),
    ]);
  });

  it("treats a line of invisible characters as blank", () => {
    expect(parseBlocks("Big changes.\n\n‌")).toEqual([paragraph(text("Big changes."))]);
  });

  it("reads a real Bitbucket comment as Bitbucket shows it", () => {
    const body =
      "Thank you!  \nLooks like AWS\\_OIDC\\_ROLE\\_ARN isn’t passed, see the [README.md](http://README.md):\n\n* pass `EXTRA_ARGS`\n\nBest regards,  \nO.";
    expect(parseBlocks(body)).toEqual([
      paragraph(
        text("Thank you!\nLooks like AWS_OIDC_ROLE_ARN isn’t passed, see the "),
        { kind: "link", url: "http://readme.md/", spans: [text("README.md")] },
        text(":"),
      ),
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          {
            checked: null,
            blocks: [paragraph(text("pass "), { kind: "code", text: "EXTRA_ARGS" })],
          },
        ],
      },
      paragraph(text("Best regards,\nO.")),
    ]);
  });
});

describe("previewOf", () => {
  it("is the first line that reads as text, without markers", () => {
    expect(previewOf("\n## **Bug**: retries\nmore")).toBe("Bug: retries");
    expect(previewOf("> AWS\\_KEY is [set](https://a.test)")).toBe("AWS_KEY is set");
    expect(previewOf("```suggestion\nx\n```")).toBe("Suggested change");
    expect(previewOf("")).toBe("");
  });
});
