import type { FileChange, Hunk, PartId } from "../../../../src/domain/diff/index.ts";
import type { ExpandDirection } from "../../review/index.ts";
import type { PartIndex } from "./model.ts";

// The unchanged lines a file's card folds away: above its first part, between two parts, and below
// its last. Lines are counted on the head side, the file the PR leaves; a fold opens from there.

/** git's default context, which both hosts' diffs use: a hunk ends this far before the next change. */
const DIFF_CONTEXT = 3;

export interface Fold {
  /** The part after the fold, or null for the fold below the last part. */
  readonly before: PartId | null;
  /** The part before the fold, or null for the fold above the first part. */
  readonly after: PartId | null;
  /** The first folded line, on the head side. */
  readonly start: number;
  /** The last folded line, or null below the last part, where the file's length isn't known. */
  readonly end: number | null;
  /** What to add to a head line's number for its base line number. */
  readonly offset: number;
}

/** How many lines a fold holds, or null until the file says where it ends. */
export const foldSize = (fold: Fold, fileLines: number | null): number | null => {
  const end = fold.end ?? fileLines;
  return end === null ? null : Math.max(0, end - fold.start + 1);
};

/** The first head line after a hunk, and the base line it was. An empty side starts a line early. */
const nextLines = (hunk: Hunk) => ({
  head: hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart + hunk.newLines,
  base: hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart + hunk.oldLines,
});

const firstHeadLine = (hunk: Hunk): number =>
  hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;

/**
 * Whether the diff shows the hunk reaching the end of the file: its last line says it has no
 * newline, or fewer context lines follow its last change than a diff keeps.
 */
const reachesEnd = (hunk: Hunk): boolean => {
  const last = hunk.lines.at(-1);
  if (last === undefined || last.noNewlineAtEnd) return true;
  let context = 0;
  for (let at = hunk.lines.length - 1; at >= 0 && hunk.lines[at]?.kind === "context"; at--) {
    context++;
  }
  return context < DIFF_CONTEXT;
};

/** Whether a file's unchanged lines can be opened: only a file that's both in the base and head. */
export const canOpen = (file: Pick<FileChange, "status" | "binary">): boolean =>
  !file.binary && file.status !== "added" && file.status !== "deleted";

/**
 * Every fold of a card, in the file's order: above its first part, between each two parts that
 * don't touch, and below its last part unless the diff shows it reaching the end. A fold with no
 * lines isn't one.
 */
export const foldsOf = (partIds: readonly PartId[], index: PartIndex): Fold[] => {
  const hunks = partIds.flatMap((id) => {
    const found = index.parts.get(id);
    return found === undefined ? [] : [{ id, hunk: found.hunk }];
  });
  const folds: Fold[] = [];
  const first = hunks[0];
  if (first === undefined) return folds;
  const top = firstHeadLine(first.hunk) - 1;
  if (top > 0) folds.push({ before: first.id, after: null, start: 1, end: top, offset: 0 });
  for (const [at, { id, hunk }] of hunks.entries()) {
    const next = nextLines(hunk);
    const following = hunks[at + 1];
    const offset = next.base - next.head;
    if (following === undefined) {
      if (!reachesEnd(hunk)) {
        folds.push({ before: null, after: id, start: next.head, end: null, offset });
      }
      continue;
    }
    const end = firstHeadLine(following.hunk) - 1;
    if (end >= next.head) {
      folds.push({ before: following.id, after: id, start: next.head, end, offset });
    }
  }
  return folds;
};

/** How much of a fold is open: lines from its top, under the part before, and from its bottom. */
export interface Opened {
  readonly top: number;
  readonly bottom: number;
}

export const CLOSED: Opened = { top: 0, bottom: 0 };

/**
 * Opens `step` more lines of a fold: "down" from its top, "up" from its bottom, as the arrows
 * point from the fold row; "all" the rest. A fold with no part before it opens only up, and one
 * with no part after it only down. Without its size, "up" and "all" wait for the file.
 */
export const openMore = (
  opened: Opened,
  direction: ExpandDirection,
  step: number,
  size: number | null,
): Opened => {
  if (direction === "all")
    return size === null ? { top: Number.MAX_SAFE_INTEGER, bottom: 0 } : { top: size, bottom: 0 };
  const left =
    size === null ? Number.MAX_SAFE_INTEGER : Math.max(0, size - opened.top - opened.bottom);
  const more = Math.min(step, left);
  return direction === "down"
    ? { ...opened, top: opened.top + more }
    : { ...opened, bottom: opened.bottom + more };
};

/** The head line numbers a fold shows open, above and below its row, and how many stay folded. */
export const openRanges = (
  fold: Fold,
  opened: Opened,
  fileLines: number,
): {
  readonly top: readonly number[];
  readonly hidden: number;
  readonly bottom: readonly number[];
} => {
  const size = foldSize(fold, fileLines) ?? 0;
  const top = Math.min(opened.top, size);
  const bottom = Math.min(opened.bottom, size - top);
  const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  return {
    top: range(fold.start, top),
    hidden: size - top - bottom,
    bottom: range(fold.start + size - bottom, bottom),
  };
};

/** A file's text as its lines, without the empty one after a final newline, or a line's CR. */
export const fileLines = (content: string): string[] => {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
};
