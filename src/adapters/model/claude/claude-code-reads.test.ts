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
    expect(parseReads(recordedLines("reads"), "/work", READABLE)).toEqual([
      { path: "harness/CLAUDE.md", ...whole },
      { path: "harness/docs/rules.md", fromLine: 3, toLine: 5, outcome: "read" },
      // The directory's search showed a line of each of these.
      { path: "harness/docs/rules.md", ...whole },
      { path: "harness/docs/plan.md", ...whole },
      { path: "harness/docs/plan.md", ...whole },
      // A search that only names files is of the directory.
      { path: "harness", ...whole },
      { path: "harness/none.md", ...whole, outcome: "refused" },
    ]);
  });

  it("reads what a recorded call was refused", () => {
    expect(parseReads(recordedLines("read-outside"), "/work", READABLE)).toEqual([
      { path: "harness/docs/plan.md", ...whole },
      { path: "/outside/canary.md", ...whole, outcome: "refused" },
      { path: "/parent/system.txt", ...whole, outcome: "refused" },
    ]);
  });

  it("takes a use without a result as refused, and one that names no path as none", () => {
    expect(
      parseReads(
        [using("Read", { file_path: "harness/CLAUDE.md" }), using("Read", {}), "not json", "{}"],
        "/work",
        READABLE,
      ),
    ).toEqual([{ path: "harness/CLAUDE.md", ...whole, outcome: "refused" }]);
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
