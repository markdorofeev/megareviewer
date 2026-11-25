import { basename, join, relative, sep } from "node:path";
import type { Clock, Logger } from "../../application/ports/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
import { type FolderEntry, type Folders, nodeFolders } from "./folders.ts";
import { reposOfConfig, sameRepo } from "./remotes.ts";
import { foldersNamed, type RunSpotlight, runSpotlight } from "./spotlight.ts";

/** How many folders below the home folder a clone can be. */
export const MAX_DEPTH = 6;
export const MAX_CLONES = 2000;
export const MAX_WALK_MS = 2000;
/** A lookup that finds nothing walks again, at most this often. */
export const WALK_AGAIN_MS = 60_000;

/** A folder with a `.git` folder in it, and the repositories its remotes name. */
export interface Clone {
  readonly dir: string;
  readonly repos: readonly RepoRef[];
}

export interface Walk {
  readonly clones: readonly Clone[];
  /** Why it stopped before it had seen everything; null when it hadn't to. */
  readonly stopped: "time" | "clones" | null;
}

/** Finds the clones in the home folder. */
export interface CloneSearch {
  readonly home: string;
  /** The latest walk's result; the first call walks. */
  walked(): Promise<Walk>;
  /** The clones that could be the repository's, those whose remotes name it first. */
  find(repo: RepoRef): Promise<readonly Clone[]>;
}

/** Nobody keeps a clone here, and they can hold more folders than the rest together. */
const SKIPPED = new Set(["Library", "node_modules"]);
/** macOS asks the reviewer before a program may open these. Spotlight finds what's in them. */
const SKIPPED_AT_TOP = new Set([
  "Documents",
  "Desktop",
  "Downloads",
  "Pictures",
  "Music",
  "Movies",
]);

const opens = (name: string, depth: number): boolean =>
  !name.startsWith(".") && !SKIPPED.has(name) && !(depth === 0 && SKIPPED_AT_TOP.has(name));

const byName = (a: FolderEntry, b: FolderEntry): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Folders opened at once. */
const BATCH = 64;

const cloneAt = async (dir: string, folders: Folders): Promise<Clone> => {
  const config = await folders.readText(join(dir, ".git", "config"));
  return { dir, repos: config === null ? [] : reposOfConfig(config) };
};

/**
 * The clones under `home`, nearest first. A clone isn't searched for more, nor is a worktree, whose
 * `.git` is a file: its clone is found on its own. The home folder itself is always searched, since
 * some keep their settings in a repository there.
 */
const walk = async (home: string, folders: Folders, clock: Clock): Promise<Walk> => {
  const clones: Clone[] = [];
  const state: { stopped: Walk["stopped"] } = { stopped: null };
  const visit = async (): Promise<void> => {
    let level: readonly string[] = [home];
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
      const below: string[] = [];
      for (let start = 0; start < level.length; start += BATCH) {
        const visited = await Promise.all(
          level.slice(start, start + BATCH).map(async (dir) => {
            const entries = [...(await folders.list(dir))].sort(byName);
            const git = depth === 0 ? undefined : entries.find((entry) => entry.name === ".git");
            return {
              clone: git?.kind === "folder" ? await cloneAt(dir, folders) : null,
              below:
                git === undefined
                  ? entries.flatMap(({ name, kind }) =>
                      kind === "folder" && opens(name, depth) ? [join(dir, name)] : [],
                    )
                  : [],
            };
          }),
        );
        for (const one of visited) {
          if (state.stopped !== null) return;
          if (one.clone !== null && clones.length === MAX_CLONES) {
            state.stopped = "clones";
            return;
          }
          if (one.clone !== null) clones.push(one.clone);
          below.push(...one.below);
        }
      }
      level = below;
    }
  };
  // Raced, so a folder that never answers, as on a server that's gone, can't hold it past the cap.
  const expired = clock.wait(MAX_WALK_MS).then(() => {
    state.stopped ??= "time";
  });
  await Promise.race([visit(), expired]);
  return { clones: [...clones], stopped: state.stopped };
};

export const createCloneSearch = (options: {
  readonly home: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly folders?: Folders;
  readonly platform?: NodeJS.Platform;
  readonly spotlight?: RunSpotlight;
}): CloneSearch => {
  const { home, clock, logger } = options;
  const folders = options.folders ?? nodeFolders;
  const platform = options.platform ?? process.platform;
  const spotlight = options.spotlight ?? runSpotlight;
  let latest: { readonly startedAt: number; readonly result: Promise<Walk> } | null = null;

  const walkNow = (): Promise<Walk> => {
    const result = walk(home, folders, clock).then((walked) => {
      const fields = { clones: walked.clones.length };
      if (walked.stopped === null) logger.debug("Searched the home folder for clones", fields);
      else logger.warn(`The search for clones stopped early: ${stoppedReason(walked)}`, fields);
      return walked;
    });
    latest = { startedAt: Date.parse(clock.now()), result };
    return result;
  };
  const walked = (): Promise<Walk> => latest?.result ?? walkNow();
  /** The walk after `seen`, made now if it's due and nothing else has made one; else `seen`. */
  const walkedSince = (seen: Promise<Walk>): Promise<Walk> =>
    latest?.result === seen && Date.parse(clock.now()) - latest.startedAt >= WALK_AGAIN_MS
      ? walkNow()
      : walked();

  const namesRepo = (clone: Clone, repo: RepoRef): boolean =>
    clone.repos.some((known) => sameRepo(known, repo));
  const couldBe = (clones: readonly Clone[], repo: RepoRef): readonly Clone[] => {
    const named = clones.filter((clone) => namesRepo(clone, repo));
    const namesakes = clones.filter(
      (clone) =>
        !named.includes(clone) && basename(clone.dir).toLowerCase() === repo.repo.toLowerCase(),
    );
    return [...named, ...namesakes];
  };

  const inSpotlight = async (repo: RepoRef): Promise<readonly Clone[]> => {
    if (platform !== "darwin") return [];
    const dirs = (await foldersNamed(repo.repo, home, spotlight)).filter(
      (dir) => !relative(home, dir).split(sep).includes("Library"),
    );
    const found = await Promise.all(
      dirs.map(async (dir) =>
        (await folders.list(dir)).some((entry) => entry.name === ".git" && entry.kind === "folder")
          ? [await cloneAt(dir, folders)]
          : [],
      ),
    );
    return couldBe(found.flat(), repo);
  };

  return {
    home,
    walked,
    async find(repo) {
      const first = walked();
      const found = couldBe((await first).clones, repo);
      if (found.length > 0) return found;
      const again = couldBe((await walkedSince(first)).clones, repo);
      return again.length > 0 ? again : inSpotlight(repo);
    },
  };
};

/** Why a walk stopped early, in words; only for one that did. */
export const stoppedReason = ({ stopped }: Walk): string =>
  stopped === "clones"
    ? `it found ${MAX_CLONES.toLocaleString("en-US")} clones`
    : `it took ${MAX_WALK_MS / 1000} seconds`;
