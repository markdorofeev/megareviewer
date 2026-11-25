import type {
  BlobHash,
  HarnessSkipReason,
  HostError,
  HostKind,
  RepoRef,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** A file at a commit: its text and git's hash of it, or why the source won't give the text. */
export type HarnessSourceFile =
  | { readonly kind: "text"; readonly content: string; readonly blob: BlobHash }
  | { readonly kind: "skipped"; readonly reason: HarnessSkipReason };

/**
 * Where a repository's harness is found and read, at commits. It saves no requests of its own: the
 * use case picks the cheapest way its answers allow. A source whose host gives no blob hash
 * computes git's own.
 */
export interface HarnessSource {
  readonly host: HostKind;
  /** Every file at the commit with its blob hash, or null when the source can't list them all. */
  listFiles(
    repo: RepoRef,
    sha: string,
  ): Promise<Result<ReadonlyMap<string, BlobHash> | null, HostError>>;
  /** Files at the commit, in the order of `paths`: null for a path that isn't a file there. */
  readFiles(
    repo: RepoRef,
    sha: string,
    paths: readonly string[],
  ): Promise<Result<readonly (HarnessSourceFile | null)[], HostError>>;
  /**
   * The paths that differ between two commits, both of a renamed file's among them, or null when
   * the source can't say all of them.
   */
  changedPaths(
    repo: RepoRef,
    fromSha: string,
    toSha: string,
  ): Promise<Result<readonly string[] | null, HostError>>;
}
