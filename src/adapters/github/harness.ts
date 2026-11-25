import type { HarnessSource, HarnessSourceFile } from "../../application/ports/index.ts";
import {
  type BlobHash,
  type HostError,
  MAX_HARNESS_FILE_BYTES,
  type RepoRef,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import { createGitHubClient, type GitHubClientOptions } from "./client.ts";
import { blobsQuery, FILES_PER_QUERY, rawFile } from "./github-host.ts";
import { GitHubHarnessBlobs, GitHubTree } from "./schemas.ts";

const BLOB_FIELDS = "oid byteSize text isBinary isTruncated";
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

  return {
    host: "github",

    async listFiles(repo, sha) {
      const listed = await client.read("the files at a commit", GitHubTree, async (request) => {
        return (
          await client.octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
            owner: repo.owner,
            repo: repo.repo,
            tree_sha: sha,
            recursive: "1",
            request,
          })
        ).data;
      });
      if (!listed.ok) return listed;
      // A partial list would read as a repository without the files it leaves out.
      if (listed.value.truncated) return ok(null);
      return ok(
        new Map<string, BlobHash>(
          listed.value.tree
            .filter(({ type, mode }) => type === "blob" && mode !== SYMLINK_MODE)
            .map((entry) => [entry.path, entry.sha]),
        ),
      );
    },

    async readFiles(repo, sha, paths) {
      const files: (HarnessSourceFile | null)[] = [];
      for (let start = 0; start < paths.length; start += FILES_PER_QUERY) {
        const chunk = paths.slice(start, start + FILES_PER_QUERY);
        const blobs = await client.read(`${chunk.length} files`, GitHubHarnessBlobs, (request) =>
          client.octokit.graphql(blobsQuery(chunk.length, BLOB_FIELDS), {
            owner: repo.owner,
            repo: repo.repo,
            ...Object.fromEntries(chunk.map((path, i) => [`e${i}`, `${sha}:${path}`])),
            request,
          }),
        );
        if (!blobs.ok) return blobs;
        for (const [i, path] of chunk.entries()) {
          const file = await fileOf(repo, sha, path, blobs.value.repository[`f${i}`] ?? null);
          if (!file.ok) return file;
          files.push(file.value);
        }
      }
      return ok(files);
    },

    changedPaths: async () => ok(null),
  };
};
