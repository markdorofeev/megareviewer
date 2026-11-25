import { describe, expect, it } from "vitest";
import type { ChangedDefinition, FileChange } from "../../domain/diff/index.ts";
import { err } from "../../domain/shared/index.ts";
import type { FoundCheckout } from "../ports/index.ts";
import {
  FakeCodeParser,
  FakeLocalCheckout,
  FakeLocalCheckouts,
  FakeRepositoryCopies,
  FixedClock,
  hunk,
  InMemoryKnownCheckouts,
} from "../testing/index.ts";
import { forgetOldCopies, lookUpCheckout, readUnchangedCallers } from "./unchanged-callers.ts";

const SHA = "e".repeat(40);
const repo = { host: "github", owner: "acme", repo: "shop" } as const;

const changedHunk = hunk("src/a.ts", "@@ -1,2 +1,2 @@", [
  " export function save() {",
  "-  return 1;",
  "+  return 2;",
]);
const files: FileChange[] = [
  {
    path: "src/a.ts",
    oldPath: null,
    status: "modified",
    binary: false,
    oldMode: null,
    newMode: null,
    language: "typescript",
    hunks: [changedHunk],
    additions: 1,
    deletions: 1,
  },
];
const changed: ChangedDefinition[] = [{ partId: changedHunk.id, path: "src/a.ts", name: "save" }];

describe("lookUpCheckout", () => {
  const has = new FakeLocalCheckout({ [SHA]: {} });
  const lacks = new FakeLocalCheckout({});
  const at = (dir: string, checkout = has, namesRepo = true) => ({ dir, checkout, namesRepo });

  const lookUp = async (
    pointed: FoundCheckout | null,
    clones: readonly FoundCheckout[] = [],
    remembered: readonly string[] = [],
    copies = new FakeRepositoryCopies(),
  ) => {
    const checkouts = new FakeLocalCheckouts(pointed, { clones });
    const knownCheckouts = new InMemoryKnownCheckouts();
    for (const dir of remembered.toReversed()) await knownCheckouts.rememberFolder(repo, dir);
    return {
      lookup: await lookUpCheckout({ checkouts, knownCheckouts, copies }, repo, SHA),
      asked: checkouts.asked,
      remembered: await knownCheckouts.foldersRead(repo),
    };
  };

  it("reads the folder pointed at when it has the head commit, whatever its remotes", async () => {
    const found = await lookUp(at("/src/fork", has, false), [at("/src/shop")], ["/src/shop"]);
    expect(found.lookup).toEqual({
      status: "read",
      dir: "/src/fork",
      at: { checkout: has, sha: SHA },
    });
    expect(found.asked).toEqual(["pointedAt"]);
    expect(found.remembered).toEqual(["/src/fork", "/src/shop"]);
  });

  it("reads a folder read before without searching, the most recently read first", async () => {
    const found = await lookUp(
      at("/src/here", lacks),
      [at("/src/a"), at("/src/b")],
      ["/src/b", "/src/a"],
    );
    expect(found.lookup.dir).toBe("/src/b");
    expect(found.asked).toEqual(["pointedAt", "at /src/b"]);
  });

  it("forgets a folder that's gone, and goes on", async () => {
    const found = await lookUp(null, [at("/src/shop")], ["/src/gone"]);
    expect(found.lookup.dir).toBe("/src/shop");
    expect(found.asked).toEqual(["pointedAt", "at /src/gone", "search"]);
    expect(found.remembered).toEqual(["/src/shop"]);
  });

  it("searches when no earlier folder has the commit, and remembers the clone it reads", async () => {
    const found = await lookUp(null, [at("/src/old", lacks), at("/src/shop")]);
    expect(found.lookup).toEqual({
      status: "read",
      dir: "/src/shop",
      at: { checkout: has, sha: SHA },
    });
    expect(found.remembered).toEqual(["/src/shop"]);
  });

  it("reads megareviewer's own copy last, and doesn't remember it as the reviewer's", async () => {
    const copies = new FakeRepositoryCopies({ commits: { [SHA]: {} }, downloadFolder: "/copies" });
    await copies.download(repo, SHA);
    const found = await lookUp(null, [at("/src/shop", lacks)], [], copies);
    expect(found.lookup).toMatchObject({ status: "read", dir: "/copies/github/acme/shop.git" });
    expect(await found.lookup.at?.checkout.hasCommit(SHA)).toBe(true);
    expect(found.remembered).toEqual([]);

    const clone = await lookUp(null, [at("/src/shop")], [], copies);
    expect(clone.lookup.dir).toBe("/src/shop");
  });

  it("downloads nothing", async () => {
    const copies = new FakeRepositoryCopies({ commits: { [SHA]: {} }, downloadFolder: "/copies" });
    const found = await lookUp(null, [], [], copies);
    expect(found.lookup.status).toBe("none");
    expect(copies.asked).toEqual([`find ${SHA}`]);
  });

  it("asks one folder for the commit once", async () => {
    const here = new FakeLocalCheckout({});
    let asked = 0;
    here.hasCommit = async () => {
      asked += 1;
      return false;
    };
    await lookUp(at("/src/shop", here), [at("/src/shop", here)], ["/src/shop"]);
    expect(asked).toBe(1);
  });

  it("answers the first folder that names the repository when none has the commit", async () => {
    const found = await lookUp(at("/src/other", lacks, false), [
      at("/src/first", lacks),
      at("/src/second", lacks),
    ]);
    expect(found.lookup).toEqual({ status: "missing-commit", dir: "/src/first", at: null });
    expect(found.remembered).toEqual([]);
  });

  it("answers a folder read before that now lacks the commit, whatever its remotes", async () => {
    const found = await lookUp(null, [at("/src/shop", lacks, false)], ["/src/shop"]);
    expect(found.lookup).toEqual({ status: "missing-commit", dir: "/src/shop", at: null });
    expect(found.remembered).toEqual(["/src/shop"]);
  });

  it("reads a clone named like the repository only when it has the commit", async () => {
    expect((await lookUp(null, [at("/src/shop", lacks, false)])).lookup).toEqual({
      status: "none",
      dir: null,
      at: null,
    });
    expect((await lookUp(null, [at("/src/shop", has, false)])).lookup.status).toBe("read");
  });

  it("finds none without a checkout", async () => {
    expect((await lookUp(null)).lookup).toEqual({ status: "none", dir: null, at: null });
  });
});

