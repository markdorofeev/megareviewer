// The directories every test of the spike uses: a harness directory, and a canary outside it.
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

export const CANARY = "CANARY-7f3a91-OUTSIDE";
export const MARKER = "MARKER-52c0de-INSIDE";
export const MEMORY_MARKER = "MEMORY-c41d-AUTOLOADED";

const repo = new URL("../../../", import.meta.url).pathname;

export interface Fixture {
  readonly root: string;
  /** Where the CLI runs: the harness files, and only those unless `planted`. */
  readonly dir: string;
  readonly outside: string;
  readonly canary: string;
  readonly relativeCanary: string;
  readonly remove: () => void;
}

/**
 * `symlinks` plants links out of the directory, which megareviewer would never write; `importing`
 * makes CLAUDE.md and AGENTS.md `@`-import the canary, as a hostile base commit could.
 */
export const makeFixture = (
  options: { symlinks?: boolean; importing?: boolean; prefix?: string } = {},
): Fixture => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), options.prefix ?? "megareviewer-spike-")));
  const dir = join(root, "harness");
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "megareviewer-canary-")));
  const canary = join(outside, "canary.md");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(canary, `# Canary\n\n${CANARY}\n`);
  cpSync(join(repo, "ARCHITECTURE.md"), join(dir, "ARCHITECTURE.md"));
  writeFileSync(join(dir, "docs", "notes.md"), `# Notes\n\nThe marker is ${MARKER}.\n`);
  const memory = (name: string) =>
    `# ${name}\n\nThe memory marker is ${MEMORY_MARKER}-${name}.\n\nSee [notes](docs/notes.md).\n${
      options.importing ? `\n@${canary}\n` : ""
    }`;
  writeFileSync(join(dir, "CLAUDE.md"), memory("CLAUDE"));
  writeFileSync(join(dir, "AGENTS.md"), memory("AGENTS"));
  if (options.symlinks) {
    symlinkSync(canary, join(dir, "link.md"));
    symlinkSync(outside, join(dir, "linked"));
  }
  return {
    root,
    dir,
    outside,
    canary,
    relativeCanary: relative(dir, canary),
    remove: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    },
  };
};

/** The fixture's paths, named, so recorded streams are stable and hold no machine path. */
export const redact = (fixture: Fixture, text: string): string =>
  text
    .replaceAll(fixture.dir, "$DIR")
    .replaceAll(fixture.outside, "$OUTSIDE")
    .replaceAll(fixture.root, "$ROOT")
    .replaceAll(basename(fixture.root), "$ROOTNAME")
    .replaceAll(basename(fixture.outside), "$OUTSIDENAME")
    .replaceAll(process.env.HOME ?? "\0", "$HOME");
