import type { RepoRef } from "../../domain/review/index.ts";
import type { FileAt } from "./git-host.ts";

/**
 * Files already fetched from a host. A file at a commit never changes, so an entry never goes
 * stale, and an analysis that failed partway resumes without fetching them again.
 */
export interface FileCache {
  /** The cached content, null inside for a file that isn't at its commit; null if not cached. */
  get(repo: RepoRef, file: FileAt): Promise<{ readonly content: string | null } | null>;
  put(repo: RepoRef, file: FileAt, content: string | null): Promise<void>;
}
