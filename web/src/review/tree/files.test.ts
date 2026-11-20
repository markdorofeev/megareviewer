import { describe, expect, it } from "vitest";
import { type FileEntry, filterFiles } from "./files.ts";

const entry = (path: string): FileEntry => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 0,
});

const FILES = [
  entry("web/src/pages/review/tree.ts"),
  entry("src/domain/review/risk.ts"),
  entry("README.md"),
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
