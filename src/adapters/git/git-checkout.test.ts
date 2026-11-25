import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CHECKOUT_CONTRACT_FILES,
  describeLocalCheckoutContract,
  describeLocalCheckoutsContract,
  FixedClock,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
import { createCloneSearch } from "./clone-search.ts";
import { createGitCheckout, createGitCheckouts, inspectCheckout } from "./git-checkout.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();

/** A repository with one commit of `files`, and its remotes. */
const repository = (
  files: Readonly<Record<string, string>>,
  remotes: Record<string, string> = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "megareviewer-git-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "files");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  return { dir, sha: git(dir, "rev-parse", "HEAD") };
};

describeLocalCheckoutContract("git", async () => {
  const { dir, sha } = repository(CHECKOUT_CONTRACT_FILES);
  return { checkout: createGitCheckout({ dir }), sha };
});

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };

describe("createGitCheckouts", () => {
  it("finds the checkout a directory is in, and the remote that names the repository", async () => {
    const { dir, sha } = repository(
      { "src/a.ts": "export const a = 1;\n" },
      { origin: "git@github.com:Acme/Shop.git", upstream: "https://github.com/other/shop" },
    );
    const found = await createGitCheckouts({ dir: join(dir, "src"), search: null }).pointedAt(repo);
    expect(found?.namesRepo).toBe(true);
    expect(await found?.checkout.hasCommit(sha)).toBe(true);
    expect(await found?.checkout.filesMentioning(sha, ["a"])).toEqual({
      ok: true,
      value: ["src/a.ts"],
    });
  });

  it("finds a fork's checkout, whose remotes don't name the repository", async () => {
    const { dir, sha } = repository(
      { "a.ts": "" },
      { origin: "https://github.com/someone/shop.git" },
    );
    const found = await createGitCheckouts({ dir, search: null }).pointedAt(repo);
    expect(found?.namesRepo).toBe(false);
    expect(await found?.checkout.hasCommit(sha)).toBe(true);
  });

  it("finds none outside a git checkout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megareviewer-plain-"));
    made.push(dir);
    expect(await createGitCheckouts({ dir, search: null }).pointedAt(repo)).toBeNull();
    expect(await inspectCheckout(dir)).toBeNull();
  });

  it("finds none when git can't run", async () => {
    const run = async () => ({ code: null, stdout: Buffer.alloc(0), stderr: "missing" });
    expect(await createGitCheckouts({ dir: "/", search: null, run }).pointedAt(repo)).toBeNull();
  });

  it("reads a remembered folder, and none that's gone or isn't a checkout", async () => {
    const { dir, sha } = repository({ "a.ts": "" });
    const checkouts = createGitCheckouts({ dir: "/nowhere", search: null });
    const found = await checkouts.at(dir, repo);
    expect(found?.namesRepo).toBe(false);
    expect(await found?.checkout.hasCommit(sha)).toBe(true);
    expect(await checkouts.at(join(dir, "gone"), repo)).toBeNull();
  });

  it("searches for nothing when the search is off", async () => {
    const checkouts = createGitCheckouts({ dir: "/nowhere", search: null });
    expect(checkouts.searchFolder).toBeNull();
    expect(await checkouts.search(repo)).toEqual([]);
  });

  it("runs no git to search, whatever it finds", async () => {
    const ran: string[] = [];
    const found = await createGitCheckouts({
      dir: "/nowhere",
      search: {
        home: "/home/lee",
        walked: async () => ({ clones: [], stopped: null }),
        find: async () => [
          { dir: "/home/lee/shop", repos: [repo] },
          { dir: "/home/lee/old/shop", repos: [] },
        ],
      },
      run: async (dir) => {
        ran.push(dir);
        return { code: 0, stdout: Buffer.alloc(0), stderr: "" };
      },
    }).search(repo);
    expect(ran).toEqual([]);
    expect(await found[0]?.checkout.hasCommit("a".repeat(40))).toBe(true);
    expect(ran).toEqual(["/home/lee/shop"]);
  });
});

describeLocalCheckoutsContract("git", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "megareviewer-home-")));
  made.push(home);
  const remotes = { origin: "git@github.com:acme/shop.git" };
  const pointed = repository({ "a.ts": "a" }, remotes);
  const clone = join(home, "code", "my-shop");
  git(home, "clone", "-q", pointed.dir, clone);
  git(clone, "remote", "set-url", "origin", remotes.origin);
  const namesake = join(home, "old", "shop");
  mkdirSync(dirname(namesake));
  renameSync(repository({ "b.ts": "b" }, { origin: "git@github.com:lee/shop.git" }).dir, namesake);
  return {
    checkouts: createGitCheckouts({
      dir: pointed.dir,
      search: createCloneSearch({
        home,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        platform: "linux",
      }),
    }),
    pointedAt: realpathSync(pointed.dir),
    clone,
    namesake,
    sha: pointed.sha,
  };
});

