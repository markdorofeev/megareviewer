import type { FileStatus } from "../../../../src/domain/diff/index.ts";
import type { PointKind } from "../../../../src/domain/review/index.ts";

export interface FileEntry {
  readonly path: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  /** A renamed file's old path. */
  readonly oldPath?: string | null;
  /** Unresolved review threads on the file. */
  readonly threads?: number;
  /** Claude's points on the file, by kind. */
  readonly points?: Readonly<Partial<Record<PointKind, number>>>;
}

/**
 * The files whose path holds every word of `query`, ignoring case: "rev tree" finds
 * web/src/pages/review/tree.ts. An empty query keeps them all.
 */
export const filterFiles = <T extends Pick<FileEntry, "path">>(
  files: readonly T[],
  query: string,
): T[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return files.filter((file) => {
    const path = file.path.toLowerCase();
    return words.every((word) => path.includes(word));
  });
};
