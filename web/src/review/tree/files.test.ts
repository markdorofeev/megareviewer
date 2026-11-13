import { describe, expect, it } from "vitest";
import { type FileEntry, filterFiles, sortFiles } from "./files.ts";

const entry = (path: string, additions = 0, deletions = 0): FileEntry => ({
  path,
  status: "modified",
  additions,
  deletions,
});

const FILES = [
  entry("web/src/pages/review/tree.ts", 3, 1),
  entry("src/domain/review/risk.ts", 40, 2),
  entry("README.md", 1, 1),
];

describe("filterFiles", () => {
  it("keeps files whose path holds every word, ignoring case", () => {
    expect(filterFiles(FILES, "REV tree").map((file) => file.path)).toEqual([
      "web/src/pages/review/tree.ts",
    ]);
    expect(filterFiles(FILES, "review")).toHaveLength(2);
  });

  it("keeps every file for an empty query and none for a missing word", () => {
    expect(filterFiles(FILES, "  ")).toHaveLength(3);
    expect(filterFiles(FILES, "nothing")).toEqual([]);
  });
});

describe("sortFiles", () => {
  it("sorts by path as a tree lists it, directories first", () => {
    expect(sortFiles(FILES, "path").map((file) => file.path)).toEqual([
      "src/domain/review/risk.ts",
      "web/src/pages/review/tree.ts",
      "README.md",
    ]);
  });

  it("sorts by changed lines, most first, ties by path", () => {
    expect(sortFiles([...FILES, entry("a.ts", 1, 1)], "size").map((file) => file.path)).toEqual([
      "src/domain/review/risk.ts",
      "web/src/pages/review/tree.ts",
      "a.ts",
      "README.md",
    ]);
  });
});
