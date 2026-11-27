import { describe, expect, it } from "vitest";
import { parseGitattributes } from "../diff/index.ts";
import {
  BlobHash,
  followsLink,
  GUIDELINE_PATHS,
  Harness,
  type HarnessFile,
  type HarnessLinkKind,
  harnessCopy,
  harnessEnabled,
  harnessLinks,
  harnessOutline,
  harnessPlan,
  harnessReach,
  isNeverRules,
  MAX_COPY_LINE,
  MAX_INLINE_BYTES,
  strongerLink,
} from "./index.ts";

/**
 * Each link as "kind path", or "kind path | path" when its path in prose can mean two files, a
 * folder's paths ending in a slash.
 */
const links = (path: string, content: string): string[] =>
  harnessLinks(path, content).map(
    ({ kind, paths, folder }) =>
      `${kind} ${paths.map((one) => (folder ? `${one}/` : one)).join(" | ")}`,
  );

describe("harnessLinks", () => {
  it.each([
    ["alone on its line", "@MISSION.md\n@DESIGN.md", ["import MISSION.md", "import DESIGN.md"]],
    ["in a list", "- @docs/rules.md", ["import docs/rules.md"]],
    ["inside a sentence", "See @docs/rules.md, and follow it.", ["import docs/rules.md"]],
    ["with ./", "@./docs/rules.md", ["import docs/rules.md"]],
    ["with an escaped space", "@docs/house\\ rules.md", ["import docs/house rules.md"]],
    ["with an anchor", "@docs/rules.md#naming", ["import docs/rules.md"]],
    [
      "of every extension",
      "@a.md @b.mdc @c.markdown @d.txt",
      ["import a.md", "import b.mdc", "import c.markdown", "import d.txt"],
    ],
    ["of an upper-case extension", "@README.MD", ["import README.MD"]],
  ])("reads an import %s", (_name, content, expected) => {
    expect(links("CLAUDE.md", content)).toEqual(expected);
  });

  it("resolves an import against its file only", () => {
    expect(links("docs/rules.md", "@style.md @../TEAM.md")).toEqual([
      "import docs/style.md",
      "import TEAM.md",
    ]);
  });

  it("reads an @ inside a word or after a bracket as a path in prose, not an import", () => {
    expect(links("CLAUDE.md", "(@docs/rules.md)")).toEqual(["mention docs/rules.md"]);
  });

  it.each([
    ["inline", "[Rules](docs/rules.md)", ["link docs/rules.md"]],
    ["with a title", '[Rules](docs/rules.md "The rules")', ["link docs/rules.md"]],
    ["in angle brackets", "[Rules](<docs/house rules.md>)", ["link docs/house rules.md"]],
    ["percent-encoded", "[Rules](docs/house%20rules.md)", ["link docs/house rules.md"]],
    ["wrongly percent-encoded", "[Rules](docs/100%.md)", ["link docs/100%.md"]],
    ["with an anchor and a query", "[Rules](docs/rules.md?plain=1#naming)", ["link docs/rules.md"]],
    ["with a leading slash, from the root", "[Rules](/docs/rules.md)", ["link docs/rules.md"]],
    ["by reference", "[Rules][r]\n\n[r]: docs/rules.md 'Rules'", ["link docs/rules.md"]],
    ["by reference in angle brackets", "[r]: <docs/house rules.md>", ["link docs/house rules.md"]],
    ["with code in its label", "[`rules`](docs/rules.md)", ["link docs/rules.md"]],
    ["with an image in its label", "[![b](b.png)](docs/rules.md)", ["link docs/rules.md"]],
  ])("reads a Markdown link %s", (_name, content, expected) => {
    expect(links("CLAUDE.md", content)).toEqual(expected);
  });

  it("resolves a Markdown link against its file only, and one with a leading slash against the root", () => {
    expect(
      links("docs/plan/README.md", "[a](65.md) [b](../notes.md) [c](../../TEAM.md) [d](/ROOT.md)"),
    ).toEqual(["link docs/plan/65.md", "link docs/notes.md", "link TEAM.md", "link ROOT.md"]);
  });

  it("doesn't read a link's label as a path of its own", () => {
    expect(links("docs/a.md", "[TEAM.md](../TEAM.md) [b.md](https://example.com/b.md)")).toEqual([
      "link TEAM.md",
    ]);
  });

  it("reads a path in prose, against its file first and then the root", () => {
    expect(links("CLAUDE.md", "The plan is in docs/plan/README.md.")).toEqual([
      "mention docs/plan/README.md",
    ]);
    expect(links("docs/notes.md", "The plan is in docs/plan/README.md.")).toEqual([
      "mention docs/docs/plan/README.md | docs/plan/README.md",
    ]);
    expect(links("docs/notes.md", "Read ../TEAM.md first.")).toEqual(["mention TEAM.md"]);
  });

  it.each([
    ["in bold", "**TEAM.md**", ["mention TEAM.md"]],
    ["in quotes and brackets", '("TEAM.md") <docs/a.md>', ["mention TEAM.md", "mention docs/a.md"]],
    ["with a line number", "docs/a.md:12", ["mention docs/a.md"]],
    ["with an anchor", "docs/a.md#naming", ["mention docs/a.md"]],
    ["with an escaped underscore", "docs/house\\_rules.md", ["mention docs/house_rules.md"]],
    ["in a table", "| a | docs/a.md |", ["mention docs/a.md"]],
  ])("reads a path in prose %s", (_name, content, expected) => {
    expect(links("CLAUDE.md", content)).toEqual(expected);
  });

  it.each([
    ["a code span with more than a path", "Run `pnpm a.md`, `docs/a.md:12` or ``c.md ` d.md``."],
    ["a code span over two lines", "`docs/a.md\n@b.md`"],
    ["a backtick fence", "```md\n@a.md\n[b](b.md) c.md\n```"],
    ["a tilde fence", "~~~\n@a.md\n~~~"],
    ["a fence in a list", "- ```\n  @a.md\n  ```"],
    ["a fence in a quote", "> ```\n> @a.md\n> ```"],
    ["a fence a shorter one doesn't close", "````\n```\n@a.md\n````"],
    ["a fence that never closes", "```\n@a.md\n\nb.md"],
    ["a URL", "https://example.com/docs/a.md and <http://example.com/b.md> www.example.com/c.md"],
    ["a link to a URL", "[a](https://example.com/a.md) [b](//example.com/b.md) [c](mailto:c.md)"],
    ["a path under ~", "@~/.claude/a.md [b](~/b.md) ~/c.md"],
    ["an absolute path", "@/etc/a.md /etc/b.md $HOME/c.md"],
    ["a path out of the repository", "@../a.md [b](../../b.md) ../c.md docs/../../d.md"],
    ["another kind of file", "@src/a.ts [b](b.png) package.json"],
    ["a file with only an extension", "docs/*.md and .md"],
    ["an anchor of its own", "[a](#naming)"],
    ["a path with a control character", "[a](a%00b.md) [b](a%0Ab.md)"],
    ["a path of more than 500 characters", `${"a/".repeat(260)}b.md`],
  ])("reads no link in %s", (_name, content) => {
    expect(links("CLAUDE.md", content)).toEqual([]);
  });

  it("reads a code span that holds a path and nothing else as a path in prose", () => {
    expect(links("docs/notes.md", "Follow `rules.md`, `@style.md.` and `plan/`.")).toEqual([
      "mention docs/rules.md | rules.md",
      "mention docs/style.md | style.md",
      "mention docs/plan/ | plan/",
    ]);
  });

  it.each([
    [
      "a Markdown link, with a slash or none",
      "[Plan](docs/plan) [Rules](/docs/rules/)",
      ["link docs/plan/", "link docs/rules/"],
    ],
    [
      "an import ending in a slash",
      "@docs/rules/ @.cursor/rules/",
      ["import docs/rules/", "import .cursor/rules/"],
    ],
    [
      "a path in prose ending in a slash",
      "Rules are in docs/rules/, modules in com.oracle.svm.core/.",
      ["mention docs/rules/", "mention com.oracle.svm.core/"],
    ],
    [
      "a code span ending in a slash",
      "Documentation lives under `docs/`, beside `compiler/` and `.ci/docker/`.",
      ["mention docs/", "mention compiler/", "mention .ci/docker/"],
    ],
  ])("reads a folder named in %s", (_name, content, expected) => {
    expect(links("CLAUDE.md", content)).toEqual(expected);
  });

  it("resolves a folder as a file: a link against its file, a path in prose then against the root", () => {
    expect(links("docs/notes.md", "[here](./) [plan](plan) and plan/ [up](../)")).toEqual([
      "link docs/",
      "link docs/plan/",
      "mention docs/plan/ | plan/",
    ]);
  });

  it.each([
    ["an import without a slash at its end", "Ask @someone, or install @anthropic-ai/sdk."],
    ["a path in prose without one", "The plan is in docs/plan, before/after and I/O."],
    ["a code span without one", "Run `docs/plan` or `claude/stage-51`."],
    ["a pattern", "docs/*.md and src/**/*.ts"],
    ["the repository's root", "[home](/) [here](./) [up](docs/..) `./`"],
    ["a file of another kind", "src/index.ts and [b](b.png)"],
  ])("reads no folder in %s", (_name, content) => {
    expect(links("CLAUDE.md", content)).toEqual([]);
  });

  it("reads what's after a fence or a span that did close, and text an open backtick doesn't cover", () => {
    expect(links("CLAUDE.md", "```\n@a.md\n```\n@b.md")).toEqual(["import b.md"]);
    expect(links("CLAUDE.md", "```inline``` @a.md")).toEqual(["import a.md"]);
    expect(links("CLAUDE.md", "An ` open one, a.md\n\nb.md `")).toEqual([
      "mention a.md",
      "mention b.md",
    ]);
    expect(links("CLAUDE.md", "```\r\n@a.md\r\n```\r\n@b.md\r\n")).toEqual(["import b.md"]);
  });

  it("never links a file to itself, however it's named", () => {
    expect(links("docs/a.md", "@a.md [a](a.md#top) a.md docs/a.md @b.md")).toEqual([
      "mention docs/docs/a.md",
      "import docs/b.md",
    ]);
  });

  it("gives each file once, where it's first linked by its strongest kind", () => {
    expect(
      links(
        "CLAUDE.md",
        "Follow a.md. [b](b.md)\n\n@b.md\n@c.md\n[a](a.md) and [a](a.md#two) c.md",
      ),
    ).toEqual(["import b.md", "import c.md", "link a.md"]);
  });

  it("stays quick on a megabyte of brackets, backticks, dots or spaces", () => {
    for (const unit of ["[", "](", "`", "`a ``b ", "a.", "# ", " @", ">", "`a` ", "~", "\n", " "]) {
      const content = unit.repeat(Math.floor(1_000_000 / unit.length));
      harnessLinks("CLAUDE.md", content);
      harnessOutline(content);
    }
  }, 20_000);
});

