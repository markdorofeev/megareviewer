import type { RepoRef } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import {
  type CheckoutError,
  type CheckoutFile,
  type FoundCheckout,
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

  async filesMentioning(
    sha: string,
    names: readonly string[],
  ): Promise<Result<readonly string[], CheckoutError>> {
    const files = this.files(sha);
    if (!files.ok) return files;
    return ok(
      Object.entries(files.value)
        .filter(([, content]) => names.some((name) => content.includes(name)))
        .map(([path]) => path)
        .sort(),
    );
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

/** Finds what it's given, whatever the repository, and records what it was asked. */
export class FakeLocalCheckouts implements LocalCheckouts {
  readonly searchFolder: string | null;
  /** "pointedAt", "at <folder>" and "search", in the order asked. */
  readonly asked: string[] = [];

  private readonly pointed: FoundCheckout | null;
  private readonly clones: readonly FoundCheckout[];

  constructor(
    pointed: FoundCheckout | null = null,
    options: {
      /** The clones on the machine, which `at` finds by folder and the search answers in order. */
      readonly clones?: readonly FoundCheckout[];
      /** Null turns the search off. */
      readonly searchFolder?: string | null;
    } = {},
  ) {
    this.pointed = pointed;
    this.clones = options.clones ?? [];
    this.searchFolder = options.searchFolder === undefined ? "/home/lee" : options.searchFolder;
  }

  async pointedAt(_repo: RepoRef): Promise<FoundCheckout | null> {
    this.asked.push("pointedAt");
    return this.pointed;
  }

  async at(dir: string, _repo: RepoRef): Promise<FoundCheckout | null> {
    this.asked.push(`at ${dir}`);
    return this.clones.find((clone) => clone.dir === dir) ?? null;
  }

  async search(_repo: RepoRef): Promise<readonly FoundCheckout[]> {
    this.asked.push("search");
    return this.searchFolder === null ? [] : this.clones;
  }
}
