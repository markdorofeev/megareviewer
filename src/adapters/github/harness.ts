import type { z } from "zod";
import type {
  HarnessSource,
  HarnessSourceFile,
  HarnessSourceFolder,
} from "../../application/ports/index.ts";
import {
  type BlobHash,
  type HostError,
  MAX_HARNESS_FILE_BYTES,
  type RepoRef,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import { createGitHubClient, type GitHubClientOptions } from "./client.ts";
import { blobsQuery, rawFile } from "./github-host.ts";
import { GitHubHarnessBlobs, GitHubTree } from "./schemas.ts";

const BLOB_FIELDS = "oid byteSize text isBinary isTruncated";
/** As Collect reads a PR's files: on a slow link each connection is slow on its own. */
const FILES_PER_QUERY = 3;
const QUERIES_AT_ONCE = 6;
/** A blob that holds a path instead of text. */
const SYMLINK_MODE = "120000";

const TOO_LARGE = { kind: "skipped", reason: "too-large" } as const;
const UNREADABLE = { kind: "skipped", reason: "unreadable" } as const;

type Blob = NonNullable<GitHubHarnessBlobs["repository"][string]>;

/**
 * A repository's harness from GitHub: one request lists a commit's files with their hashes, so it
 * needn't say what changed between two.
 */
export const createGitHubHarnessSource = (options: GitHubClientOptions): HarnessSource => {
  const client = createGitHubClient(options);

  const fileOf = async (
    repo: RepoRef,
    sha: string,
    path: string,
    blob: Blob | null,
  ): Promise<Result<HarnessSourceFile | null, HostError>> => {
    if (blob === null || blob.__typename !== "Blob" || blob.oid === undefined) return ok(null);
    if ((blob.byteSize ?? 0) > MAX_HARNESS_FILE_BYTES) return ok(TOO_LARGE);
    if (blob.isBinary === true || typeof blob.text !== "string") return ok(UNREADABLE);
    if (blob.isTruncated !== true) return ok({ kind: "text", content: blob.text, blob: blob.oid });
    const whole = await rawFile(client, repo, { sha, path });
    if (!whole.ok) return whole;
    return ok(
      whole.value === null ? UNREADABLE : { kind: "text", content: whole.value, blob: blob.oid },
    );
  };

  const readQuery = async (
    repo: RepoRef,
    sha: string,
    paths: readonly string[],
  ): Promise<Result<(HarnessSourceFile | null)[], HostError>> => {
    const blobs = await client.read(`${paths.length} files`, GitHubHarnessBlobs, (request) =>
      client.octokit.graphql(blobsQuery(paths.length, BLOB_FIELDS), {
        owner: repo.owner,
        repo: repo.repo,
        ...Object.fromEntries(paths.map((path, i) => [`e${i}`, `${sha}:${path}`])),
        request,
      }),
    );
    if (!blobs.ok) return blobs;
    const files: (HarnessSourceFile | null)[] = [];
    for (const [i, path] of paths.entries()) {
      const file = await fileOf(repo, sha, path, blobs.value.repository[`f${i}`] ?? null);
      if (!file.ok) return file;
      files.push(file.value);
    }
    return ok(files);
  };

  /** A tree's files, at any depth, by their paths in it. */
  const treeOf = (what: string, repo: RepoRef, treeish: string) =>
    client.read(what, GitHubTree, async (request) => {
      // Octokit would encode a path's slashes, and takes `:name` in a route for a parameter.
      return (
        await client.octokit.request(`GET /repos/{owner}/{repo}/git/trees/${treeish}`, {
          owner: repo.owner,
          repo: repo.repo,
          recursive: "1",
          request,
        })
      ).data;
    });

  const filesOf = (tree: z.infer<typeof GitHubTree>["tree"]) =>
    tree.filter(({ type, mode }) => type === "blob" && mode !== SYMLINK_MODE);

  return {
    host: "github",

    async listFiles(repo, sha) {
      const listed = await treeOf("the files at a commit", repo, encodeURIComponent(sha));
      if (!listed.ok) return listed;
      // A partial list would read as a repository without the files it leaves out.
      if (listed.value.truncated) return ok(null);
      return ok(
        new Map<string, BlobHash>(
          filesOf(listed.value.tree).map((entry) => [entry.path, entry.sha]),
        ),
      );
    },

    async listFolder(repo, sha, path): Promise<Result<HarnessSourceFolder | null, HostError>> {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const listed = await treeOf(
        `the files in ${path}`,
        repo,
        `${encodeURIComponent(sha)}%3A${encoded}`,
      );
      // A path that's a file there is refused as no tree.
      if (!listed.ok) {
        return listed.error.kind === "not-found" || listed.error.kind === "rejected"
          ? ok(null)
          : listed;
      }
      const files = filesOf(listed.value.tree).map((entry) => `${path}/${entry.path}`);
      return ok(
        files.length === 0 && !listed.value.truncated
          ? null
          : { files, complete: !listed.value.truncated },
      );
    },

    async readFiles(repo, sha, paths) {
      const queries = Array.from({ length: Math.ceil(paths.length / FILES_PER_QUERY) }, (_, i) =>
        paths.slice(i * FILES_PER_QUERY, (i + 1) * FILES_PER_QUERY),
      );
      const files: (HarnessSourceFile | null)[] = [];
      for (let start = 0; start < queries.length; start += QUERIES_AT_ONCE) {
        const answers = await Promise.all(
          queries.slice(start, start + QUERIES_AT_ONCE).map((asked) => readQuery(repo, sha, asked)),
        );
        for (const answer of answers) {
          if (!answer.ok) return answer;
          files.push(...answer.value);
        }
      }
      return ok(files);
    },

    changedPaths: async () => ok(null),
  };
};