describe("isNeverRules", () => {
  const none = () => null;

  it.each([
    "src/adapters/github/fixtures/PROVENANCE.md",
    "test/__fixtures__/rules.md",
    "web/__snapshots__/page.md",
    "pkg/testdata/AGENTS.md",
    "go/test-data/a.md",
    "py/test_data/a.md",
    "vendor/lib/README.md",
    "third_party/x/CONTRIBUTING.md",
    "Third-Party/x/a.md",
    "node_modules/pkg/README.md",
    "LICENSES/MIT.md",
    "LICENSE.md",
    "licence.md",
    "LICENSE-APACHE.md",
    "NOTICE.md",
    "COPYING.md",
    "docs/PROVENANCE.md",
    "CHANGELOG.md",
    "changelog-2026.md",
  ])("is %s", (path) => {
    expect(isNeverRules(path, none)).toBe(true);
  });

  it.each([
    "docs/rules.md",
    "test/README.md",
    "spec/review.md",
    "docs/licensing.md",
    "docs/notices-for-reviewers.md",
    "docs/vendoring.md",
    "fixtures.md",
    "docs/changelog-policy/rules.md",
  ])("isn't %s", (path) => {
    expect(isNeverRules(path, none)).toBe(false);
  });

  it("is what .gitattributes marks generated or vendored, and nothing it unsets", () => {
    const attributeFor = parseGitattributes(
      "evals/cases/*/files/** linguist-vendored\ndocs/api/*.md linguist-generated\ndocs/api/keep.md -linguist-generated\n",
    );
    expect(isNeverRules("evals/cases/a/files/CONTRIBUTING.md", attributeFor)).toBe(true);
    expect(isNeverRules("docs/api/routes.md", attributeFor)).toBe(true);
    expect(isNeverRules("docs/api/keep.md", attributeFor)).toBe(false);
    expect(isNeverRules("evals/cases/a/labels.md", attributeFor)).toBe(false);
  });
});

