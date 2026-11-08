import type {
  CheckoutError,
  CheckoutFile,
  LocalCheckout,
  LocalCheckouts,
} from "../../application/ports/index.ts";
import { MAX_CHECKOUT_FILE_BYTES } from "../../application/ports/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { reposOfRemotes, sameRepo } from "./remotes.ts";
import { type RunGit, runGit } from "./run-git.ts";

/** Only full or abbreviated SHAs reach git, so nothing passed can read as an option. */
const SHA = /^[0-9a-f]{4,64}$/;

const failed = (message: string): CheckoutError => ({ kind: "failed", message });

const decoder = new TextDecoder("utf-8");

/**
 * A LocalCheckout on the `git` command: `cat-file -e` for commits, `ls-tree` for files and one
 * `cat-file --batch` for many files. Nothing it runs fetches, checks out or writes.
 */
export const createGitCheckout = (options: {
  readonly dir: string;
  readonly run?: RunGit;
}): LocalCheckout => {
  const { dir } = options;
  const run = options.run ?? runGit;

  const hasCommit = async (sha: string): Promise<boolean> =>
    SHA.test(sha) && (await run(dir, ["cat-file", "-e", `${sha}^{commit}`])).code === 0;

  const atCommit = async <T>(
    sha: string,
    read: () => Promise<Result<T, CheckoutError>>,
  ): Promise<Result<T, CheckoutError>> =>
    (await hasCommit(sha))
      ? read()
      : err({ kind: "missing-commit", message: `The checkout doesn't have commit ${sha}` });

  return {
    hasCommit,

    listFiles: (sha) =>
      atCommit(sha, async () => {
        const listed = await run(dir, ["ls-tree", "-r", "-z", "--name-only", sha]);
        if (listed.code !== 0) return err(failed(`git ls-tree failed: ${listed.stderr}`));
        const paths = decoder.decode(listed.stdout).split("\0").filter(Boolean);
        return ok(paths.sort());
      }),

    readFiles: (sha, paths) =>
      atCommit(sha, async () => {
        // A path with a newline can't go through --batch, which reads one object name per line.
        const readable = paths.filter((path) => !path.includes("\n"));
        const names = readable.map((path) => `${sha}:${path}`);
        const checked = await run(
          dir,
          ["cat-file", "--batch-check=%(objecttype) %(objectsize)"],
          names.map((name) => `${name}\n`).join(""),
        );
        if (checked.code !== 0) return err(failed(`git cat-file failed: ${checked.stderr}`));
        const sizes = new Map<string, number>();
        const lines = decoder.decode(checked.stdout).split("\n");
        readable.forEach((path, at) => {
          const [type, size] = (lines[at] ?? "").split(" ");
          if (type === "blob" && size !== undefined) sizes.set(path, Number(size));
        });
        const wanted = readable.filter(
          (path) => (sizes.get(path) ?? Infinity) <= MAX_CHECKOUT_FILE_BYTES,
        );
        const contents = new Map<string, string>();
        if (wanted.length > 0) {
          const batch = await run(
            dir,
            ["cat-file", "--batch"],
            wanted.map((path) => `${sha}:${path}\n`).join(""),
          );
          if (batch.code !== 0) return err(failed(`git cat-file failed: ${batch.stderr}`));
          const parsed = parseBatch(batch.stdout, wanted.length);
          if (parsed === null) return err(failed("git cat-file gave output it couldn't parse"));
          wanted.forEach((path, at) => {
            const content = parsed[at];
            if (content !== undefined) contents.set(path, decoder.decode(content));
          });
        }
        return ok(
          paths.map((path): CheckoutFile => {
            const content = contents.get(path);
            if (content !== undefined) return { kind: "text", content };
            const size = sizes.get(path);
            return size !== undefined && size > MAX_CHECKOUT_FILE_BYTES
              ? { kind: "too-large" }
              : { kind: "unreadable" };
          }),
        );
      }),
  };
};

/**
 * `cat-file --batch` output: per object, "<oid> <type> <size>\n", the content and "\n", or
 * "<name> missing\n". Each object's content, or undefined when it's missing; null when the output
 * doesn't parse.
 */
const parseBatch = (out: Buffer, count: number): (Buffer | undefined)[] | null => {
  const objects: (Buffer | undefined)[] = [];
  let at = 0;
  while (objects.length < count) {
    const end = out.indexOf(0x0a, at);
    if (end === -1) return null;
    const header = out.subarray(at, end).toString("utf8");
    at = end + 1;
    const found = /^[0-9a-f]+ \w+ (\d+)$/.exec(header);
    if (found === null) {
      if (!header.endsWith(" missing") && !header.endsWith(" ambiguous")) return null;
      objects.push(undefined);
      continue;
    }
    const size = Number(found[1]);
    if (at + size > out.length) return null;
    objects.push(out.subarray(at, at + size));
    at += size + 1;
  }
  return objects;
};

/** A directory, if it's in a git checkout: the checkout's root and the repositories its remotes name. */
export interface CheckoutInfo {
  readonly root: string;
  readonly repos: readonly RepoRef[];
}

/** Null when `dir` isn't in a git checkout, or git isn't installed. */
export const inspectCheckout = async (
  dir: string,
  run: RunGit = runGit,
): Promise<CheckoutInfo | null> => {
  const root = await run(dir, ["rev-parse", "--show-toplevel"]);
  if (root.code !== 0) return null;
  const remotes = await run(dir, ["remote", "-v"]);
  return {
    root: root.stdout.toString("utf8").trim(),
    repos: remotes.code === 0 ? reposOfRemotes(remotes.stdout.toString("utf8")) : [],
  };
};

/**
 * The checkout at `dir`, for any repository: a commit pins a file's content, so a checkout that has
 * the PR's head commit can be read whatever its remotes say, such as a fork's, or one cloned
 * before its owner was renamed. The remotes say whether a missing commit is worth a `git fetch`.
 */
export const createGitCheckouts = (options: {
  readonly dir: string;
  readonly run?: RunGit;
}): LocalCheckouts => ({
  async find(repo) {
    const info = await inspectCheckout(options.dir, options.run);
    if (info === null) return null;
    return {
      checkout: createGitCheckout({ dir: info.root, run: options.run }),
      namesRepo: info.repos.some((known) => sameRepo(known, repo)),
    };
  },
});
