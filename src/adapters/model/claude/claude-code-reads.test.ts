import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseReads, readOutside } from "./claude-code-reads.ts";
import { recordedLines } from "./fixtures/fake-run-claude.ts";

const READABLE = new Set(["harness/CLAUDE.md", "harness/docs/rules.md", "harness/docs/plan.md"]);

const using = (name: string, input: unknown, id = "t1"): string =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });

const whole = { fromLine: null, toLine: null, outcome: "read" };

describe("parseReads", () => {
  it("reads a recorded call: whole files, lines, searches that show lines, and what failed", () => {
    const cents = (round: number, chars: number) => ({
      round,
      tool: "search",
      search: { pattern: "cents", path: "harness" },
      chars,
    });
    expect(parseReads(recordedLines("reads"), "/work", READABLE)).toEqual([
      { path: "harness/CLAUDE.md", ...whole, round: 1, tool: "read", chars: 31 },
      {
        path: "harness/docs/rules.md",
        fromLine: 3,
        toLine: 5,
        outcome: "read",
        round: 2,
        tool: "read",
        chars: 38,
      },
      // The directory's search showed a line of each of these.
      { path: "harness/docs/rules.md", ...whole, ...cents(3, 80) },
      { path: "harness/docs/plan.md", ...whole, ...cents(3, 80) },
      {
        path: "harness/docs/plan.md",
        ...whole,
        round: 4,
        tool: "search",
        search: { pattern: "Money", path: "harness/docs/plan.md" },
        chars: 23,
      },
      // A search that only names files is of the directory.
      { path: "harness", ...whole, ...cents(5, 56) },
      {
        path: "harness/none.md",
        ...whole,
        outcome: "refused",
        round: 6,
        tool: "read",
        reason: "File does not exist. Note: your current working directory is /work.",
      },
    ]);
  });

  it("reads what a recorded call was refused, and what Claude Code told it", () => {
    const outside = (path: string, round: number) => ({
      path,
      ...whole,
      outcome: "refused",
      round,
      tool: "read",
      reason: `${path} is outside /work; --restricted confines the file tools to the working directory.`,
    });
    expect(parseReads(recordedLines("read-outside"), "/work", READABLE)).toEqual([
      { path: "harness/docs/plan.md", ...whole, round: 1, tool: "read", chars: 38 },
      outside("/outside/canary.md", 2),
      outside("/parent/system.txt", 3),
    ]);
  });

  it("takes a use without a result as refused, and one that names no path as none", () => {
    expect(
      parseReads(
        [using("Read", { file_path: "harness/CLAUDE.md" }), using("Read", {}), "not json", "{}"],
        "/work",
        READABLE,
      ),
    ).toEqual([
      {
        path: "harness/CLAUDE.md",
        ...whole,
        outcome: "refused",
        round: 1,
        tool: "read",
        reason: "It had no answer: the pass was stopped.",
      },
    ]);
  });

  it("counts uses sent together, before their answers, as one round", () => {
    const answer = (...ids: string[]) =>
      JSON.stringify({
        type: "user",
        message: {
          content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "x" })),
        },
      });
    const rounds = parseReads(
      [
        using("Read", { file_path: "harness/CLAUDE.md" }, "a"),
        using("Read", { file_path: "harness/docs/rules.md" }, "b"),
        answer("a", "b"),
        using("Read", { file_path: "harness/docs/plan.md" }, "c"),
        answer("c"),
      ],
      "/work",
      READABLE,
    ).map((read) => [read.path, read.round]);
    expect(rounds).toEqual([
      ["harness/CLAUDE.md", 1],
      ["harness/docs/rules.md", 1],
      ["harness/docs/plan.md", 2],
    ]);
  });

  it("says nothing of a search for names in one file, which shows none of it", () => {
    const result = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
      tool_use_result: { mode: "files_with_matches", filenames: ["harness/CLAUDE.md"] },
    });
    expect(
      parseReads([using("Grep", { path: "harness/CLAUDE.md" }), result], "/work", READABLE),
    ).toEqual([]);
  });
});

describe("readOutside", () => {
  const read = (path: string) => readOutside(using("Read", { file_path: path }), "/work");

  it.each(["harness/CLAUDE.md", "./harness/docs/../CLAUDE.md", "/work/harness/CLAUDE.md"])(
    "lets a read of %s through",
    (path) => {
      expect(read(path)).toBeNull();
    },
  );

  it.each([
    ["/etc/hosts", "/etc/hosts"],
    ["../system.txt", "/system.txt"],
    ["harness/../../x.md", "/x.md"],
    ["/workspace/x.md", "/workspace/x.md"],
    ["~/.ssh/id_ed25519", "~/.ssh/id_ed25519"],
    ["file:///etc/hosts", "file:///etc/hosts"],
  ])("stops a read of %s", (path, named) => {
    expect(read(path)).toBe(`it tried to read ${named}, which isn't one of the harness's files`);
  });

  it("stops a search outside, and lets one of the directory, its default, through", () => {
    const search = (input: object) =>
      readOutside(using("Grep", { pattern: "x", ...input }), "/work");
    expect(search({})).toBeNull();
    expect(search({ path: "harness" })).toBeNull();
    expect(search({ path: "/etc" })).toMatch(/tried to read/);
  });

  it("stops any tool but the reader's and the answer's", () => {
    expect(readOutside(using("Bash", { command: "ls" }), "/work")).toBe("it used Bash");
    expect(readOutside(using("StructuredOutput", { answer: "/etc/hosts" }), "/work")).toBeNull();
  });

  it("says nothing of a line that uses no tool, or a use that names no path", () => {
    expect(readOutside(JSON.stringify({ type: "assistant", message: {} }), "/work")).toBeNull();
    expect(readOutside(using("Read", {}), "/work")).toBeNull();
  });

  const root = realpathSync(mkdtempSync(join(tmpdir(), "megareviewer-reads-")));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("follows links: one that leads out is outside, and one to the directory is inside", () => {
    const work = join(root, "work");
    mkdirSync(join(work, "harness"), { recursive: true });
    writeFileSync(join(root, "canary.md"), "");
    writeFileSync(join(work, "harness", "a.md"), "");
    symlinkSync(join(root, "canary.md"), join(work, "harness", "link.md"));
    symlinkSync(work, join(root, "alias"));
    const named = (path: string) => readOutside(using("Read", { file_path: path }), work);
    expect(named("harness/link.md")).toMatch(/link\.md/);
    expect(named(join(root, "alias", "harness", "a.md"))).toBeNull();
  });
});
