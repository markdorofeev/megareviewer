import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import type { InputHarness } from "../../../application/ports/index.ts";

const PREFIX = "megareviewer-harness-";

const writeFiles = async (dir: string, files: ReadonlyMap<string, string>): Promise<void> => {
  for (const [name, content] of files) {
    const path = join(dir, name);
    if (!path.startsWith(dir + sep)) throw new Error(`${name} isn't in the directory`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Never over another: two paths can be one file where case doesn't count.
    await writeFile(path, content, { mode: 0o600, flag: "wx" });
  }
};

interface Shared {
  path: string | null;
  /** It's there, and ours to remove. */
  made: boolean;
  passes: number;
  ready: Promise<string> | null;
  removed: Promise<void>;
}

export interface HarnessDirectories {
  /** Runs `task` in the directory of a run's harness files; rejects when they can't be written. */
  use<T>(harness: InputHarness, task: (dir: string) => Promise<T>): Promise<T>;
}

/**
 * One directory for each run's harness, which its passes share: opencode puts the directory's path
 * ahead of the PR, so passes in two directories would share no cache. Nothing says when a run
 * starts or ends, so the files are there only while one of its passes runs, and a later pass has
 * them written again at the same path.
 */
export const createHarnessDirectories = (): HarnessDirectories => {
  const directories = new WeakMap<InputHarness, Shared>();

  const make = async (shared: Shared, harness: InputHarness): Promise<string> => {
    await shared.removed;
    // The path is known once it was used, so it's made again only where nothing is.
    if (shared.path === null) shared.path = await realpath(await mkdtemp(join(tmpdir(), PREFIX)));
    else await mkdir(shared.path, { mode: 0o700 });
    shared.made = true;
    await writeFiles(shared.path, harness.contents);
    return shared.path;
  };

  const remove = async (shared: Shared, ready: Promise<string>): Promise<void> => {
    await ready.catch(() => null);
    if (shared.path === null || !shared.made) return;
    await rm(shared.path, { recursive: true, force: true });
    shared.made = false;
  };

  return {
    async use(harness, task) {
      const shared = directories.get(harness) ?? {
        path: null,
        made: false,
        passes: 0,
        ready: null,
        removed: Promise.resolve(),
      };
      directories.set(harness, shared);
      shared.passes += 1;
      shared.ready ??= make(shared, harness);
      const { ready } = shared;
      try {
        return await task(await ready);
      } finally {
        shared.passes -= 1;
        if (shared.passes === 0) {
          shared.ready = null;
          shared.removed = remove(shared, ready);
          await shared.removed;
        }
      }
    },
  };
};
