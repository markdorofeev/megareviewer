import type { ReviewThread, ThreadId } from "../../../../src/domain/review/index.ts";
import { commentPlace } from "../../review/index.ts";
import type { FileGroup, PartIndex } from "./model.ts";
import { placeKey, type ThreadPlacement } from "./threads.ts";

/**
 * The threads in the order the page shows them, top to bottom: each file's card in turn, its
 * threads under their lines in the lines' order, then its earlier comments; then the threads on
 * files without a card.
 */
export const threadOrder = (
  placement: ThreadPlacement,
  files: readonly FileGroup[],
  index: PartIndex,
): readonly ReviewThread[] => {
  const ordered: ReviewThread[] = [];
  for (const group of files) {
    for (const id of group.partIds) {
      const lines = placement.onLine.get(id);
      const hunk = index.parts.get(id)?.hunk;
      if (lines === undefined || hunk === undefined) continue;
      const seen = new Set<string>();
      for (const line of hunk.lines) {
        const place = commentPlace(line);
        if (place === null) continue;
        const key = placeKey(place);
        if (seen.has(key)) continue;
        seen.add(key);
        ordered.push(...(lines.get(key) ?? []));
      }
    }
    ordered.push(...(placement.earlier.get(group.file.path) ?? []));
  }
  ordered.push(...placement.elsewhere);
  return ordered;
};

/** The threads the stepper walks and its list shows: the unresolved ones. */
export const threadSteps = (ordered: readonly ReviewThread[]): readonly ReviewThread[] =>
  ordered.filter((thread) => !thread.resolved);

/**
 * The thread a step goes to, round from the last to the first and back. From a thread outside the
 * steps, such as a resolved one gone to from the list, it goes to the nearest step after it on the
 * page, or before it, so stepping never jumps back over where the reviewer is. With no current
 * thread, Next goes to the first and Previous to the last.
 */
export const stepThreads = (
  ordered: readonly ReviewThread[],
  steps: readonly ReviewThread[],
  current: ThreadId | null,
  direction: 1 | -1,
): ThreadId | null => {
  if (steps.length === 0) return null;
  const isStep = new Set(steps.map((thread) => thread.id));
  const from = current === null ? -1 : ordered.findIndex((thread) => thread.id === current);
  if (from === -1) return (direction === 1 ? steps[0] : steps.at(-1))?.id ?? null;
  for (let n = 1; n <= ordered.length; n += 1) {
    const thread = ordered[(from + direction * n + ordered.length * n) % ordered.length];
    if (thread !== undefined && isStep.has(thread.id)) return thread.id;
  }
  return null;
};
