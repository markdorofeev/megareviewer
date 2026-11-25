import type { HunkId } from "../diff/index.ts";

/** The referenced IDs that aren't known, each once, in first-seen order. */
export const validateHunkReferences = (
  known: ReadonlySet<HunkId>,
  referenced: readonly HunkId[],
): HunkId[] => [...new Set(referenced.filter((id) => !known.has(id)))];
