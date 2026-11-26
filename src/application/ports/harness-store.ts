import type { BlobHash, Harness, RepoRef, Timestamp } from "../../domain/review/index.ts";

export interface HarnessBlob {
  readonly blob: BlobHash;
  readonly content: string;
}

/**
 * Repositories' harnesses, by commit, and their files' contents, each once by its blob hash. The
 * store stamps when a harness was put and when a blob was last put or read.
 */
export interface HarnessStore {
  getHarness(repo: RepoRef, sha: string): Promise<Harness | null>;
  /** Upsert by repository and commit. */
  putHarness(repo: RepoRef, harness: Harness): Promise<void>;
  /** The repository's harness put last, whatever its commit. */
  latestHarness(repo: RepoRef): Promise<Harness | null>;
  /** The contents it has of `blobs`, which counts as using them. */
  getBlobs(repo: RepoRef, blobs: readonly BlobHash[]): Promise<ReadonlyMap<BlobHash, string>>;
  putBlobs(repo: RepoRef, entries: readonly HarnessBlob[]): Promise<void>;
  /** Drops every repository's blobs not used since `time`, and the harnesses put before it. */
  dropUnusedSince(time: Timestamp): Promise<void>;
}
