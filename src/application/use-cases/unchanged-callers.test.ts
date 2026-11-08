import { describe, expect, it } from "vitest";
import type { ChangedDefinition, FileChange } from "../../domain/diff/index.ts";
import { err } from "../../domain/shared/index.ts";
import { FakeCodeParser, FakeLocalCheckout, FakeLocalCheckouts, hunk } from "../testing/index.ts";
import { lookUpCheckout, readUnchangedCallers } from "./unchanged-callers.ts";

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
  it("reads a checkout with the head commit, whatever its remotes", async () => {
    const checkout = new FakeLocalCheckout({ [SHA]: {} });
    expect(
      await lookUpCheckout(new FakeLocalCheckouts({ checkout, namesRepo: false }), repo, SHA),
    ).toEqual({ status: "read", at: { checkout, sha: SHA } });
  });

  it("finds none without a checkout", async () => {
    expect(await lookUpCheckout(new FakeLocalCheckouts(), repo, SHA)).toEqual({
      status: "none",
      at: null,
    });
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
    const checkout = new FakeLocalCheckout({ [SHA]: { "src/b.ts": "x".repeat(1024 * 1024 + 1) } });
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
});
