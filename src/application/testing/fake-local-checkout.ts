import type { RepoRef } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import {
  type CheckoutError,
  type CheckoutFile,
  type LocalCheckout,
  type LocalCheckouts,
  MAX_CHECKOUT_FILE_BYTES,
} from "../ports/index.ts";

/** Files by path, per commit. */
export type CheckoutCommits = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A checkout that serves fixture files at their commits, and records what was read. */
export class FakeLocalCheckout implements LocalCheckout {
  /** The paths of every readFiles call. */
  readonly reads: (readonly string[])[] = [];

  private readonly commits: CheckoutCommits;

  constructor(commits: CheckoutCommits) {
    this.commits = commits;
  }

  async hasCommit(sha: string): Promise<boolean> {
    return Object.hasOwn(this.commits, sha);
  }

  async listFiles(sha: string): Promise<Result<readonly string[], CheckoutError>> {
    const files = this.files(sha);
    return files.ok ? ok(Object.keys(files.value).sort()) : files;
  }

  async readFiles(
    sha: string,
    paths: readonly string[],
  ): Promise<Result<readonly CheckoutFile[], CheckoutError>> {
    const files = this.files(sha);
    if (!files.ok) return files;
    this.reads.push([...paths]);
    return ok(
      paths.map((path): CheckoutFile => {
        const content = Object.hasOwn(files.value, path) ? files.value[path] : undefined;
        if (content === undefined) return { kind: "unreadable" };
        return new TextEncoder().encode(content).byteLength > MAX_CHECKOUT_FILE_BYTES
          ? { kind: "too-large" }
          : { kind: "text", content };
      }),
    );
  }

  private files(sha: string): Result<Readonly<Record<string, string>>, CheckoutError> {
    const files = Object.hasOwn(this.commits, sha) ? this.commits[sha] : undefined;
    return files === undefined
      ? err({ kind: "missing-commit", message: `No commit ${sha} in the checkout` })
      : ok(files);
  }
}

/** Finds one checkout, or none, whatever the repository. */
export class FakeLocalCheckouts implements LocalCheckouts {
  private readonly found: Awaited<ReturnType<LocalCheckouts["find"]>>;

  constructor(
    found: { readonly checkout: LocalCheckout; readonly namesRepo: boolean } | null = null,
  ) {
    this.found = found;
  }

  async find(_repo: RepoRef) {
    return this.found;
  }
}
