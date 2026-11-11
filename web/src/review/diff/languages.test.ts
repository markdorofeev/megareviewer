import { describe, expect, it } from "vitest";
import { hunkSides, languageOf } from "./languages.ts";
import { displayLines } from "./lines.ts";
import { firstHunk, modifiedFile } from "./testing.ts";

describe("languageOf", () => {
  it.each([
    [{ path: "src/a.ts", language: "typescript" }, "typescript"],
    [{ path: "src/A.cs", language: "c_sharp" }, "csharp"],
    [{ path: "src/a.ts", language: null }, "typescript"],
    [{ path: "pnpm-lock.yaml", language: null }, "yaml"],
    [{ path: "README.MD", language: null }, "markdown"],
    [{ path: "deploy/Dockerfile", language: null }, "docker"],
    [{ path: "Makefile", language: null }, "make"],
    [{ path: "script.weird", language: "weird" }, null],
    [{ path: "LICENSE", language: null }, null],
    [{ path: ".env", language: null }, null],
  ])("%j is %s", (file, language) => {
    expect(languageOf(file)).toBe(language);
  });
});

// A template string that starts in a context line and spans the changed lines.
const templateHunk = firstHunk(
  modifiedFile("src/query.ts", [
    "@@ -1,4 +1,4 @@",
    " const query = `",
    "-  SELECT id",
    "+  SELECT id, name",
    "   FROM users`;",
    " run(query);",
  ]),
);

describe("hunkSides", () => {
  it("builds the old side from context and deleted lines, the new one from context and added", () => {
    expect(hunkSides(displayLines(templateHunk.lines))).toEqual({
      old: "const query = `\n  SELECT id\n  FROM users`;\nrun(query);",
      new: "const query = `\n  SELECT id, name\n  FROM users`;\nrun(query);",
    });
  });

  it("drops carriage returns", () => {
    const hunk = firstHunk(modifiedFile("a.ini", ["@@ -1 +1 @@", "-a\r", "+b\r"]));
    expect(hunkSides(displayLines(hunk.lines))).toEqual({ old: "a", new: "b" });
  });
});
