import type { DiffLine } from "../../../../src/domain/diff/index.ts";

/** Characters `[start, end)` of a line's text. */
export interface CharRange {
  readonly start: number;
  readonly end: number;
}

/** Longer lines aren't diffed: they're usually minified or data, and the cost grows with length. */
export const MAX_INTRA_LINE_LENGTH = 500;
/** Below this share of characters in common, a pair is a rewrite and highlighting adds noise. */
export const MIN_COMMON_SHARE = 0.3;

// Words, runs of whitespace, and single punctuation characters.
const WORD = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

export const splitWords = (text: string): string[] => text.match(WORD) ?? [];

/**
 * Pairs each run of deleted lines with the run of added lines right after it, line by line, and
 * returns the changed ranges of both lines of each pair, by index in `lines`. Lines without a pair,
 * and pairs that are too long or too different, have no entry.
 */
export const intraLineChanges = (
  lines: readonly Pick<DiffLine, "kind" | "text">[],
): ReadonlyMap<number, readonly CharRange[]> => {
  const changes = new Map<number, readonly CharRange[]>();
  let index = 0;
  while (index < lines.length) {
    if (lines[index]?.kind !== "del") {
      index++;
      continue;
    }
    const deletedStart = index;
    while (lines[index]?.kind === "del") index++;
    const addedStart = index;
    while (lines[index]?.kind === "add") index++;
    const pairs = Math.min(addedStart - deletedStart, index - addedStart);
    for (let pair = 0; pair < pairs; pair++) {
      const changed = wordDiff(
        lines[deletedStart + pair]?.text ?? "",
        lines[addedStart + pair]?.text ?? "",
      );
      if (changed === null) continue;
      changes.set(deletedStart + pair, changed.old);
      changes.set(addedStart + pair, changed.new);
    }
  }
  return changes;
};

/** The changed ranges of an old and a new line, or null when they shouldn't be highlighted. */
export const wordDiff = (
  oldText: string,
  newText: string,
): { readonly old: readonly CharRange[]; readonly new: readonly CharRange[] } | null => {
  if (oldText.length > MAX_INTRA_LINE_LENGTH || newText.length > MAX_INTRA_LINE_LENGTH) return null;
  const oldWords = splitWords(oldText);
  const newWords = splitWords(newText);
  const { inOld, inNew } = commonWords(oldWords, newWords);
  const commonChars = oldWords.reduce((sum, word, i) => sum + (inOld[i] ? word.length : 0), 0);
  const totalChars = oldText.length + newText.length;
  if (totalChars > 0 && (2 * commonChars) / totalChars < MIN_COMMON_SHARE) return null;
  return { old: changedRanges(oldWords, inOld), new: changedRanges(newWords, inNew) };
};

/** Merges each run of words not in common into one range. */
const changedRanges = (words: readonly string[], common: readonly boolean[]): CharRange[] => {
  const ranges: CharRange[] = [];
  let offset = 0;
  words.forEach((word, i) => {
    const end = offset + word.length;
    if (!common[i]) {
      const last = ranges.at(-1);
      if (last?.end === offset) ranges[ranges.length - 1] = { start: last.start, end };
      else ranges.push({ start: offset, end });
    }
    offset = end;
  });
  return ranges;
};

/**
 * A longest common subsequence of two word lists, by Myers' O((N+M)D) algorithm: which words of
 * each list are in it. Each round keeps only the diagonals it can reach, so memory is O(D²).
 */
export const commonWords = (
  a: readonly string[],
  b: readonly string[],
): { readonly inOld: boolean[]; readonly inNew: boolean[] } => {
  const inOld = a.map(() => false);
  const inNew = b.map(() => false);
  // furthest[k] is the furthest x reached on diagonal k = x - y; trace[d] holds it before round d,
  // for diagonals -d-1…d+1.
  const furthest = new Map<number, number>([[1, 0]]);
  const trace: Int32Array[] = [];
  const at = (d: number, k: number): number => trace[d]?.[k + d + 1] ?? 0;

  let rounds = 0;
  search: for (let d = 0; d <= a.length + b.length; d++) {
    const snapshot = new Int32Array(2 * d + 3);
    for (let k = -d - 1; k <= d + 1; k++) snapshot[k + d + 1] = furthest.get(k) ?? 0;
    trace.push(snapshot);
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (furthest.get(k - 1) ?? 0) < (furthest.get(k + 1) ?? 0));
      let x = down ? (furthest.get(k + 1) ?? 0) : (furthest.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      furthest.set(k, x);
      if (x >= a.length && y >= b.length) {
        rounds = d;
        break search;
      }
    }
  }

  let x = a.length;
  let y = b.length;
  for (let d = rounds; d >= 0; d--) {
    const k = x - y;
    const down = k === -d || (k !== d && at(d, k - 1) < at(d, k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(d, previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      inOld[x] = true;
      inNew[y] = true;
    }
    x = previousX;
    y = previousY;
  }
  return { inOld, inNew };
};
