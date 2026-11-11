import type { FileChange, Hunk } from "../../../../src/domain/diff/index.ts";
import { type CharRange, intraLineChanges } from "./intra-line.ts";
import { displayLines } from "./lines.ts";
import type { HunkTokens, SyntaxToken } from "./syntax.ts";

// A file's diff as the rows the viewer draws, one list for a virtual scroller: a gap of unchanged
// lines, a hunk's header, then its lines. Unified rows hold one line; split rows hold the old and
// the new side of one line, a deleted line beside the added line that replaces it.

export type LineKind = "add" | "del" | "context";

export interface ViewLine {
  /** `hunkId:index`, stable across renders, for focus and selection. */
  readonly key: string;
  readonly hunkId: Hunk["id"];
  readonly kind: LineKind;
  readonly oldNo: number | null;
  readonly newNo: number | null;
  readonly text: string;
  readonly tokens: readonly SyntaxToken[] | null;
  readonly wordRanges: readonly CharRange[];
  /** What the text can't show: a CRLF ending others in the hunk lack, a missing final newline. */
  readonly notes: readonly string[];
}

export interface GapRow {
  readonly type: "gap";
  readonly key: string;
  /** Unchanged lines hidden before the hunk after it. */
  readonly hidden: number;
  readonly before: Hunk["id"];
}

export interface HunkRow {
  readonly type: "hunk";
  readonly key: string;
  readonly hunk: Hunk;
  /** Position among the file's hunks, from 1, for "hunk 2 of 4". */
  readonly position: number;
}

export interface LineRow {
  readonly type: "line";
  readonly key: string;
  readonly line: ViewLine;
}

export interface SplitRow {
  readonly type: "split";
  readonly key: string;
  readonly old: ViewLine | null;
  readonly new: ViewLine | null;
}

export type UnifiedRow = GapRow | HunkRow | LineRow;
export type SideBySideRow = GapRow | HunkRow | SplitRow;

/** Each hunk's lines as the viewer shows them, with word ranges and the tokens given. */
export const viewLines = (hunk: Hunk, tokens: HunkTokens | null = null): ViewLine[] => {
  const words = intraLineChanges(hunk.lines);
  return displayLines(hunk.lines).map(({ line, text, carriageReturn }, index) => ({
    key: `${hunk.id}:${index}`,
    hunkId: hunk.id,
    kind: line.kind,
    oldNo: line.oldLine,
    newNo: line.newLine,
    text,
    tokens: tokens?.[index] ?? null,
    wordRanges: words.get(index) ?? [],
    notes: [
      ...(carriageReturn ? ["CRLF"] : []),
      ...(line.noNewlineAtEnd ? ["No newline at end of file"] : []),
    ],
  }));
};

/** Unchanged lines between the end of `previous` (or the top of the file) and `hunk`. */
export const hiddenBefore = (previous: Hunk | null, hunk: Hunk): number => {
  const end = previous === null ? 1 : previous.newStart + previous.newLines;
  // A hunk that deletes a file's lines starts at new line 0.
  const start = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;
  return Math.max(0, start - end);
};

const hunkRows = <Row>(
  file: Pick<FileChange, "hunks">,
  tokens: readonly (HunkTokens | null)[] | null,
  body: (lines: ViewLine[]) => Row[],
): (GapRow | HunkRow | Row)[] =>
  file.hunks.flatMap((hunk, index) => {
    const previous = index === 0 ? null : (file.hunks[index - 1] ?? null);
    const hidden = hiddenBefore(previous, hunk);
    const gap: GapRow[] =
      hidden > 0 ? [{ type: "gap", key: `gap:${hunk.id}`, hidden, before: hunk.id }] : [];
    const header: HunkRow = { type: "hunk", key: `hunk:${hunk.id}`, hunk, position: index + 1 };
    return [...gap, header, ...body(viewLines(hunk, tokens?.[index] ?? null))];
  });

export const unifiedRows = (
  file: Pick<FileChange, "hunks">,
  tokens: readonly (HunkTokens | null)[] | null = null,
): UnifiedRow[] =>
  hunkRows(file, tokens, (lines) =>
    lines.map((line): LineRow => ({ type: "line", key: line.key, line })),
  );

/**
 * Context lines sit on both sides. A run of deleted lines and the added lines after it are paired
 * row by row, and the longer run's extra lines face an empty side.
 */
export const pairLines = (lines: readonly ViewLine[]): SplitRow[] => {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind === "context") {
      rows.push({ type: "split", key: line.key, old: line, new: line });
      index++;
      continue;
    }
    const deleted: ViewLine[] = [];
    for (let next = lines[index]; next?.kind === "del"; next = lines[++index]) deleted.push(next);
    const added: ViewLine[] = [];
    for (let next = lines[index]; next?.kind === "add"; next = lines[++index]) added.push(next);
    for (let pair = 0; pair < Math.max(deleted.length, added.length); pair++) {
      const old = deleted[pair] ?? null;
      const next = added[pair] ?? null;
      rows.push({ type: "split", key: (old ?? next)?.key ?? `${index}:${pair}`, old, new: next });
    }
  }
  return rows;
};

export const splitRows = (
  file: Pick<FileChange, "hunks">,
  tokens: readonly (HunkTokens | null)[] | null = null,
): SideBySideRow[] => hunkRows(file, tokens, pairLines);

/** The lines of rows in reading order, for moving the focus: a split row's old side first. */
export const linesOf = (rows: readonly (UnifiedRow | SideBySideRow)[]): ViewLine[] => {
  const lines: ViewLine[] = [];
  for (const row of rows) {
    if (row.type === "line") lines.push(row.line);
    if (row.type !== "split") continue;
    if (row.old !== null) lines.push(row.old);
    if (row.new !== null && row.new !== row.old) lines.push(row.new);
  }
  return lines;
};

/** The keys from `anchor` to `focus`, inclusive, in reading order. */
export const selectedRange = (
  lines: readonly ViewLine[],
  anchor: string,
  focus: string,
): ReadonlySet<string> => {
  const from = lines.findIndex((line) => line.key === anchor);
  const to = lines.findIndex((line) => line.key === focus);
  if (from === -1 || to === -1) return new Set();
  const [start, end] = from <= to ? [from, to] : [to, from];
  return new Set(lines.slice(start, end + 1).map((line) => line.key));
};
