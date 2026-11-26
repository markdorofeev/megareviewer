import { beforeAll, describe, expect, it } from "vitest";
import {
  type FileChange,
  findUnchangedCallers,
  mentionsAny,
  type UnchangedFile,
} from "../../../domain/diff/index.ts";
import type { RepoRef } from "../../../domain/review/index.ts";
import {
  type LocalCheckout,
  type LocalCheckouts,
  MAX_CHECKOUT_FILE_BYTES,
} from "../../ports/index.ts";
import { FakeCodeParser } from "../fake-code-parser.ts";
import { hunk } from "../fixtures/index.ts";

/** The files every implementation is set up with, at one commit. */
export const CHECKOUT_CONTRACT_FILES: Readonly<Record<string, string>> = {
  "src/app.py": "from .routes import router\n\napp = create_app(router)\n",
  // Names the app without importing it, calls it through a longer name, and only declares it.
  "src/admin.py": "def admin(): return create_app\n",
  "src/server.ts": "import { items } from './routes/items.ts';\nconst $app = createApp(items());\n",
  "src/worker.py": "create_app_for_worker()\n",
  "src/routes/items.ts": 'export const items = () => "ünïcödé ✓";\n',
  "docs/a file with spaces.md": "# Spaces\n",
  // Files git takes for binary, by a NUL or by an attribute, are still text to a parser.
  ".gitattributes": "*.gen.ts binary\n",
  "src/client.gen.ts": "export const client = createApp();\n",
  "src/nul.ts": "const nul = '\0';\nitems();\n",
  "big.txt": `items ${"x".repeat(MAX_CHECKOUT_FILE_BYTES)}`,
};

export interface LocalCheckoutContractSetup {
  readonly checkout: LocalCheckout;
  /** The commit holding `CHECKOUT_CONTRACT_FILES`, and nothing else. */
  readonly sha: string;
}

const MISSING = "0123456789abcdef0123456789abcdef01234567";

export const describeLocalCheckoutContract = (
  name: string,
  setup: () => Promise<LocalCheckoutContractSetup>,
): void => {
  describe(`LocalCheckout contract: ${name}`, () => {
    let checkout: LocalCheckout;
    let sha: string;
    beforeAll(async () => {
      ({ checkout, sha } = await setup());
    });

    it("knows which commits it has", async () => {
      expect(await checkout.hasCommit(sha)).toBe(true);
      expect(await checkout.hasCommit(MISSING)).toBe(false);
    });

    it.each([
      [["items"], ["big.txt", "src/nul.ts", "src/routes/items.ts", "src/server.ts"]],
      [["create_app"], ["src/admin.py", "src/app.py"]],
      [
        ["createApp", "router"],
        ["src/app.py", "src/client.gen.ts", "src/server.ts"],
      ],
      [["$app"], ["src/server.ts"]],
      [["ünïcödé"], ["src/routes/items.ts"]],
    ])("answers every file that mentions any of %j", async (names, expected) => {
      const mentioning = await checkout.filesMentioning(sha, names);
      expect(mentioning.ok && mentioning.value).toEqual(expect.arrayContaining(expected));
      // Nothing else may be left out either: what it doesn't answer names none of them.
      const answered = new Set(mentioning.ok ? mentioning.value : []);
      const left = Object.entries(CHECKOUT_CONTRACT_FILES).filter(([path]) => !answered.has(path));
      expect(left.filter(([, content]) => mentionsAny(content, new Set(names)))).toEqual([]);
    });

    it("finds the same callers as reading every file", async () => {
      const path = "src/routes/items.ts";
      const changed = hunk(path, "@@ -1,1 +1,1 @@", ["-export const items = 1;", "+changed"]);
      const changes: FileChange[] = [
        {
          path,
          oldPath: null,
          status: "modified",
          binary: false,
          oldMode: null,
          newMode: null,
          language: "typescript",
          hunks: [changed],
          additions: 1,
          deletions: 1,
        },
      ];
      const definitions = [{ partId: changed.id, path, name: "items", owner: null }];
      const parser = new FakeCodeParser();
      const callersIn = async (paths: readonly string[]) => {
        const read = await checkout.readFiles(sha, paths);
        if (!read.ok) throw new Error(read.error.message);
        const unchanged: UnchangedFile[] = [];
        for (const [at, file] of read.value.entries()) {
          const language = parser.languageFor(paths[at] ?? "");
          if (file.kind !== "text" || language === null || paths[at] === path) continue;
          const symbols = await parser.symbols(file.content, language);
          if (!symbols.ok) throw new Error(symbols.error.message);
          const { content } = file;
          unchanged.push({ path: paths[at] ?? "", language, content, symbols: symbols.value });
        }
        return findUnchangedCallers(changes, definitions, unchanged, new Set());
      };
      const mentioning = await checkout.filesMentioning(sha, ["items"]);
      const callers = await callersIn(mentioning.ok ? mentioning.value : []);
      expect(callers).toEqual(await callersIn(Object.keys(CHECKOUT_CONTRACT_FILES).sort()));
      // src/nul.ts names it too, but doesn't import it.
      expect(callers.map(({ uses }) => uses.map((use) => [use.path, use.line]))).toEqual([
        [["src/server.ts", 2]],
      ]);
    });

    it("answers paths sorted, as they are at the commit", async () => {
      const mentioning = await checkout.filesMentioning(sha, ["Spaces", "createApp", "items"]);
      expect(mentioning.ok && mentioning.value).toEqual([
        "big.txt",
        "docs/a file with spaces.md",
        "src/client.gen.ts",
        "src/nul.ts",
        "src/routes/items.ts",
        "src/server.ts",
      ]);
    });

    it("answers no file for names nothing mentions, and for no names", async () => {
      expect(await checkout.filesMentioning(sha, ["nowhere"])).toEqual({ ok: true, value: [] });
      expect(await checkout.filesMentioning(sha, ["--all"])).toEqual({ ok: true, value: [] });
      expect(await checkout.filesMentioning(sha, [])).toEqual({ ok: true, value: [] });
    });

    it("reads files in the order asked, skipping large and missing ones", async () => {
      const read = await checkout.readFiles(sha, [
        "src/routes/items.ts",
        "missing.ts",
        "big.txt",
        "docs/a file with spaces.md",
        "src/app.py",
      ]);
      expect(read).toEqual({
        ok: true,
        value: [
          { kind: "text", content: CHECKOUT_CONTRACT_FILES["src/routes/items.ts"] },
          { kind: "unreadable" },
          { kind: "too-large" },
          { kind: "text", content: CHECKOUT_CONTRACT_FILES["docs/a file with spaces.md"] },
          { kind: "text", content: CHECKOUT_CONTRACT_FILES["src/app.py"] },
        ],
      });
    });

    it("reads nothing when asked for nothing", async () => {
      expect(await checkout.readFiles(sha, [])).toEqual({ ok: true, value: [] });
    });

    it("fails on a commit it doesn't have", async () => {
      const mentioning = await checkout.filesMentioning(MISSING, ["items"]);
      const read = await checkout.readFiles(MISSING, ["src/app.py"]);
      for (const result of [mentioning, read]) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("missing-commit");
      }
    });
  });
};