describe("inspectCheckout", () => {
  it("names the root and each repository its remotes name once", async () => {
    const { dir } = repository(
      { "a.ts": "" },
      {
        origin: "git@bitbucket.org:team/app.git",
        mirror: "https://bitbucket.org/team/app",
        other: "https://gitlab.com/team/app.git",
      },
    );
    const info = await inspectCheckout(dir);
    expect(info?.repos).toEqual([{ host: "bitbucket", owner: "team", repo: "app" }]);
    expect(info?.root.endsWith(dir.slice(dir.lastIndexOf("/")))).toBe(true);
  });
});

describe("createGitCheckout", () => {
  it("reads nothing for a commit name that could be an option", async () => {
    const { dir } = repository({ "a.ts": "" });
    const checkout = createGitCheckout({ dir });
    expect(await checkout.hasCommit("--help")).toBe(false);
    expect((await checkout.filesMentioning("--all", ["a"])).ok).toBe(false);
  });

  it("reads a path with a newline as unreadable", async () => {
    const { dir, sha } = repository({ "a.ts": "a" });
    const read = await createGitCheckout({ dir }).readFiles(sha, ["a\n.ts", "a.ts"]);
    expect(read).toEqual({
      ok: true,
      value: [{ kind: "unreadable" }, { kind: "text", content: "a" }],
    });
  });

  it("reads a directory's path as unreadable", async () => {
    const { dir, sha } = repository({ "src/a.ts": "a" });
    const read = await createGitCheckout({ dir }).readFiles(sha, ["src"]);
    expect(read).toEqual({ ok: true, value: [{ kind: "unreadable" }] });
  });

  it("fails when git fails", async () => {
    const run = async (_dir: string, args: readonly string[]) =>
      args[0] === "cat-file" && args[1] === "-e"
        ? { code: 0, stdout: Buffer.alloc(0), stderr: "" }
        : { code: 128, stdout: Buffer.alloc(0), stderr: "fatal: broken" };
    const checkout = createGitCheckout({ dir: "/", run });
    const sha = "a".repeat(40);
    expect(await checkout.filesMentioning(sha, ["a"])).toEqual({
      ok: false,
      error: { kind: "failed", message: "git grep failed: fatal: broken" },
    });
    expect(await checkout.readFiles(sha, ["a.ts"])).toEqual({
      ok: false,
      error: { kind: "failed", message: "git cat-file failed: fatal: broken" },
    });
  });

  it("searches whatever the repository's config says of grep, and from any config", async () => {
    const { dir, sha } = repository({ "a.ts": "save(", "b.ts": "other" });
    for (const [key, value] of [
      ["grep.patternType", "perl"],
      ["grep.fullName", "true"],
      ["grep.lineNumber", "true"],
      ["color.grep", "always"],
      ["color.ui", "always"],
      ["submodule.recurse", "true"],
    ] as const) {
      git(dir, "config", key, value);
    }
    expect(await createGitCheckout({ dir }).filesMentioning(sha, ["save("])).toEqual({
      ok: true,
      value: ["a.ts"],
    });
  });

  it("answers a path git would quote as it is", async () => {
    const { dir, sha } = repository({ 'src/ünï "q".ts': "save()" });
    expect(await createGitCheckout({ dir }).filesMentioning(sha, ["save"])).toEqual({
      ok: true,
      value: ['src/ünï "q".ts'],
    });
  });

  it("takes more names than a command line holds", async () => {
    const { dir, sha } = repository({ "a.ts": "save()" });
    const names = Array.from({ length: 50_000 }, (_, at) => `a_rather_long_definition_name_${at}`);
    expect(await createGitCheckout({ dir }).filesMentioning(sha, [...names, "save"])).toEqual({
      ok: true,
      value: ["a.ts"],
    });
  });

  it("ignores an empty name, which would match every file, and one with a newline", async () => {
    const { dir, sha } = repository({ "a.ts": "save()" });
    const checkout = createGitCheckout({ dir });
    expect(await checkout.filesMentioning(sha, ["", "x\n"])).toEqual({ ok: true, value: [] });
  });

  it("changes nothing in a clone, and fetches nothing a partial one lacks", async () => {
    const origin = repository({ "a.ts": "save()" });
    git(origin.dir, "config", "uploadpack.allowFilter", "true");
    git(origin.dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    const home = mkdtempSync(join(tmpdir(), "megareviewer-partial-"));
    made.push(home);
    const dir = join(home, "shop");
    git(home, "clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, dir);
    const files = () =>
      readdirSync(join(dir, ".git"), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort()
        .map((path) => [path, readFileSync(path).toString("base64")]);
    const before = files();

    const checkout = createGitCheckout({ dir });
    expect(await checkout.hasCommit(origin.sha)).toBe(true);
    expect(await checkout.hasCommit("0".repeat(40))).toBe(false);
    // The file isn't there to search, and that's said rather than read as no mention.
    expect((await checkout.filesMentioning(origin.sha, ["save"])).ok).toBe(false);
    const read = await checkout.readFiles(origin.sha, ["a.ts"]);
    expect(read.ok && read.value[0]?.kind === "text").toBe(false);
    expect(files()).toEqual(before);
  });
});