describe("readUnchangedCallers", () => {
  const read = (checkout: FakeLocalCheckout, definitions = changed) =>
    readUnchangedCallers(
      new FakeCodeParser(),
      { checkout, sha: SHA },
      files,
      definitions,
      new Set(),
    );

  it("reads nothing when the PR changes no definition that was there before", async () => {
    const checkout = new FakeLocalCheckout({ [SHA]: { "src/b.ts": "save()" } });
    expect(await read(checkout, [])).toEqual({ unchangedCallers: [], warnings: [] });
    expect(checkout.reads).toEqual([]);
  });

  it("counts one file too large to read", async () => {
    const checkout = new FakeLocalCheckout({
      [SHA]: { "src/b.ts": `save ${"x".repeat(1024 * 1024)}` },
    });
    expect((await read(checkout)).warnings).toEqual([
      "1 file in the local checkout is over 1 MB, so callers in it aren't shown.",
    ]);
  });

  it("warns when the files can't be read", async () => {
    const checkout = new FakeLocalCheckout({ [SHA]: { "src/b.ts": "save()" } });
    checkout.readFiles = async () => err({ kind: "failed", message: "git cat-file failed" });
    expect(await read(checkout)).toEqual({
      unchangedCallers: [],
      warnings: ["Couldn't read the local checkout: git cat-file failed"],
    });
  });

  it("skips a file that doesn't parse", async () => {
    const checkout = new FakeLocalCheckout({
      [SHA]: { "src/b.ts": 'import { save } from "./a.ts";\nsave();' },
    });
    const parser = new FakeCodeParser();
    parser.failAlways("symbols");
    expect(
      await readUnchangedCallers(parser, { checkout, sha: SHA }, files, changed, new Set()),
    ).toEqual({ unchangedCallers: [], warnings: [] });
  });

  it("reads only the files that mention a changed definition", async () => {
    const checkout = new FakeLocalCheckout({
      [SHA]: {
        "src/b.ts": 'import { save } from "./a.ts";\nsave();',
        "src/c.ts": "other();",
        "src/a.ts": "export function save() {}",
        "src/d.py": "save()",
      },
    });
    const { unchangedCallers } = await read(checkout);
    expect(checkout.reads).toEqual([["src/b.ts"]]);
    expect(unchangedCallers.map(({ uses }) => uses.map(({ path }) => path))).toEqual([
      ["src/b.ts"],
    ]);
  });
});

describe("forgetOldCopies", () => {
  it("removes the copies not read for 30 days", async () => {
    const clock = new FixedClock("2026-11-25T10:00:00.000Z");
    const commits = { [SHA]: {} };
    const copies = new FakeRepositoryCopies({ commits, downloadFolder: "/copies", clock });
    await copies.download(repo, SHA);
    clock.advance(30 * 24 * 60 * 60 * 1000);
    expect(await forgetOldCopies({ copies, clock })).toBe(0);
    clock.advance(1);
    expect(await forgetOldCopies({ copies, clock })).toBe(1);
    expect(await copies.find(repo, SHA)).toBeNull();
  });
});
