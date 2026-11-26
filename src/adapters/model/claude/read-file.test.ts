import { describe, expect, it } from "vitest";
import { READ_FILE, serveRead } from "./read-file.ts";

const RULES = "harness/docs/rules.md";
const files = new Map([
  [RULES, "# Rules\n\nOne.\nTwo.\n"],
  ["harness/docs/empty.md", ""],
]);

const use = (input: unknown, name = READ_FILE.name) =>
  serveRead({ id: "toolu_1", name, input }, files);

describe("serveRead", () => {
  it("gives a file whole, and records it without lines", () => {
    expect(use({ path: RULES })).toEqual({
      result: { type: "tool_result", tool_use_id: "toolu_1", content: "# Rules\n\nOne.\nTwo." },
      read: { path: RULES, fromLine: null, toLine: null, outcome: "read" },
    });
  });

  it.each([
    [{ first_line: 3, last_line: 4 }, "One.\nTwo.", 3, 4],
    [{ first_line: 3 }, "One.\nTwo.", 3, 4],
    [{ last_line: 1 }, "# Rules", 1, 1],
    [{ first_line: 4, last_line: 400 }, "Two.", 4, 4],
    [{ first_line: 1, last_line: 4 }, "# Rules\n\nOne.\nTwo.", null, null],
    [{ first_line: null, last_line: null }, "# Rules\n\nOne.\nTwo.", null, null],
  ])("gives the lines %j", (lines, content, fromLine, toLine) => {
    const { result, read } = use({ path: RULES, ...lines });
    expect(result.content).toBe(content);
    expect(read).toEqual({ path: RULES, fromLine, toLine, outcome: "read" });
  });

  it.each([
    { first_line: 5 },
    { first_line: 3, last_line: 2 },
    { first_line: 0 },
    { last_line: -1 },
    { first_line: 1.5 },
    { first_line: "3" },
  ])("refuses the lines %j, and says which there are", (lines) => {
    const { result, read } = use({ path: RULES, ...lines });
    expect(result).toMatchObject({
      is_error: true,
      content: `${RULES} has no such lines: its lines are 1 to 4.`,
    });
    expect(read).toEqual({ path: RULES, fromLine: null, toLine: null, outcome: "refused" });
  });

  it.each([
    "/etc/passwd",
    "harness/../../etc/passwd",
    "~/.ssh/id_rsa",
    "./harness/docs/rules.md",
    "harness/docs",
    "docs/rules.md",
    "constructor",
    "",
  ])("refuses %j, naming nothing but the path asked for", (path) => {
    expect(use({ path })).toEqual({
      result: {
        type: "tool_result",
        tool_use_id: "toolu_1",
        is_error: true,
        content: `${path} isn't one of the files to read.`,
      },
      read: { path, fromLine: null, toLine: null, outcome: "refused" },
    });
  });

  it.each([[{}], [{ path: 3 }], [null], ["harness/docs/rules.md"]])(
    "answers %j, which names no file, and records nothing",
    (input) => {
      const { result, read } = use(input);
      expect(result.is_error).toBe(true);
      expect(read).toBeNull();
    },
  );

  it("answers another tool's name with an error", () => {
    const { result, read } = use({ path: RULES }, "bash");
    expect(result).toMatchObject({ is_error: true });
    expect(result.content).not.toContain("Rules\n");
    expect(read).toBeNull();
  });

  it("never sends only whitespace, which the API refuses", () => {
    expect(use({ path: "harness/docs/empty.md" }).result.content).toBe("(blank)");
    expect(use({ path: RULES, first_line: 2, last_line: 2 }).result.content).toBe("(blank)");
  });
});