describe("followsLink", () => {
  const none = () => null;

  it("follows an import anywhere, a .txt and a fixture too", () => {
    expect(followsLink("notes.txt", "import", none)).toBe(true);
    expect(followsLink("test/fixtures/rules.md", "import", none)).toBe(true);
  });

  it.each(["link", "mention"] as const)("follows a %s to rules only, never to a .txt", (kind) => {
    expect(followsLink("docs/rules.md", kind, none)).toBe(true);
    expect(followsLink("docs/RULES.TXT", kind, none)).toBe(false);
    expect(followsLink("licenses/tree-sitter-go.txt", kind, none)).toBe(false);
    expect(followsLink("src/fixtures/PROVENANCE.md", kind, none)).toBe(false);
  });
});

describe("strongerLink", () => {
  it("ranks an import over a link over a mention", () => {
    expect(strongerLink("mention", "import")).toBe("import");
    expect(strongerLink("link", "mention")).toBe("link");
    expect(strongerLink("link", "link")).toBe("link");
  });
});

describe("harnessOutline", () => {
  it("lists headings with their levels and lines", () => {
    const content = "# One\n\nText\n\n## Two ##\n### C#\n#Not one\n####### Nor this\n";
    expect(harnessOutline(content)).toEqual({
      headings: [
        { level: 1, text: "One", line: 1 },
        { level: 2, text: "Two", line: 5 },
        { level: 3, text: "C#", line: 6 },
      ],
      lines: 8,
    });
  });

  it("lists underlined headings, and takes a rule under a list, a quote or a paragraph for a rule", () => {
    const content = [
      "One",
      "===",
      "",
      "Two",
      "---",
      "",
      "- item",
      "---",
      "",
      "1. item",
      "---",
      "",
      "> quote",
      "---",
      "",
      "Two lines",
      "of text",
      "---",
      "",
      "---",
    ].join("\n");
    expect(harnessOutline(content)).toEqual({
      headings: [
        { level: 1, text: "One", line: 1 },
        { level: 2, text: "Two", line: 4 },
      ],
      lines: 20,
    });
  });

  it("skips fences and front matter, and empty headings", () => {
    const content = "---\nname: x\n---\n# One\n```sh\n# not a heading\n```\n#\n## ##\n";
    expect(harnessOutline(content).headings).toEqual([{ level: 1, text: "One", line: 4 }]);
  });

  it("counts lines with and without a last newline, in either line ending", () => {
    expect(harnessOutline("")).toEqual({ headings: [], lines: 0 });
    expect(harnessOutline("a").lines).toBe(1);
    expect(harnessOutline("a\n").lines).toBe(1);
    expect(harnessOutline("a\n\n").lines).toBe(2);
    expect(harnessOutline("# One\r\nText\r\n")).toEqual({
      headings: [{ level: 1, text: "One", line: 1 }],
      lines: 2,
    });
  });
});

