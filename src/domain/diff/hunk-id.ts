import { fnv1a64 } from "../shared/index.ts";
import { type Hunk, HunkId } from "./types.ts";

const KIND_CHARS = { context: " ", add: "+", del: "-" } as const;

export type HunkContent = Pick<Hunk, "oldStart" | "oldLines" | "newStart" | "newLines" | "lines">;

/** Names a hunk by its path, header counts and lines, so the same diff always gives the same IDs. */
export const hunkId = (path: string, hunk: HunkContent): HunkId => {
  const counts = `${hunk.oldStart},${hunk.oldLines},${hunk.newStart},${hunk.newLines}`;
  const lines = hunk.lines.map((line) => KIND_CHARS[line.kind] + line.text).join("\n");
  return HunkId.parse(`h_${fnv1a64(`${path}\n${counts}\n${lines}`)}`);
};

/**
 * Names the hunks of one PR, called in file order: a hunk whose ID is already taken gets "-2",
 * the next one "-3", and so on.
 */
export const hunkNamer = (): ((path: string, hunk: HunkContent) => HunkId) => {
  const seen = new Map<HunkId, number>();
  return (path, hunk) => {
    const id = hunkId(path, hunk);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count === 1 ? id : HunkId.parse(`${id}-${count}`);
  };
};

/** Whether a hunk shows a line number on a side: new is the head side, old the base. */
export const hunkHasLine = (hunk: Hunk, side: "new" | "old", line: number): boolean =>
  hunk.lines.some((diffLine) =>
    side === "new"
      ? diffLine.kind !== "del" && diffLine.newLine === line
      : diffLine.kind !== "add" && diffLine.oldLine === line,
  );
