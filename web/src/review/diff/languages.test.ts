import { describe, expect, it } from "vitest";
import { grammarContext, hunkSides, languageOf } from "./languages.ts";
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

describe("grammarContext", () => {
  const classBody = "class _ {\n";
  const methodBody = "class _ {\nvoid _() {\n";
  const block = "{\n";
  const java = (...lines: string[]) => grammarContext(lines.join("\n"), "java");

  it("starts a piece at the top of the file at the top", () => {
    expect(java("package a;", "", "import java.util.List;")).toBe("");
    expect(java("@Service", "public class Orders {")).toBe("");
  });

  it("starts a member one level in in a class body", () => {
    expect(java("    @GetMapping", "    public Order find(String id) {")).toBe(classBody);
    expect(java("", "    Order find(String id) throws NotFound {")).toBe(classBody);
    expect(java("    default double total(int quantity) {")).toBe(classBody);
    expect(java("\tprivate final Repository repository;")).toBe(classBody);
  });

  it("starts a statement in a method body", () => {
    expect(java("        var order = repository.find(id);")).toBe(methodBody);
    expect(java("        return order;", "    }", "", "    public void save() {")).toBe(methodBody);
    expect(java("    }", "", "    public void save() {")).toBe(methodBody);
    expect(java("    count++;")).toBe(methodBody);
    expect(java("    repository.save(order);")).toBe(methodBody);
    expect(java("    default -> 0;")).toBe(methodBody);
    expect(java("\t\tif (order == null) {")).toBe(methodBody);
  });

  it("starts a member of a nested class in a class body as deep", () => {
    expect(java("        @Override", "        public String toString() {")).toBe(
      classBody + classBody,
    );
  });

  it("opens a block for each level a statement is deeper than a method's body", () => {
    expect(java('            case PENDING -> "Waiting";', "        };", "    }")).toBe(
      methodBody + block,
    );
    expect(java("                .map(Line::sku)")).toBe(methodBody + block + block);
  });

  it("reads indentation by two spaces when the code uses them", () => {
    expect(java("  public Order find(String id) {", "    return null;")).toBe(classBody);
    expect(java("    return order;", "  }")).toBe(methodBody);
  });

  it("starts a piece inside a block comment in it", () => {
    expect(
      java("     * @param id the order", "     */", "    public Order find(String id) {"),
    ).toBe(`${classBody}/*\n`);
    expect(java(" * Orders.", " */")).toBe("/*\n");
  });

  it("reads other languages from the top", () => {
    expect(grammarContext("    public Order Find(string id) {", "csharp")).toBe("");
  });
});
