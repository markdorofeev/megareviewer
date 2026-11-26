import {
  BlobHash,
  type HostError,
  type HostKind,
  type RepoRef,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { HarnessSource, HarnessSourceFile } from "../ports/index.ts";

/** Git's hash of a file holding `content`, as `git hash-object` prints it. */
export const gitBlobHash = async (content: string): Promise<BlobHash> => {
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const data = new Uint8Array([...header, ...bytes]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  return BlobHash.parse([...hash].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
};

export type HarnessSourceMethod = "listFiles" | "readFiles" | "changedPaths";

const commitKey = (repo: RepoRef, sha: string): string =>
  `${repo.host}/${repo.owner}/${repo.repo}@${sha}`;

/**
 * A source over the files it's given at each commit. It lists and says what changed unless told
 * it can't, as GitHub and Bitbucket each can't do one of them. `calls` keeps what was asked, and
 * each method's entries are the requests a host would get.
 */
export class FakeHarnessSource implements HarnessSource {
  readonly host: HostKind;
  readonly calls: {
    readonly listFiles: string[];
    readonly readFiles: (readonly string[])[];
    readonly changedPaths: { readonly from: string; readonly to: string }[];
  } = { listFiles: [], readFiles: [], changedPaths: [] };
  private readonly lists: boolean;
  private readonly diffs: boolean;
  private readonly commits = new Map<string, Map<string, string | HarnessSourceFile>>();
  private readonly failures = new Map<HarnessSourceMethod, HostError[]>();
  private permanentFailure: HostError | null = null;
  private held: Promise<void> | null = null;

  constructor(
    options: { readonly host?: HostKind; readonly lists?: boolean; readonly diffs?: boolean } = {},
  ) {
    this.host = options.host ?? "github";
    this.lists = options.lists ?? true;
    this.diffs = options.diffs ?? true;
  }

  /** Adds files to a commit: their text, or what a read of one answers. */
  setFiles(
    repo: RepoRef,
    sha: string,
    files: Readonly<Record<string, string | HarnessSourceFile>>,
  ): void {
    const key = commitKey(repo, sha);
    this.commits.set(key, new Map([...(this.commits.get(key) ?? []), ...Object.entries(files)]));
  }

  /** The next call to `method` fails with `error`. Failures queue up per method. */
  failNext(method: HarnessSourceMethod, error: HostError): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), error]);
  }

  /** Every call fails with `error` until this is called with null. */
  failAlways(error: HostError | null): void {
    this.permanentFailure = error;
  }

  /** Every call waits until what this returns is called. */
  hold(): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.held = promise;
    return () => {
      this.held = null;
      resolve();
    };
  }

  async listFiles(
    repo: RepoRef,
    sha: string,
  ): Promise<Result<ReadonlyMap<string, BlobHash> | null, HostError>> {
    if (!this.lists) return ok(null);
    this.calls.listFiles.push(sha);
    const failure = await this.failureOf("listFiles");
    if (failure !== null) return err(failure);
    const listed = new Map<string, BlobHash>();
    for (const [path, file] of this.filesAt(repo, sha)) listed.set(path, await blobOf(file));
    return ok(listed);
  }

  async readFiles(
    repo: RepoRef,
    sha: string,
    paths: readonly string[],
  ): Promise<Result<readonly (HarnessSourceFile | null)[], HostError>> {
    this.calls.readFiles.push([...paths]);
    const failure = await this.failureOf("readFiles");
    if (failure !== null) return err(failure);
    const files = this.filesAt(repo, sha);
    return ok(
      await Promise.all(
        paths.map(async (path) => {
          const file = files.get(path);
          if (file === undefined) return null;
          return typeof file === "string"
            ? { kind: "text" as const, content: file, blob: await gitBlobHash(file) }
            : file;
        }),
      ),
    );
  }

  async changedPaths(
    repo: RepoRef,
    fromSha: string,
    toSha: string,
  ): Promise<Result<readonly string[] | null, HostError>> {
    if (!this.diffs) return ok(null);
    this.calls.changedPaths.push({ from: fromSha, to: toSha });
    const failure = await this.failureOf("changedPaths");
    if (failure !== null) return err(failure);
    const from = this.filesAt(repo, fromSha);
    const to = this.filesAt(repo, toSha);
    const paths = [...new Set([...from.keys(), ...to.keys()])].sort();
    return ok(
      paths.filter((path) => JSON.stringify(from.get(path)) !== JSON.stringify(to.get(path))),
    );
  }

  private filesAt(repo: RepoRef, sha: string): ReadonlyMap<string, string | HarnessSourceFile> {
    return this.commits.get(commitKey(repo, sha)) ?? new Map();
  }

  private async failureOf(method: HarnessSourceMethod): Promise<HostError | null> {
    await this.held;
    return this.failures.get(method)?.shift() ?? this.permanentFailure;
  }
}

/** A skipped file's content is never read, so any hash that's its own will do. */
const blobOf = async (file: string | HarnessSourceFile): Promise<BlobHash> =>
  typeof file === "string"
    ? gitBlobHash(file)
    : file.kind === "text"
      ? file.blob
      : gitBlobHash(file.reason);
