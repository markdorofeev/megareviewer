import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Clock,
  DownloadError,
  Logger,
  RepositoryCopies,
  RepositoryCopy,
} from "../../application/ports/index.ts";
import { HostKind, type RepoRef } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { type Folders, nodeFolders } from "./folders.ts";
import { createGitCheckout } from "./git-checkout.ts";
import { GIT_NEEDED, gitVersion, isNewEnough } from "./git-version.ts";
import {
  downloadEnv,
  type GitRemote,
  HOST_NAMES,
  type RemoteFor,
  withoutCredentials,
} from "./remote.ts";
import { type RunDownload, runDownload } from "./run-download.ts";
import { type GitOutput, type RunGit, runGit } from "./run-git.ts";

const TIMEOUT_MS = 10 * 60 * 1000;
/** `git gc` cleans up after this many packs: each download adds one. */
const MAX_PACKS = 5;
/** Only whole SHAs, which is what a ref of ours and a fetch by SHA need. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NAME = /^[A-Za-z0-9._-]+$/;
/** When the copy was last read, kept in it. */
const LAST_READ = "megareviewer-last-read";

/** The name that keeps a commit in a copy, and tells the host the copy has it. */
const refOf = (sha: string): string => `refs/megareviewer/${sha}`;

/** A copy on this machine, for `doctor`. */
export interface CopyInfo {
  readonly repo: RepoRef;
  readonly dir: string;
  readonly bytes: number;
  readonly lastReadAt: string | null;
}

export interface GitRepositoryCopies extends RepositoryCopies {
  list(): Promise<readonly CopyInfo[]>;
  /** Resolves once no download is running, such as after they were stopped. */
  settled(): Promise<void>;
}

/** Null for a name no host has, which can't be put in a path. */
const dirOf = (folder: string, { host, owner, repo }: RepoRef): string | null =>
  [owner, repo].every((name) => NAME.test(name) && name !== "." && name !== "..")
    ? join(folder, host, owner.toLowerCase(), `${repo.toLowerCase()}.git`)
    : null;

/** git's own words, without the lines that only say where it was. */
const reasonIn = (stderr: string): string => {
  const line = stderr.split("\n").find((one) => /^(?:fatal|error): /.test(one)) ?? stderr;
  return line.replace(/^(?:fatal|error): /, "").slice(0, 200);
};

/** What the host itself said, such as that a token has to be authorized for an organization. */
const saidByHost = (stderr: string): string | null => {
  const lines = stderr
    .split("\n")
    .flatMap((line) => /^remote: (.*\S)\s*$/.exec(line)?.[1] ?? [])
    .filter((line) => !/^(?:Enumerating|Counting|Compressing|Total) /.test(line));
  return lines.length === 0 ? null : lines.join(" ").slice(0, 300);
};

const REFUSED_FIX: Readonly<Record<HostKind, string>> = {
  github: "Check that the GitHub token can read this repository's contents.",
  bitbucket: "Check that the Bitbucket API token has the scope read:repository:bitbucket.",
};

/** Why git didn't download the commit, from what it printed. */
const failureOf = (repo: RepoRef, sha: string, dir: string, stderr: string): DownloadError => {
  const host = HOST_NAMES[repo.host];
  const name = `${repo.owner}/${repo.repo}`;
  if (/\.lock': File exists/.test(stderr)) {
    // Another megareviewer's download, or one that was killed and couldn't take its lock away.
    return {
      kind: "failed",
      message: `Another download into ${dir} is going, or was cut off. If none is, delete that folder.`,
    };
  }
  if (/not our ref|couldn't find remote ref/.test(stderr)) {
    return {
      kind: "missing-commit",
      message: `${host} doesn't have commit ${sha.slice(0, 7)} of ${name} any more. Its branch may have been force-pushed or deleted.`,
    };
  }
  if (/returned error: 30[1278]/.test(stderr)) {
    return {
      kind: "failed",
      message: `${name} has moved on ${host}. Open the pull request from the repository's new address.`,
    };
  }
  if (
    /could not read (?:Username|Password)|Authentication failed|returned error: (?:401|403|404)|[Rr]epository .*not found/.test(
      stderr,
    )
  ) {
    const said = saidByHost(stderr);
    return {
      kind: "refused",
      message: `${host} didn't let megareviewer download ${name}${said === null ? "." : `: ${said.replace(/\.$/, "")}.`} ${REFUSED_FIX[repo.host]}`,
    };
  }
  return { kind: "failed", message: `git couldn't download ${name}: ${reasonIn(stderr)}.` };
};

const STOPPED: DownloadError = { kind: "stopped", message: "megareviewer was stopped." };

const bytesIn = async (dir: string): Promise<number> => {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    // git may remove a file while its folder is being listed.
    if (entry.isFile()) {
      bytes += await stat(join(entry.parentPath, entry.name)).then(
        ({ size }) => size,
        () => 0,
      );
    }
  }
  return bytes;
};

