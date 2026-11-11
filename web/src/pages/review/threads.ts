import type { Hunk, PartId } from "../../../../src/domain/diff/index.ts";
import {
  editsOverlap,
  type ReviewThread,
  suggestionOf,
  type ThreadCommentId,
  threadLines,
} from "../../../../src/domain/review/index.ts";
import { commentPlace, type LinePlace } from "../../review/index.ts";
import type { FileGroup, PartIndex } from "./model.ts";

/** A line's key among a part's threads. */
export const placeKey = (place: Pick<LinePlace, "side" | "line">): string =>
  `${place.side}:${place.line}`;

/** Where each thread goes on the map. Every thread goes somewhere: none is dropped. */
export interface ThreadPlacement {
  /** Threads under a line the map shows: by part, then by `placeKey`. */
  readonly onLine: ReadonlyMap<PartId, ReadonlyMap<string, readonly ReviewThread[]>>;
  /** A file's threads on lines its card doesn't show, or on code that has changed since. */
  readonly earlier: ReadonlyMap<string, readonly ReviewThread[]>;
  /** Threads on files the map has no card for, such as mechanical ones. */
  readonly elsewhere: readonly ReviewThread[];
  /** Each file's unresolved threads. */
  readonly open: ReadonlyMap<string, number>;
}

const NONE: ThreadPlacement = {
  onLine: new Map(),
  earlier: new Map(),
  elsewhere: [],
  open: new Map(),
};

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) =>
  map.set(key, [...(map.get(key) ?? []), value]);

/**
 * Puts each thread under the line it's on, in the part of its file's card that shows that line;
 * an outdated thread, or one on a line no part shows, goes under its file's "Earlier comments".
 */
export const placeThreads = (
  threads: readonly ReviewThread[] | null,
  files: readonly FileGroup[],
  index: PartIndex,
): ThreadPlacement => {
  if (threads === null || threads.length === 0) return NONE;
  const groups = new Map(files.map((group) => [group.file.path, group]));
  const onLine = new Map<PartId, Map<string, ReviewThread[]>>();
  const earlier = new Map<string, ReviewThread[]>();
  const elsewhere: ReviewThread[] = [];
  const open = new Map<string, number>();
  for (const thread of threads) {
    if (!thread.resolved) open.set(thread.path, (open.get(thread.path) ?? 0) + 1);
    const group = groups.get(thread.path);
    if (group === undefined) {
      elsewhere.push(thread);
      continue;
    }
    const { line } = thread;
    const partId =
      thread.outdated || line === null
        ? undefined
        : group.partIds.find((id) =>
            index.parts.get(id)?.hunk.lines.some((one) => {
              const place = commentPlace(one);
              return place !== null && place.side === thread.side && place.line === line;
            }),
          );
    if (partId === undefined || line === null) {
      push(earlier, thread.path, thread);
      continue;
    }
    const lines = onLine.get(partId) ?? new Map<string, ReviewThread[]>();
    push(lines, placeKey({ side: thread.side, line }), thread);
    onLine.set(partId, lines);
  }
  return { onLine, earlier, elsewhere, open };
};

/** A suggestion that can go in the batch: its comment, file and lines. */
export interface BatchEntry {
  readonly commentId: ThreadCommentId;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

/** The suggestions the threads make that can still be applied, by comment ID. */
export const suggestionsIn = (
  threads: readonly ReviewThread[] | null,
): ReadonlyMap<ThreadCommentId, BatchEntry> => {
  const entries = new Map<ThreadCommentId, BatchEntry>();
  for (const thread of threads ?? []) {
    const range = threadLines(thread);
    if (thread.outdated || thread.side !== "new" || range === null) continue;
    for (const comment of thread.comments) {
      const lines = suggestionOf(comment.body);
      if (lines !== null) {
        entries.set(comment.id, { commentId: comment.id, path: thread.path, ...range, lines });
      }
    }
  }
  return entries;
};

/**
 * Why a suggestion can't join the batch: it changes lines another suggestion in it changes, and
 * one commit can't make both. Null when it can.
 */
export const batchProblem = (
  entry: BatchEntry | undefined,
  batch: readonly BatchEntry[],
): string | null => {
  if (entry === undefined) return "This suggestion can't be applied.";
  const clash = batch.find(
    (other) =>
      other.commentId !== entry.commentId &&
      other.path === entry.path &&
      editsOverlap(other, entry),
  );
  if (clash === undefined) return null;
  const where =
    clash.start === clash.end ? `line ${clash.start}` : `lines ${clash.start}–${clash.end}`;
  return `Changes ${where} too, like a suggestion already in the batch.`;
};

/** The batch's suggestions by file, in the order they were added, for the preview. */
export const batchFiles = (
  batch: readonly BatchEntry[],
): readonly { readonly path: string; readonly entries: readonly BatchEntry[] }[] => {
  const byPath = new Map<string, BatchEntry[]>();
  for (const entry of batch) push(byPath, entry.path, entry);
  return [...byPath].map(([path, entries]) => ({ path, entries }));
};

/** "Apply suggestion", or "Apply 3 suggestions". */
export const applyLabel = (count: number): string =>
  count === 1 ? "Apply 1 suggestion" : `Apply ${count} suggestions`;

/** The head-side text of lines `start` to `end` that a hunk shows, or null if it misses one. */
export const coveredLines = (hunk: Hunk, start: number, end: number): readonly string[] | null => {
  const texts = new Map(
    hunk.lines.flatMap((line) =>
      line.kind !== "del" && line.newLine !== null ? [[line.newLine, line.text] as const] : [],
    ),
  );
  const lines: string[] = [];
  for (let at = start; at <= end; at += 1) {
    const text = texts.get(at);
    if (text === undefined) return null;
    lines.push(text);
  }
  return lines;
};
