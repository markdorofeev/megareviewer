import { describe, expect, it } from "vitest";
import type { FileChange } from "../../domain/diff/index.ts";
import { FakeCodeParser, FakeLocalCheckout, hunk } from "../testing/index.ts";
import { prep } from "./prep.ts";

const SHA = "e".repeat(40);
const before = "export function save() {\n  // Once.\n  write();\n}\n";

/** Prep of a pull request that changes line `n` of `src/a.ts`, which `src/b.ts` calls unchanged. */
const callersWhen = async (n: number, from: string, to: string) => {
  const file: FileChange = {
    path: "src/a.ts",
    oldPath: null,
    status: "modified",
    binary: false,
    oldMode: null,
    newMode: null,
    language: "typescript",
    hunks: [hunk("src/a.ts", `@@ -${n},1 +${n},1 @@`, [`-${from}`, `+${to}`])],
    additions: 1,
    deletions: 1,
  };
  const caller = 'import { save } from "./a.ts";\nsave();\n';
  const { unchangedCallers } = await prep(
    new FakeCodeParser(),
    {
      files: [file],
      gitattributes: null,
      baseContents: new Map([[file.path, before]]),
      headContents: new Map([[file.path, before.replace(from, to)]]),
      tickets: [],
      missingTicketKeys: [],
      warnings: [],
    },
    { checkout: new FakeLocalCheckout({ [SHA]: { "src/b.ts": caller } }), sha: SHA },
  );
  return unchangedCallers.map((one) => one.symbol);
};

describe("prep", () => {
  it("finds the callers outside the PR of a definition whose code changes, not its comments", async () => {
    expect(await callersWhen(3, "  write();", "  writeTwice();")).toEqual(["save"]);
    expect(await callersWhen(2, "  // Once.", "  // Twice.")).toEqual([]);
  });
});