describe("harnessCopy", () => {
  it("is the file itself when no line is too long", () => {
    const content = `# One\r\n\n${"x".repeat(MAX_COPY_LINE)}\nlast`;
    const copy = harnessCopy(content);
    expect(copy.content).toBe(content);
    expect(copy.lines).toBe(4);
    expect([1, 3, 4].map(copy.lineOf)).toEqual([1, 3, 4]);
  });

  it("wraps a long line at spaces, and loses nothing but the space it's cut at", () => {
    const words = Array.from({ length: 900 }, (_, index) => `word${index}`).join(" ");
    const copy = harnessCopy(`# One\n\n${words}\n\n## Two\n`);
    const lines = copy.content.split("\n");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(MAX_COPY_LINE);
    expect(lines.slice(2, copy.lineOf(4) - 1).join(" ")).toBe(words);
    expect(lines[copy.lineOf(5) - 1]).toBe("## Two");
    expect(copy.lines).toBe(lines.length - 1);
  });

  it("keeps every space but the one it's cut at", () => {
    const line = `${"a ".repeat(499)}bb    ${"c".repeat(10)}`;
    expect(harnessCopy(line).content.replaceAll("\n", " ")).toBe(line);
  });

  it("cuts a line without a space where it must, never in the middle of a character", () => {
    const line = `x${"😀".repeat(1500)}`;
    const copy = harnessCopy(line);
    expect(copy.content.replaceAll("\n", "")).toBe(line);
    expect(copy.content).not.toMatch(/[\uD800-\uDBFF]\n/);
    expect(Math.max(...copy.content.split("\n").map((one) => one.length))).toBeLessThanOrEqual(
      MAX_COPY_LINE,
    );
  });

  it("puts a heading on the copy's line, whatever came before it was wrapped into", () => {
    const content = `${"intro ".repeat(700)}\n# One\n${"text # not a heading ".repeat(200)}\n## Two\n`;
    const copy = harnessCopy(content);
    const lines = copy.content.split("\n");
    for (const { level, text, line } of harnessOutline(content).headings) {
      expect(lines[copy.lineOf(line) - 1]).toBe(`${"#".repeat(level)} ${text}`);
    }
  });
});

