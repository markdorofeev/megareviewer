import type { RepoRef, Timestamp } from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";
import type { LocalCheckout } from "./local-checkout.ts";

/**
 * Why a commit wasn't downloaded. "refused": the host doesn't let these credentials read the
 * repository, or has none by that name. "missing-commit": the host doesn't have the commit.
 * "stopped": megareviewer is closing.
 */
export interface DownloadError {
  readonly kind:
    | "off"
    | "no-git"
    | "no-credentials"
    | "refused"
    | "missing-commit"
    | "timed-out"
    | "stopped"
    | "failed";
  /** For the reviewer: why, and what would fix it. */
  readonly message: string;
}

/** A copy that has the commit asked for. */
export interface RepositoryCopy {
  readonly checkout: LocalCheckout;
  /** The folder it's in, in full. */
  readonly dir: string;
}

/** megareviewer's own copies of repositories, which hold only the commits it downloaded. */
export interface RepositoryCopies {
  /** The folder the copies are kept in, in full; null when downloading is off. */
  readonly downloadFolder: string | null;
  /** The copy that has the commit already, or null. Never uses the network, on or off. */
  find(repo: RepoRef, sha: string): Promise<RepositoryCopy | null>;
  /** Downloads the commit into the repository's copy. Joins a download of it already going. */
  download(repo: RepoRef, sha: string): Promise<Result<RepositoryCopy, DownloadError>>;
  /** Removes the copies not read since, and says how many. */
  forget(olderThan: Timestamp): Promise<number>;
}
