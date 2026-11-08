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
  /** Every file's path at the commit, sorted. */
  listFiles(sha: string): Promise<Result<readonly string[], CheckoutError>>;
  /** Files at the commit, in the order of `paths`. */
  readFiles(
    sha: string,
    paths: readonly string[],
  ): Promise<Result<readonly CheckoutFile[], CheckoutError>>;
}

/** Finds the local checkout a pull request's repository can be read from. */
export interface LocalCheckouts {
  /**
   * The checkout megareviewer was pointed at, and whether one of its remotes names `repo`; null
   * when there's none.
   */
  find(
    repo: RepoRef,
  ): Promise<{ readonly checkout: LocalCheckout; readonly namesRepo: boolean } | null>;
}