type Link = readonly [path: string, kind: HarnessLinkKind];

const file = (path: string, fileLinks: readonly Link[] = [], bytes = 100): HarnessFile => ({
  path,
  blob: BlobHash.parse("a".repeat(40)),
  bytes,
  lines: 1,
  via: GUIDELINE_PATHS.some((root) => root === path) ? "root" : "link",
  linkedFrom: null,
  headings: [],
  links: fileLinks.map(([linked, kind]) => ({ path: linked, kind })),
});

const harness = (...files: HarnessFile[]): Harness =>
  Harness.parse({ baseSha: "b".repeat(40), files, cut: null, skipped: [], missing: [] });

const on = (...paths: string[]) => new Map(paths.map((path) => [path, true] as const));
const off = (...paths: string[]) => new Map(paths.map((path) => [path, false] as const));
const paths = (files: readonly HarnessFile[]) => files.map(({ path }) => path);

describe("harnessEnabled", () => {
  const linked = harness(
    file("REVIEW.md", [["docs/rules.md", "link"]]),
    file("CONTRIBUTING.md", [
      ["docs/a.md", "import"],
      ["docs/rules.md", "mention"],
    ]),
    file("docs/rules.md", [["docs/deep.md", "link"]]),
    file("docs/a.md", [["docs/b.md", "link"]]),
    file("docs/deep.md"),
    file("docs/b.md", [["docs/a.md", "link"]]),
  );
  const enabled = (switches: ReadonlyMap<string, boolean>) =>
    paths(linked.files).filter((path) => harnessEnabled(path, linked, switches));

  it("switches a root by its own switch, the review's and the agents' on unless off", () => {
    expect(enabled(new Map())).toEqual(["REVIEW.md", "docs/rules.md", "docs/deep.md"]);
    expect(enabled(off("REVIEW.md"))).toEqual([]);
    const agents = harness(file("AGENTS.md"), file("CLAUDE.md"));
    expect(paths(agents.files).filter((path) => harnessEnabled(path, agents, new Map()))).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    expect(harnessEnabled("CLAUDE.md", agents, off("CLAUDE.md"))).toBe(false);
  });

  it("has every file an enabled root reaches, round a cycle too", () => {
    expect(enabled(on("CONTRIBUTING.md"))).toEqual(paths(linked.files));
  });

  it("reaches a file through whichever root is on", () => {
    expect(enabled(new Map([...on("CONTRIBUTING.md"), ...off("REVIEW.md")]))).toEqual(
      paths(linked.files).filter((path) => path !== "REVIEW.md"),
    );
  });

  it("leaves out a file switched off, and what only it reaches", () => {
    expect(enabled(new Map([...on("CONTRIBUTING.md"), ...off("docs/a.md")]))).toEqual([
      "REVIEW.md",
      "CONTRIBUTING.md",
      "docs/rules.md",
      "docs/deep.md",
    ]);
  });

  it("doesn't reach a file by its own switch alone, or a file the harness doesn't have", () => {
    expect(harnessEnabled("docs/a.md", linked, on("docs/a.md"))).toBe(false);
    expect(harnessEnabled("docs/none.md", linked, on("docs/none.md"))).toBe(false);
  });

  describe("a root another root names", () => {
    // Both off unless switched on.
    const COPILOT = ".github/copilot-instructions.md";
    const naming = (kind: HarnessLinkKind) =>
      harness(
        file("CONTRIBUTING.md", [["docs/a.md", "import"]]),
        file(COPILOT, [["CONTRIBUTING.md", kind]]),
        file("docs/a.md"),
      );
    const used = (files: Harness, switches: ReadonlyMap<string, boolean>) =>
      paths(files.files).filter((path) => harnessEnabled(path, files, switches));

    it("is on with a root that's on and imports it, and so is what it imports", () => {
      expect(used(naming("import"), on(COPILOT))).toEqual([
        "CONTRIBUTING.md",
        COPILOT,
        "docs/a.md",
      ]);
      expect(used(naming("import"), new Map())).toEqual([]);
    });

    it("is off when it's switched off, and nothing is reached through it", () => {
      const switches = new Map([...on(COPILOT), ...off("CONTRIBUTING.md")]);
      expect(used(naming("import"), switches)).toEqual([COPILOT]);
    });

    it.each(["link", "mention"] as const)("keeps its own default when it's only a %s", (kind) => {
      expect(used(naming(kind), on(COPILOT))).toEqual([COPILOT]);
      expect(used(naming(kind), on(COPILOT, "CONTRIBUTING.md"))).toEqual([
        "CONTRIBUTING.md",
        COPILOT,
        "docs/a.md",
      ]);
    });

    const through = (first: HarnessLinkKind, second: HarnessLinkKind) =>
      harness(
        file("CONTRIBUTING.md", [["docs/a.md", "link"]]),
        file(COPILOT, [["docs/all.md", first]]),
        file("docs/all.md", [["CONTRIBUTING.md", second]]),
        file("docs/a.md"),
      );

    it("is on through a chain of imports, whatever files are in it", () => {
      const all = ["CONTRIBUTING.md", COPILOT, "docs/all.md", "docs/a.md"];
      expect(used(through("import", "import"), on(COPILOT))).toEqual(all);
      expect(used(through("import", "import"), new Map())).toEqual([]);
    });

    it.each([
      ["link", "import"],
      ["mention", "import"],
      ["import", "link"],
      ["import", "mention"],
    ] as const)("keeps its own default through a chain of a %s and a %s", (first, second) => {
      expect(used(through(first, second), on(COPILOT))).toEqual([COPILOT, "docs/all.md"]);
    });

    it("is off through a chain with a file that's off, and when it's off itself", () => {
      const chain = through("import", "import");
      expect(used(chain, new Map([...on(COPILOT), ...off("docs/all.md")]))).toEqual([COPILOT]);
      expect(used(chain, new Map([...on(COPILOT), ...off("CONTRIBUTING.md")]))).toEqual([
        COPILOT,
        "docs/all.md",
      ]);
    });

    it("is on through a root that's on only by an import itself", () => {
      const chain = harness(
        file("AGENTS.md", [["CONTRIBUTING.md", "import"]]),
        file("CLAUDE.md", [["AGENTS.md", "import"]]),
        file("CONTRIBUTING.md"),
      );
      expect(used(chain, on("CLAUDE.md"))).toEqual(["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"]);
    });
  });
});

