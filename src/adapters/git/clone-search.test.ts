import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FixedClock, RecordingLogger } from "../../application/testing/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
import {
  createCloneSearch,
  MAX_CLONES,
  MAX_WALK_MS,
  stoppedReason,
  WALK_AGAIN_MS,
} from "./clone-search.ts";
import { type Folders, nodeFolders } from "./folders.ts";
import type { RunSpotlight } from "./spotlight.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const newHome = (): string => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "megareviewer-home-")));
  made.push(home);
  return home;
};

const folder = (home: string, path: string): string => {
  const dir = join(home, path);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** A folder with a `.git` folder, whose config names the remote. No git is needed for the walk. */
const clone = (home: string, path: string, remote?: string): string => {
  const dir = folder(home, path);
  mkdirSync(join(dir, ".git"));
  const config = remote === undefined ? "" : `[remote "origin"]\n\turl = ${remote}\n`;
  writeFileSync(join(dir, ".git", "config"), config);
  return dir;
};

const setup = (
  home: string,
  options: {
    folders?: Folders;
    platform?: NodeJS.Platform;
    spotlight?: (query: readonly string[]) => string | null;
  } = {},
) => {
  const clock = new FixedClock("2026-11-25T10:00:00.000Z");
  const logger = new RecordingLogger();
  /** Every folder opened, relative to the home folder. */
  const opened: string[] = [];
  const asked: (readonly string[])[] = [];
  const inner = options.folders ?? nodeFolders;
  const spotlight: RunSpotlight = async (args) => {
    asked.push(args);
    return options.spotlight?.(args) ?? null;
  };
  const search = createCloneSearch({
    home,
    clock,
    logger,
    platform: options.platform ?? "linux",
    spotlight,
    folders: {
      list: (dir) => {
        opened.push(relative(home, dir));
        return inner.list(dir);
      },
      readText: (path) => inner.readText(path),
    },
  });
  const found = async () => (await search.walked()).clones.map(({ dir }) => relative(home, dir));
  return { search, clock, logger, opened, asked, found };
};

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };

