import { createHash } from "node:crypto";
import type { HarnessSource, HarnessSourceFile, Logger } from "../../application/ports/index.ts";
import {
  BlobHash,
  type HostError,
  MAX_HARNESS_FILE_BYTES,
  type RepoRef,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import { fileUrl, mapLimit, repoUrl, withQuery } from "./bitbucket-host.ts";
import { createBitbucketClient, MAX_PAGES } from "./client.ts";
import { BitbucketDiffstat, BitbucketPage } from "./schemas.ts";

export interface BitbucketHarnessOptions {
  readonly username: string;
  readonly password: string;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

/** As many as Collect's batches of a PR's files ask for together. */
const FILES_AT_ONCE = 18;
const DIFFSTAT_FIELDS = "next,values.old.path,values.new.path";
const DIFFSTAT_PAGE_SIZE = 500;

/** Git's hash of a file, which Bitbucket's API gives nowhere. */
const gitBlobHash = (bytes: Uint8Array): BlobHash =>
  BlobHash.parse(
    createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex"),
  );

/**
 * The new commit goes first: the differences are from the second to the first. Without
 * `topic=false` they'd be from where the two commits diverged.
 */
export const diffstatUrl = (repo: RepoRef, fromSha: string, toSha: string): string =>
  withQuery(`${repoUrl(repo)}/diffstat/${toSha}..${fromSha}`, {
    topic: "false",
    pagelen: String(DIFFSTAT_PAGE_SIZE),
    fields: DIFFSTAT_FIELDS,
  });

/**
 * A repository's harness from Bitbucket: its listings have no hashes, so it says what changed
 * between two commits instead, and hashes what it reads.
 */
export const createBitbucketHarnessSource = (options: BitbucketHarnessOptions): HarnessSource => {
  const client = createBitbucketClient({
    username: options.username,
    password: options.password,
    logger: options.logger,
    fetch: options.fetch ?? globalThis.fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  const readFile = async (
    repo: RepoRef,
    sha: string,
    path: string,
  ): Promise<Result<HarnessSourceFile | null, HostError>> => {
    const file = await client.raw(fileUrl(repo, sha, path), "*/*", MAX_HARNESS_FILE_BYTES);
    if (!file.ok) {
      if (file.error.kind === "not-found") return ok(null);
      return file.error.kind === "too-large" ? ok({ kind: "skipped", reason: "too-large" }) : file;
    }
    const { contentType, bytes } = file.value;
    // A directory's listing is JSON; a file comes as text or binary, a .json file too.
    if (contentType.startsWith("application/json")) return ok(null);
    if (bytes === null) return ok({ kind: "skipped", reason: "too-large" });
    if (bytes.includes(0)) return ok({ kind: "skipped", reason: "unreadable" });
    return ok({
      kind: "text",
      content: new TextDecoder().decode(bytes),
      blob: gitBlobHash(bytes),
    });
  };

  return {
    host: "bitbucket",

    listFiles: async () => ok(null),

    async readFiles(repo, sha, paths) {
      const read = await mapLimit(paths, FILES_AT_ONCE, (path) => readFile(repo, sha, path));
      const files: (HarnessSourceFile | null)[] = [];
      for (const file of read) {
        if (!file.ok) return file;
        files.push(file.value);
      }
      return ok(files);
    },

    async changedPaths(repo, fromSha, toSha) {
      const changed = new Set<string>();
      let next: string | undefined = diffstatUrl(repo, fromSha, toSha);
      for (let count = 0; next !== undefined; count += 1) {
        if (count === MAX_PAGES) return ok(null);
        const page: Result<{ values: BitbucketDiffstat[]; next?: string | undefined }, HostError> =
          await client.json("the changed files", BitbucketPage(BitbucketDiffstat), next);
        // Too large for Bitbucket to produce is as good as past the last page.
        if (!page.ok) return page.error.kind === "too-large" ? ok(null) : page;
        for (const file of page.value.values) {
          for (const side of [file.old, file.new]) if (side != null) changed.add(side.path);
        }
        next = page.value.next;
      }
      return ok([...changed]);
    },
  };
};
