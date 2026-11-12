import type { Hunk, PartId } from "../../../../src/domain/diff/index.ts";
import type { ReviewThread } from "../../../../src/domain/review/index.ts";
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
