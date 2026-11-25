import type { RepoRef } from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** Files larger than this aren't read: too big to parse, as in the file cache. */
export const MAX_CHECKOUT_FILE_BYTES = 1024 * 1024;

/** "missing-commit": the checkout doesn't have the commit. "failed": git couldn't read it. */
export interface CheckoutError {
  readonly kind: "missing-commit" | "failed";
  readonly message: string;
}

/**
 * A file read from a checkout at a commit: its text, or why it wasn't read. "unreadable": it isn't
 * a file at that commit.
 */
export type CheckoutFile =
  | { readonly kind: "text"; readonly content: string }
  | { readonly kind: "too-large" }
  | { readonly kind: "unreadable" };

/**
 * A git checkout on this machine, read at commits. It never fetches, checks out or writes
 * anything, so the reviewer's working tree stays as it is.
 */
export interface LocalCheckout {
  hasCommit(sha: string): Promise<boolean>;
  /**
   * The paths of the files at the commit whose text holds any of the names, sorted. It may answer
   * files that hold a name only as part of a longer one, and never leaves out a file that holds one.
   */
  filesMentioning(
    sha: string,
    names: readonly string[],
  ): Promise<Result<readonly string[], CheckoutError>>;
  /** Files at the commit, in the order of `paths`. */
  readFiles(
    sha: string,
    paths: readonly string[],
  ): Promise<Result<readonly CheckoutFile[], CheckoutError>>;
}

/** A checkout found on this machine. */
export interface FoundCheckout {
  readonly checkout: LocalCheckout;
  /** The folder it's in, in full. */
  readonly dir: string;
  /** Whether one of its remotes names the repository asked about. */
  readonly namesRepo: boolean;
}

/** Finds the local checkouts a pull request's repository can be read from. */
export interface LocalCheckouts {
  /** The folder searched for clones, in full, or null when the search is off. */
  readonly searchFolder: string | null;
  /** The checkout megareviewer was pointed at, whatever its repository; null when there's none. */
  pointedAt(repo: RepoRef): Promise<FoundCheckout | null>;
  /** The checkout in a folder read before; null when it's gone. */
  at(dir: string, repo: RepoRef): Promise<FoundCheckout | null>;
  /**
   * The clones on this machine that could be the repository's, those whose remotes name it first.
   * None when the search is off.
   */
  search(repo: RepoRef): Promise<readonly FoundCheckout[]>;
}
