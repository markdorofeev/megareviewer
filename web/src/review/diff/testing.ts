import { type FileChange, type Hunk, parseUnifiedDiff } from "../../../../src/domain/diff/index.ts";

/** Files parsed from diff lines, for tests. A line `\r` stays in the text, as in a real diff. */
export const parseFiles = (lines: readonly string[]): readonly FileChange[] => {
  const parsed = parseUnifiedDiff(lines.map((line) => `${line}\n`).join(""));
  if (!parsed.ok) throw new Error(`test diff: line ${parsed.error.line}: ${parsed.error.message}`);
  return parsed.value;
};

/** One modified file at `path` with the given hunks, each a header and its lines. */
export const modifiedFile = (path: string, ...hunks: readonly string[][]): FileChange => {
  const [file] = parseFiles([
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.flat(),
  ]);
  if (file === undefined) throw new Error("test diff: no file");
  return file;
};

export const firstHunk = (file: FileChange): Hunk => {
  const [hunk] = file.hunks;
  if (hunk === undefined) throw new Error(`test diff: ${file.path} has no hunks`);
  return hunk;
};