describe("the walk", () => {
  it("finds a clone 6 folders down, and opens none 7 down", async () => {
    const home = newHome();
    clone(home, "1/2/3/4/5/shop");
    clone(home, "1/2/3/4/5/6/deeper");
    const { found, opened } = setup(home);
    expect(await found()).toEqual(["1/2/3/4/5/shop"]);
    expect(opened).toContain("1/2/3/4/5/6");
    expect(opened).not.toContain("1/2/3/4/5/6/deeper");
  });

  it("finds the nearest clones first", async () => {
    const home = newHome();
    clone(home, "a/b/one");
    clone(home, "two");
    expect(await setup(home).found()).toEqual(["two", "a/b/one"]);
  });

  it("doesn't search a clone for more clones", async () => {
    const home = newHome();
    clone(home, "shop");
    clone(home, "shop/vendor/lib");
    const { found, opened } = setup(home);
    expect(await found()).toEqual(["shop"]);
    expect(opened).not.toContain("shop/vendor");
  });

  it("finds no clone in a worktree, whose .git is a file, and doesn't search it", async () => {
    const home = newHome();
    clone(home, "shop");
    writeFileSync(join(folder(home, "shop-fix"), ".git"), "gitdir: ../shop/.git/worktrees/fix\n");
    folder(home, "shop-fix/src");
    const { found, opened } = setup(home);
    expect(await found()).toEqual(["shop"]);
    expect(opened).not.toContain("shop-fix/src");
  });

  it("searches a home folder that is a repository itself", async () => {
    const home = newHome();
    mkdirSync(join(home, ".git"));
    clone(home, "shop");
    expect(await setup(home).found()).toEqual(["shop"]);
  });

  it("follows no symlink, so a loop ends", async () => {
    const home = newHome();
    const elsewhere = newHome();
    clone(elsewhere, "linked");
    folder(home, "code");
    symlinkSync(home, join(home, "code", "loop"));
    symlinkSync(elsewhere, join(home, "code", "elsewhere"));
    const { found, opened } = setup(home);
    expect(await found()).toEqual([]);
    expect(opened.sort()).toEqual(["", "code"]);
  });

  it.each([
    "Library/shop",
    "work/Library/shop",
    ".cache/shop",
    "work/.hidden/shop",
    "work/node_modules/shop",
    "Documents/shop",
    "Desktop/shop",
    "Downloads/shop",
    "Pictures/shop",
    "Music/shop",
    "Movies/shop",
  ])("never opens %s", async (path) => {
    const home = newHome();
    clone(home, path);
    clone(home, "work/app");
    const { found, opened } = setup(home);
    expect(await found()).toEqual(["work/app"]);
    expect(opened.sort()).toEqual(["", "work", "work/app"]);
  });

  it("opens a folder named Documents below the top", async () => {
    const home = newHome();
    clone(home, "work/Documents/shop");
    expect(await setup(home).found()).toEqual(["work/Documents/shop"]);
  });

  it("goes on past a folder it can't open, and a .git folder without a config", async () => {
    const home = newHome();
    folder(home, "shop/.git");
    const { search } = setup(home, {
      folders: {
        list: async (dir) =>
          dir === home
            ? [
                { name: "gone", kind: "folder" },
                { name: "shop", kind: "folder" },
              ]
            : nodeFolders.list(dir),
        readText: nodeFolders.readText,
      },
    });
    expect(await search.walked()).toEqual({
      clones: [{ dir: join(home, "shop"), repos: [] }],
      stopped: null,
    });
  });

  it("stops after 2,000 clones, and says so", async () => {
    const names = Array.from({ length: MAX_CLONES + 1 }, (_, at) => `c${at}`);
    const { search, logger } = setup("/home/lee", {
      folders: {
        list: async (dir) =>
          dir === "/home/lee"
            ? names.map((name) => ({ name, kind: "folder" }))
            : [{ name: ".git", kind: "folder" }],
        readText: async () => null,
      },
    });
    const walk = await search.walked();
    expect(walk.clones).toHaveLength(MAX_CLONES);
    expect(walk.stopped).toBe("clones");
    expect(stoppedReason(walk)).toBe("it found 2,000 clones");
    expect(logger.entries.filter(({ level }) => level === "warn")).toEqual([
      expect.objectContaining({
        message: "The search for clones stopped early: it found 2,000 clones",
      }),
    ]);
  });

  it("stops after 2 seconds, with what it found, when a folder never answers", async () => {
    const home = newHome();
    const shop = clone(home, "shop");
    const app = clone(home, "work/app");
    folder(home, "server");
    const { promise: rest, resolve: openedRest } = Promise.withResolvers<void>();
    const unread = new Set([shop, app].map((dir) => join(dir, ".git", "config")));
    const { search, clock } = setup(home, {
      folders: {
        list: (dir) =>
          dir === join(home, "server") ? new Promise(() => {}) : nodeFolders.list(dir),
        async readText(path) {
          const text = await nodeFolders.readText(path);
          unread.delete(path);
          if (unread.size === 0) openedRest();
          return text;
        },
      },
    });
    const walking = search.walked();
    await rest;
    // Both configs are read; let the walk take them in.
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(MAX_WALK_MS);
    const walk = await walking;
    expect(walk.stopped).toBe("time");
    expect(walk.clones.map(({ dir }) => dir)).toEqual([shop, app]);
    expect(stoppedReason(walk)).toBe("it took 2 seconds");
  });

  it("walks once for many lookups", async () => {
    const home = newHome();
    clone(home, "shop");
    const { search, opened } = setup(home);
    await Promise.all([search.walked(), search.find(repo), search.find(repo)]);
    await search.walked();
    expect(opened.filter((path) => path === "")).toHaveLength(1);
  });
});

