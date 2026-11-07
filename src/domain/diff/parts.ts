import { HunkId, type PartId } from "./types.ts";

/** The hunk a part is of: the part ID without its ".n". */
export const hunkIdOf = (id: PartId): HunkId => HunkId.parse(id.replace(/\.[0-9]+$/, ""));