/**
 * megareviewer's own copies of repositories, `<folder>/<host>/<owner>/<repo>.git`: bare, so git runs
 * no hook, filter or submodule in them, and holding only the commits downloaded, each by a ref. A
 * commit is in a copy when its ref is, which git makes once everything it needs is there. Without
 * the refs git would tell the host it has nothing, and download everything for the next commit.
 */
export const createRepositoryCopies = (options: {
  readonly folder: string;
  /** Whether commits are downloaded. Copies already there are read either way. */
  readonly on: boolean;
  readonly remoteFor: RemoteFor;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Aborted when megareviewer stops, which stops the downloads. */
  readonly signal: AbortSignal;
  readonly run?: RunDownload;
  readonly read?: RunGit;
  readonly folders?: Folders;
  /** The one protocol git may use: "file" in tests. */
  readonly protocol?: string;
  readonly env?: NodeJS.ProcessEnv;
}): GitRepositoryCopies => {
  const { folder, on, remoteFor, clock, logger, signal } = options;
  const run = options.run ?? runDownload;
  const folders = options.folders ?? nodeFolders;
  const protocol = options.protocol ?? "https";
  const env = options.env ?? process.env;
  const readGit = options.read ?? runGit;
  // Named, so a reviewer's `safe.bareRepository` setting doesn't stop git reading the copy.
  const read: RunGit = (dir, args, input) => readGit(dir, ["--git-dir=.", ...args], input);

  /** Downloads going, per repository and commit. */
  const running = new Map<string, Promise<Result<RepositoryCopy, DownloadError>>>();
  /** The last thing happening to each copy, so one at a time does. */
  const tails = new Map<string, Promise<void>>();

  const git = (
    args: readonly string[],
    remote: GitRemote | null,
    until: AbortSignal,
  ): Promise<GitOutput> =>
    run({ args, env: downloadEnv({ env, home: folder, remote, protocol }), signal: until });

  /** Aborted when megareviewer stops, or once the time is up. */
  const limited = (): { readonly signal: AbortSignal; readonly timedOut: () => boolean } => {
    const timeout = new AbortController();
    void clock.wait(TIMEOUT_MS).then(() => timeout.abort());
    return {
      signal: AbortSignal.any([signal, timeout.signal]),
      timedOut: () => timeout.signal.aborted,
    };
  };

  const markRead = (dir: string): Promise<void> => writeFile(join(dir, LAST_READ), clock.now());

  const holds = async (dir: string, sha: string): Promise<boolean> =>
    SHA.test(sha) && (await read(dir, ["cat-file", "-e", `${refOf(sha)}^{commit}`])).code === 0;

  const copyWith = async (dir: string, sha: string): Promise<RepositoryCopy | null> => {
    const kept = await folders.readText(join(dir, LAST_READ));
    if (kept === null || !(await holds(dir, sha))) return null;
    await markRead(dir);
    return { checkout: createGitCheckout({ dir, run: read }), dir };
  };

  const packs = async (dir: string): Promise<readonly string[]> =>
    (await folders.list(join(dir, "objects", "pack"))).map((entry) => entry.name);

  /** Why this git can't download, or null. */
  const gitProblem = async (until: AbortSignal): Promise<string | null> => {
    const version = await gitVersion(
      run,
      downloadEnv({ env, home: folder, remote: null, protocol }),
      until,
    );
    if (version === null)
      return `git isn't installed, or isn't on the PATH. Install it, ${GIT_NEEDED} or newer.`;
    return isNewEnough(version)
      ? null
      : `git ${version} is too old to download with. Install ${GIT_NEEDED} or newer.`;
  };

  const fetchCommit = async (
    repo: RepoRef,
    sha: string,
    dir: string,
    remote: GitRemote,
  ): Promise<Result<RepositoryCopy, DownloadError>> => {
    const limit = limited();
    const had = await folders.readText(join(dir, LAST_READ));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await markRead(dir);
    const problem = await gitProblem(limit.signal);
    if (problem !== null && !limit.signal.aborted) {
      return err({ kind: "no-git", message: problem });
    }
    const made = await git(["init", "--bare", "--quiet", "--template=", dir], null, limit.signal);
    const before = new Set(await packs(dir));
    const fetched =
      made.code !== 0
        ? made
        : await git(
            [
              `--git-dir=${dir}`,
              "fetch",
              "--depth=1",
              "--no-tags",
              "--no-write-fetch-head",
              "--no-recurse-submodules",
              "--no-progress",
              "--",
              remote.url,
              `+${sha}:${refOf(sha)}`,
            ],
            remote,
            limit.signal,
          );
    const copy = fetched.code === 0 ? await copyWith(dir, sha) : null;
    if (copy !== null) return ok(copy);

    // A download cut off leaves its half-made pack, as large as what had arrived.
    if (had === null) await rm(dir, { recursive: true, force: true });
    else {
      for (const name of await packs(dir)) {
        if (name.startsWith("tmp_") && !before.has(name)) {
          await rm(join(dir, "objects", "pack", name), { force: true });
        }
      }
    }
    if (signal.aborted) return err(STOPPED);
    if (limit.timedOut()) {
      return err({
        kind: "timed-out",
        message: `Downloading ${repo.owner}/${repo.repo} took longer than 10 minutes, so it was stopped. Clone the repository and start megareviewer in the clone instead.`,
      });
    }
    return err(failureOf(repo, sha, dir, withoutCredentials(fetched.stderr, remote)));
  };

  /** Packs its downloads together, once there are more than a few. */
  const tidy = async (dir: string): Promise<void> => {
    const count = (await packs(dir)).filter((name) => name.endsWith(".pack")).length;
    if (count <= MAX_PACKS || signal.aborted) return;
    const cleaned = await git([`--git-dir=${dir}`, "gc", "--quiet"], null, limited().signal);
    if (cleaned.code !== 0 && !signal.aborted) {
      logger.warn("Couldn't clean up a repository's copy", { dir, error: cleaned.stderr });
    }
  };

  const start = async (
    repo: RepoRef,
    sha: string,
    dir: string,
    remote: GitRemote,
  ): Promise<Result<RepositoryCopy, DownloadError>> => {
    if (signal.aborted) return err(STOPPED);
    const has = await copyWith(dir, sha);
    if (has !== null) return ok(has);
    const from = Date.parse(clock.now());
    const fields = { repo: `${repo.host}/${repo.owner}/${repo.repo}`, sha };
    logger.info("Downloading a commit", fields);
    try {
      const result = await fetchCommit(repo, sha, dir, remote);
      const durationMs = Date.parse(clock.now()) - from;
      if (result.ok) logger.info("Downloaded a commit", { ...fields, durationMs });
      else {
        const { kind, message: reason } = result.error;
        const log = kind === "stopped" ? logger.info : logger.warn;
        log.call(logger, "Couldn't download a commit", { ...fields, durationMs, kind, reason });
      }
      return result;
    } catch (error) {
      // The folder can't be written: a full disk, or permissions.
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Couldn't write a repository's copy", { ...fields, error });
      return err({
        kind: "failed",
        message: `megareviewer couldn't write its copy of ${repo.owner}/${repo.repo}: ${message}.`,
      });
    }
  };

  const copiesOnDisk = async (): Promise<Omit<CopyInfo, "bytes">[]> => {
    const found: Omit<CopyInfo, "bytes">[] = [];
    const inside = async (dir: string) =>
      (await folders.list(dir)).filter((entry) => entry.kind === "folder");
    for (const host of HostKind.options) {
      for (const owner of await inside(join(folder, host))) {
        for (const entry of await inside(join(folder, host, owner.name))) {
          if (!entry.name.endsWith(".git")) continue;
          const dir = join(folder, host, owner.name, entry.name);
          found.push({
            repo: { host, owner: owner.name, repo: entry.name.slice(0, -".git".length) },
            dir,
            lastReadAt: await folders.readText(join(dir, LAST_READ)),
          });
        }
      }
    }
    return found;
  };

  return {
    downloadFolder: on ? folder : null,

    async find(repo, sha) {
      const dir = dirOf(folder, repo);
      return dir === null ? null : copyWith(dir, sha);
    },

    async download(repo, sha) {
      if (!on) {
        return err({ kind: "off", message: "megareviewer was started with --no-download." });
      }
      const name = `${repo.owner}/${repo.repo}`;
      const dir = dirOf(folder, repo);
      if (dir === null || !SHA.test(sha)) {
        return err({ kind: "failed", message: `${name} at ${sha} can't be downloaded.` });
      }
      const remote = remoteFor(repo);
      if (remote === null) {
        return err({
          kind: "no-credentials",
          message: `megareviewer has no ${HOST_NAMES[repo.host]} credentials.`,
        });
      }
      const key = `${dir}@${sha}`;
      const going = running.get(key);
      if (going !== undefined) return going;
      const previous = tails.get(dir) ?? Promise.resolve();
      const download = previous.then(() => start(repo, sha, dir, remote));
      running.set(key, download);
      // The copy is cleaned up after the answer: whoever asked doesn't wait for it.
      const tail = download
        .then((result) => (result.ok ? tidy(dir) : undefined))
        .catch((error: unknown) => {
          logger.warn("Couldn't clean up a repository's copy", { dir, error });
        })
        .finally(() => {
          if (tails.get(dir) === tail) tails.delete(dir);
        });
      tails.set(dir, tail);
      return download.finally(() => running.delete(key));
    },

    async forget(olderThan) {
      let forgotten = 0;
      for (const { dir, lastReadAt } of await copiesOnDisk()) {
        if (lastReadAt !== null && lastReadAt >= olderThan) continue;
        await rm(dir, { recursive: true, force: true });
        logger.info("Removed a repository's copy that wasn't read for a while", {
          dir,
          lastReadAt,
        });
        forgotten += 1;
      }
      return forgotten;
    },

    async list() {
      const found: CopyInfo[] = [];
      for (const copy of await copiesOnDisk()) {
        found.push({ ...copy, bytes: await bytesIn(copy.dir) });
      }
      return found;
    },

    async settled() {
      await Promise.all(tails.values());
    },
  };
};