describe("a lookup that finds nothing", () => {
  it("walks again at most once a minute", async () => {
    const home = newHome();
    const { search, clock, opened } = setup(home);
    const walks = () => opened.filter((path) => path === "").length;
    expect(await search.find(repo)).toEqual([]);
    clone(home, "shop");
    clock.advance(WALK_AGAIN_MS - 1);
    expect(await search.find(repo)).toEqual([]);
    expect(walks()).toBe(1);
    clock.advance(1);
    const [first, second] = await Promise.all([search.find(repo), search.find(repo)]);
    expect(first.map(({ dir }) => dir)).toEqual([join(home, "shop")]);
    expect(second).toEqual(first);
    expect(walks()).toBe(2);
  });

  it("doesn't walk again when it finds one", async () => {
    const home = newHome();
    clone(home, "shop");
    const { search, clock, opened } = setup(home);
    await search.find(repo);
    clock.advance(WALK_AGAIN_MS);
    await search.find(repo);
    expect(opened.filter((path) => path === "")).toHaveLength(1);
  });
});

describe("the clones that could be the repository's", () => {
  const dirsFor = async (home: string) =>
    (await setup(home).search.find(repo)).map(({ dir }) => relative(home, dir));

  it.each(["https://github.com/acme/shop.git", "git@github.com:Acme/Shop.git"])(
    "are the ones with the remote %s",
    async (remote) => {
      const home = newHome();
      clone(home, "my-shop", remote);
      clone(home, "other", "git@github.com:acme/other.git");
      expect(await dirsFor(home)).toEqual(["my-shop"]);
    },
  );

  it("are the ones in a folder of its name, whatever the case, such as under an old owner", async () => {
    const home = newHome();
    clone(home, "work/Shop", "git@github.com:acme-old/shop.git");
    expect(await dirsFor(home)).toEqual(["work/Shop"]);
  });

  it("are those whose remotes name it first", async () => {
    const home = newHome();
    clone(home, "a/shop", "git@gitlab.com:acme/shop.git");
    clone(home, "b/mine", "git@github.com:acme/shop.git");
    expect(await dirsFor(home)).toEqual(["b/mine", "a/shop"]);
  });

  it("are the ones of its name when their config doesn't parse", async () => {
    const home = newHome();
    const dir = clone(home, "shop");
    writeFileSync(join(dir, ".git", "config"), "[remote\nurl ]]= \0");
    clone(home, "broken");
    expect(await dirsFor(home)).toEqual(["shop"]);
  });
});

describe("Spotlight", () => {
  it("is asked for the repository's name, within the home folder, when the walk found nothing", async () => {
    const home = newHome();
    const dir = clone(home, "Documents/GitHub/shop", "https://github.com/acme/shop");
    const { search, asked } = setup(home, { platform: "darwin", spotlight: () => `${dir}\0` });
    expect(await search.find(repo)).toEqual([{ dir, repos: [repo] }]);
    expect(asked).toEqual([
      ["-0", "-onlyin", home, 'kMDItemContentType == "public.folder" && kMDItemFSName == "shop"c'],
    ]);
  });

  it("leaves out a folder that isn't a clone, and never opens one under Library", async () => {
    const home = newHome();
    const plain = folder(home, "Documents/shop");
    const hidden = clone(home, "Library/Caches/shop");
    const { search, opened } = setup(home, {
      platform: "darwin",
      spotlight: () => `${plain}\0${hidden}\0`,
    });
    expect(await search.find(repo)).toEqual([]);
    expect(opened).toContain("Documents/shop");
    expect(opened.filter((path) => path.startsWith("Library"))).toEqual([]);
  });

  it("isn't asked when the walk found one", async () => {
    const home = newHome();
    clone(home, "shop");
    const { search, asked } = setup(home, { platform: "darwin" });
    await search.find(repo);
    expect(asked).toEqual([]);
  });

  it.each(['sh"op', "shop*", "sh op", "shop' || true", "$(shop)"])(
    "isn't asked about %s",
    async (name) => {
      const { search, asked } = setup(newHome(), { platform: "darwin" });
      expect(await search.find({ ...repo, repo: name })).toEqual([]);
      expect(asked).toEqual([]);
    },
  );

  it("isn't run off a Mac", async () => {
    const { search, asked } = setup(newHome(), { platform: "linux" });
    expect(await search.find(repo)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("finds nothing when it can't be asked", async () => {
    const { search } = setup(newHome(), { platform: "darwin", spotlight: () => null });
    expect(await search.find(repo)).toEqual([]);
  });
});
