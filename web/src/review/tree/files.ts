import type { FileStatus } from "../../../../src/domain/diff/index.ts";
import type { PointKind } from "../../../../src/domain/review/index.ts";
import { byTreePath } from "./paths.ts";

export interface FileEntry {
  readonly path: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  /** Unresolved review threads on the file. */
  readonly threads?: number;
  /** Claude's points on the file, by kind. */
  readonly points?: Readonly<Partial<Record<PointKind, number>>>;
}

export type FileOrder = "path" | "size";

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

/** Path order as a directory tree lists it, or the most changed lines first. */
export const sortFiles = (files: readonly FileEntry[], order: FileOrder): FileEntry[] =>
  [...files].sort((a, b) =>
    order === "size"
      ? b.additions + b.deletions - (a.additions + a.deletions) || byTreePath(a.path, b.path)
      : byTreePath(a.path, b.path),
  );
