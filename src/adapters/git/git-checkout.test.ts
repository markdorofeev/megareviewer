import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CHECKOUT_CONTRACT_FILES,
  describeLocalCheckoutContract,
} from "../../application/testing/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
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
    const found = await createGitCheckouts({ dir: join(dir, "src") }).find(repo);
    expect(found?.namesRepo).toBe(true);
    expect(await found?.checkout.hasCommit(sha)).toBe(true);
    expect(await found?.checkout.listFiles(sha)).toEqual({ ok: true, value: ["src/a.ts"] });
  });

  it("finds a fork's checkout, whose remotes don't name the repository", async () => {
    const { dir, sha } = repository(
      { "a.ts": "" },
      { origin: "https://github.com/someone/shop.git" },
    );
    const found = await createGitCheckouts({ dir }).find(repo);
    expect(found?.namesRepo).toBe(false);
    expect(await found?.checkout.hasCommit(sha)).toBe(true);
  });

  it("finds none outside a git checkout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megareviewer-plain-"));
    made.push(dir);
    expect(await createGitCheckouts({ dir }).find(repo)).toBeNull();
    expect(await inspectCheckout(dir)).toBeNull();
  });

  it("finds none when git can't run", async () => {
    const run = async () => ({ code: null, stdout: Buffer.alloc(0), stderr: "missing" });
    expect(await createGitCheckouts({ dir: "/", run }).find(repo)).toBeNull();
  });
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
    expect((await checkout.listFiles("--all")).ok).toBe(false);
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
    expect(await checkout.listFiles(sha)).toEqual({
      ok: false,
      error: { kind: "failed", message: "git ls-tree failed: fatal: broken" },
    });
    expect(await checkout.readFiles(sha, ["a.ts"])).toEqual({
      ok: false,
      error: { kind: "failed", message: "git cat-file failed: fatal: broken" },
    });
  });
});