describe("harnessReach", () => {
  it("lists what a file reaches, nearest first, without itself and whatever is switched on", () => {
    const linked = harness(
      file("CLAUDE.md", [
        ["a.md", "mention"],
        ["b.md", "import"],
      ]),
      file("a.md", [
        ["c.md", "link"],
        ["CLAUDE.md", "link"],
      ]),
      file("b.md"),
      file("c.md"),
      file("alone.md"),
    );
    expect(paths(harnessReach(linked, "CLAUDE.md"))).toEqual(["a.md", "b.md", "c.md"]);
    expect(harnessReach(linked, "none.md")).toEqual([]);
  });
});

describe("harnessPlan", () => {
  const plan = (files: Harness, switches: ReadonlyMap<string, boolean>) => {
    const { inPrompt, onRequest, passedOver } = harnessPlan(files, switches);
    return {
      inPrompt: paths(inPrompt),
      onRequest: paths(onRequest),
      passedOver: paths(passedOver),
    };
  };

  it("puts the enabled roots and then their imports in the prompt, breadth-first as written", () => {
    const imports = harness(
      file("REVIEW.md", [["r.md", "import"]]),
      file("CONTRIBUTING.md", [
        ["see-also.md", "link"],
        ["a.md", "import"],
        ["b.md", "import"],
      ]),
      file("r.md"),
      file("see-also.md", [["from-link.md", "import"]]),
      file("a.md", [["deep.md", "import"]]),
      file("b.md", [["mentioned.md", "mention"]]),
      file("from-link.md"),
      file("deep.md"),
      file("mentioned.md"),
    );
    expect(plan(imports, on("CONTRIBUTING.md"))).toEqual({
      inPrompt: ["REVIEW.md", "CONTRIBUTING.md", "r.md", "a.md", "b.md", "deep.md"],
      onRequest: ["see-also.md", "from-link.md", "mentioned.md"],
      passedOver: [],
    });
    expect(plan(imports, new Map())).toEqual({
      inPrompt: ["REVIEW.md", "r.md"],
      onRequest: [],
      passedOver: [],
    });
  });

  it("passes over a file that doesn't fit, and takes a smaller one after it and what it imports", () => {
    const large = harness(
      file(
        "CLAUDE.md",
        [
          ["large.md", "import"],
          ["fits.md", "import"],
        ],
        1000,
      ),
      file("large.md", [["small.md", "import"]], MAX_INLINE_BYTES),
      file("fits.md", [], MAX_INLINE_BYTES - 1000 - 50),
      file("small.md", [], 50),
    );
    expect(plan(large, on("CLAUDE.md"))).toEqual({
      inPrompt: ["CLAUDE.md", "fits.md", "small.md"],
      onRequest: ["large.md"],
      passedOver: ["large.md"],
    });
  });

  it("leaves a root too large for the prompt to be read on request, with its imports in the prompt", () => {
    const large = harness(
      file("CLAUDE.md", [["a.md", "import"]], MAX_INLINE_BYTES + 1),
      file("a.md"),
    );
    expect(plan(large, on("CLAUDE.md"))).toEqual({
      inPrompt: ["a.md"],
      onRequest: ["CLAUDE.md"],
      passedOver: ["CLAUDE.md"],
    });
  });

  it("puts a root that's on by its importer in the prompt, after the roots that are on", () => {
    const only = harness(
      file("REVIEW.md", [["CONTRIBUTING.md", "link"]]),
      file("CONTRIBUTING.md", [["docs/a.md", "import"]]),
      file("CLAUDE.md", [["CONTRIBUTING.md", "import"]]),
      file("docs/a.md"),
    );
    expect(plan(only, on("CLAUDE.md"))).toEqual({
      inPrompt: ["REVIEW.md", "CLAUDE.md", "CONTRIBUTING.md", "docs/a.md"],
      onRequest: [],
      passedOver: [],
    });
    expect(plan(only, new Map([...on("CLAUDE.md"), ...off("CONTRIBUTING.md")]))).toEqual({
      inPrompt: ["REVIEW.md", "CLAUDE.md"],
      onRequest: [],
      passedOver: [],
    });
  });

  it("gives a file off, or behind one that's off, to neither list", () => {
    const behind = harness(
      file("CLAUDE.md", [["a.md", "import"]]),
      file("a.md", [["b.md", "import"]]),
      file("b.md"),
    );
    expect(plan(behind, new Map([...on("CLAUDE.md"), ...off("a.md")]))).toEqual({
      inPrompt: ["CLAUDE.md"],
      onRequest: [],
      passedOver: [],
    });
  });
});
