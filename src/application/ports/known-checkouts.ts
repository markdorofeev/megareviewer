import type { RepoRef, Timestamp } from "../../domain/review/index.ts";

/** A folder a repository was read from. */
export interface KnownCheckout {
  readonly repo: RepoRef;
  readonly dir: string;
  readonly lastReadAt: Timestamp;
}

/** The folders repositories were read from before, kept across restarts. */
export interface KnownCheckouts {
  /** The folders the repository was read from, the most recently read first. */
  foldersRead(repo: RepoRef): Promise<readonly string[]>;
  /** Records, at the store's clock, that the repository was read from a folder. */
  rememberFolder(repo: RepoRef, dir: string): Promise<void>;
  forgetFolder(repo: RepoRef, dir: string): Promise<void>;
  /** Every folder of every repository, the most recently read first. */
  knownCheckouts(): Promise<readonly KnownCheckout[]>;
}