export interface LocalCheckoutsContractSetup {
  readonly checkouts: LocalCheckouts;
  /** Where it was pointed at: a checkout of acme/shop, which has the commit. */
  readonly pointedAt: string;
  /** A clone on the machine of acme/shop, found by its remote, which has the commit. */
  readonly clone: string;
  /** A clone in a folder named shop, of another repository. */
  readonly namesake: string;
  readonly sha: string;
}

export const describeLocalCheckoutsContract = (
  name: string,
  setup: () => Promise<LocalCheckoutsContractSetup>,
): void => {
  describe(`LocalCheckouts contract: ${name}`, () => {
    const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
    let made: LocalCheckoutsContractSetup;
    beforeAll(async () => {
      made = await setup();
    });

    it("finds the checkout it was pointed at", async () => {
      const found = await made.checkouts.pointedAt(repo);
      expect([found?.dir, found?.namesRepo]).toEqual([made.pointedAt, true]);
      expect(await found?.checkout.hasCommit(made.sha)).toBe(true);
    });

    it("finds a clone by its folder, and none in a folder that's gone", async () => {
      const found = await made.checkouts.at(made.clone, repo);
      expect([found?.dir, found?.namesRepo]).toEqual([made.clone, true]);
      expect(await found?.checkout.hasCommit(made.sha)).toBe(true);
      expect(await made.checkouts.at(`${made.clone}-gone`, repo)).toBeNull();
    });

    it("searches for clones that could be the repository's, those that name it first", async () => {
      const found = await made.checkouts.search(repo);
      expect(found.map(({ dir, namesRepo }) => [dir, namesRepo])).toEqual([
        [made.clone, true],
        [made.namesake, false],
      ]);
      expect(await found[0]?.checkout.hasCommit(made.sha)).toBe(true);
      expect(await found[1]?.checkout.hasCommit(made.sha)).toBe(false);
    });

    it("says which folder it searches", () => {
      expect(made.checkouts.searchFolder).not.toBeNull();
    });
  });
};
