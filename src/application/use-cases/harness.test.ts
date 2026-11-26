import { describe, expect, it } from "vitest";
import {
  GUIDELINE_PATHS,
  Harness,
  type HostError,
  MAX_HARNESS_DEPTH,
  MAX_HARNESS_FILE_BYTES,
  MAX_HARNESS_FILES,
  MAX_HARNESS_LOOKUPS,
  type RepoRef,
} from "../../domain/review/index.ts";
import type { HarnessSourceFile } from "../ports/index.ts";
import {
  FakeHarnessSource,
  gitBlobHash,
  InMemoryHarnessStore,
  RecordingLogger,
} from "../testing/index.ts";
import { harnessState, loadHarness } from "./index.ts";

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const BASE = "a".repeat(40);
const NEWER = "b".repeat(40);

const network: HostError = { kind: "network", message: "socket hang up", retryAfterSeconds: null };

type Files = Readonly<Record<string, string | HarnessSourceFile>>;

const FILES: Files = {
  "CLAUDE.md": "# Shop\n\n@docs/rules.md\n\nSee docs/plan.md and [how](docs/how.md).\n",
  "docs/rules.md": "# Rules\n\n## Naming\n\nAs plan.md says.\n",
  "docs/plan.md": "# Plan\n\n[Rules](rules.md)\n",
  "docs/how.md": "How.\n",
  "docs/alone.md": "Nothing links this.\n",
  "src/app.ts": "export {};\n",
};

const setup = (
  files: Files = FILES,
  options: { lists?: boolean; diffs?: boolean; store?: InMemoryHarnessStore } = {},
) => {
  const source = new FakeHarnessSource({ lists: true, diffs: true, ...options });
  source.setFiles(repo, BASE, files);
  const harnessStore = options.store ?? new InMemoryHarnessStore();
  const logger = new RecordingLogger();
  const deps = { harnessSource: () => source, harnessStore, logger };
  return {
    source,
    harnessStore,
    logger,
    deps,
    load: async (sha = BASE) => {
      const loaded = await loadHarness(deps, repo, sha);
      if (!loaded.ok) throw new Error(loaded.error.message);
      if (loaded.value === null) throw new Error("no source");
      expect(Harness.parse(loaded.value.harness)).toEqual(loaded.value.harness);
      return loaded.value;
    },
  };
};

const paths = (harness: Harness) => harness.files.map(({ path }) => path);
const requests = ({ calls }: FakeHarnessSource) => ({
  lists: calls.listFiles.length,
  diffs: calls.changedPaths.length,
  reads: calls.readFiles,
});

/** How each source a host can be answers. */
const KINDS = [
  { name: "lists", lists: true, diffs: false },
  { name: "can't list", lists: false, diffs: true },
];

describe.each(KINDS)("a harness from a source that $name", (kind) => {
  it("is the roots and what they link, in order, with how each was found", async () => {
    const { load } = setup(FILES, kind);
    const { harness, contents } = await load();

    expect(
      harness.files.map(({ path, via, linkedFrom, links }) => ({ path, via, linkedFrom, links })),
    ).toEqual([
      {
        path: "CLAUDE.md",
        via: "root",
        linkedFrom: null,
        links: [
          { path: "docs/rules.md", kind: "import" },
          { path: "docs/plan.md", kind: "mention" },
          { path: "docs/how.md", kind: "link" },
        ],
      },
      {
        path: "docs/rules.md",
        via: "import",
        linkedFrom: "CLAUDE.md",
        links: [{ path: "docs/plan.md", kind: "mention" }],
      },
      {
        path: "docs/plan.md",
        via: "mention",
        linkedFrom: "CLAUDE.md",
        links: [{ path: "docs/rules.md", kind: "link" }],
      },
      { path: "docs/how.md", via: "link", linkedFrom: "CLAUDE.md", links: [] },
    ]);
    expect(harness).toMatchObject({ baseSha: BASE, cut: null, skipped: [] });
    expect(harness.files[1]).toMatchObject({
      blob: await gitBlobHash("# Rules\n\n## Naming\n\nAs plan.md says.\n"),
      bytes: 37,
      lines: 5,
      headings: [
        { level: 1, text: "Rules", line: 1 },
        { level: 2, text: "Naming", line: 3 },
      ],
    });
    expect(contents).toEqual(new Map(paths(harness).map((path) => [path, FILES[path]] as const)));
  });

  it("gives a file the strongest kind any file links it by, and the first that does", async () => {
    const { load } = setup(
      {
        "REVIEW.md": "Read a.md.",
        "CLAUDE.md": "[a](a.md)\n@b.md",
        "b.md": "@a.md",
        "a.md": "A",
      },
      kind,
    );
    const { harness } = await load();
    expect(harness.files.find(({ path }) => path === "a.md")).toMatchObject({
      via: "import",
      linkedFrom: "REVIEW.md",
    });
  });

  it("keeps a root a root when another file links it", async () => {
    const { load } = setup({ "CLAUDE.md": "@AGENTS.md", "AGENTS.md": "[c](CLAUDE.md)" }, kind);
    const { harness } = await load();
    expect(harness.files.map(({ path, via, linkedFrom }) => [path, via, linkedFrom])).toEqual([
      ["AGENTS.md", "root", null],
      ["CLAUDE.md", "root", null],
    ]);
    expect(harness.files[1]?.links).toEqual([{ path: "AGENTS.md", kind: "import" }]);
  });

  it("takes a path in prose against its file before the root, when both are there", async () => {
    const { load } = setup(
      { "CLAUDE.md": "@docs/a.md", "docs/a.md": "Read b.md.", "docs/b.md": "", "b.md": "" },
      kind,
    );
    expect(paths((await load()).harness)).toEqual(["CLAUDE.md", "docs/a.md", "docs/b.md"]);
  });

  it("goes round a cycle once", async () => {
    const { load } = setup(
      { "CLAUDE.md": "@a.md", "a.md": "@b.md", "b.md": "@a.md @CLAUDE.md" },
      kind,
    );
    const { harness } = await load();
    expect(paths(harness)).toEqual(["CLAUDE.md", "a.md", "b.md"]);
    expect(harness.cut).toBeNull();
  });

  it("stops 5 hops from a root, and says so", async () => {
    const chain = Object.fromEntries(
      Array.from({ length: MAX_HARNESS_DEPTH + 2 }, (_, index) => [
        `${index + 1}.md`,
        `@${index + 2}.md`,
      ]),
    );
    const { load } = setup({ "CLAUDE.md": "@1.md", ...chain }, kind);
    const { harness } = await load();
    expect(paths(harness)).toEqual(["CLAUDE.md", "1.md", "2.md", "3.md", "4.md", "5.md"]);
    expect(harness.cut).toBe("depth");
  });

  it("isn't cut by a last hop that links only files it has", async () => {
    const { load } = setup(
      {
        "CLAUDE.md": "@1.md",
        "1.md": "@2.md",
        "2.md": "@3.md",
        "3.md": "@4.md",
        "4.md": "@5.md",
        "5.md": "@1.md",
      },
      kind,
    );
    const { harness } = await load();
    expect(harness.cut).toBeNull();
    expect(harness.files.at(-1)?.links).toEqual([{ path: "1.md", kind: "import" }]);
  });

  it("connects a folder past the last hop to the files it has, and is cut by one it doesn't", async () => {
    const chain = {
      "CLAUDE.md": "@1.md and docs/",
      "1.md": "@2.md",
      "2.md": "@3.md",
      "3.md": "@4.md",
      "4.md": "@5.md",
      "docs/a.md": "",
    };
    const has = await setup({ ...chain, "5.md": "docs/" }, kind).load();
    expect(has.harness.cut).toBeNull();
    expect(has.harness.files.find(({ path }) => path === "5.md")?.links).toEqual([
      { path: "docs/a.md", kind: "mention" },
    ]);
    const lacks = await setup({ ...chain, "5.md": "notes/", "notes/b.md": "" }, kind).load();
    expect(lacks.harness.cut).toBe("depth");
    expect(paths(lacks.harness)).not.toContain("notes/b.md");
  });

  it("stops at 200 files, and says so, with the links among the ones it has", async () => {
    const many = Array.from({ length: MAX_HARNESS_FILES + 20 }, (_, index) => `${index}.md`);
    const { load } = setup(
      {
        "CLAUDE.md": many.map((path) => `- @${path}`).join("\n"),
        ...Object.fromEntries(many.map((path) => [path, "@0.md"])),
      },
      kind,
    );
    const { harness } = await load();
    expect(harness.files).toHaveLength(MAX_HARNESS_FILES);
    expect(paths(harness).slice(-1)).toEqual([`${MAX_HARNESS_FILES - 2}.md`]);
    expect(harness.cut).toBe("files");
    expect(harness.files.at(-1)?.links).toEqual([{ path: "0.md", kind: "import" }]);
  });

  it("leaves out a file over 1 MB and one the host won't give as text, and names both", async () => {
    const { load } = setup(
      {
        "CLAUDE.md": "@large.md @exact.md @image.txt\n@after.md",
        "large.md": "é".repeat(MAX_HARNESS_FILE_BYTES / 2 + 1),
        "exact.md": "x".repeat(MAX_HARNESS_FILE_BYTES),
        "image.txt": { kind: "skipped", reason: "unreadable" },
        "after.md": "",
      },
      kind,
    );
    const { harness, contents } = await load();
    expect(paths(harness)).toEqual(["CLAUDE.md", "exact.md", "after.md"]);
    expect(harness.skipped).toEqual([
      { path: "large.md", reason: "too-large" },
      { path: "image.txt", reason: "unreadable" },
    ]);
    expect([...contents.keys()]).toEqual(paths(harness));
  });

  it("takes a folder for the Markdown under it, at any depth, as the file naming it links them", async () => {
    const { load } = setup(
      {
        "CLAUDE.md":
          "Rules are in docs/rules/.\n\n[Cursor's](.cursor/rules) and @docs/rules/naming.md\n",
        "docs/rules/naming.md": "Names.\n",
        "docs/rules/api/errors.md": "Errors.\n",
        "docs/rules/logo.png": "",
        "docs/rules/NOTICE.txt": "",
        ".cursor/rules/style.mdc": "Style.\n",
        "docs/other.md": "",
      },
      kind,
    );
    const { harness } = await load();
    expect(harness.files.map(({ path, via, linkedFrom }) => [path, via, linkedFrom])).toEqual([
      ["CLAUDE.md", "root", null],
      ["docs/rules/naming.md", "import", "CLAUDE.md"],
      ["docs/rules/api/errors.md", "mention", "CLAUDE.md"],
      [".cursor/rules/style.mdc", "link", "CLAUDE.md"],
    ]);
    expect(harness.files[0]?.links).toEqual([
      { path: "docs/rules/naming.md", kind: "import" },
      { path: "docs/rules/api/errors.md", kind: "mention" },
      { path: ".cursor/rules/style.mdc", kind: "link" },
    ]);
    expect(harness.cut).toBeNull();
  });

  it("takes a folder in prose against its file before the root, and never a file for itself", async () => {
    const { load } = setup(
      {
        "CLAUDE.md": "@docs/notes.md",
        "docs/notes.md": "See plan/ and the rest of docs/.",
        "docs/plan/a.md": "",
        "plan/b.md": "",
      },
      kind,
    );
    const { harness } = await load();
    expect(paths(harness)).toEqual(["CLAUDE.md", "docs/notes.md", "docs/plan/a.md"]);
    expect(harness.files[1]?.links).toEqual([{ path: "docs/plan/a.md", kind: "mention" }]);
  });

  it("has nothing for a folder or a file that isn't there, or a folder named as a file", async () => {
    const { load } = setup(
      { "CLAUDE.md": "[docs](docs) @docs.md/ @rules.md @none.md", "rules.md/a.ts": "" },
      kind,
    );
    const { harness } = await load();
    expect(paths(harness)).toEqual(["CLAUDE.md"]);
    expect(harness.missing).toContain("rules.md");
    expect(harness).toMatchObject({ cut: null, skipped: [] });
  });

  it("is empty for a repository without guideline files", async () => {
    const { load, source } = setup({ "README.md": "@docs.md", "docs.md": "" }, kind);
    expect((await load()).harness.files).toEqual([]);
    const { reads } = requests(source);
    await load();
    expect(requests(source).reads).toEqual(reads);
  });

  it("asks for nothing when the store has the commit's harness", async () => {
    const { load, source } = setup(FILES, kind);
    const first = await load();
    const before = structuredClone(requests(source));
    expect(await load()).toEqual(first);
    expect(requests(source)).toEqual(before);
  });

  it("loads again when the store has lost a content", async () => {
    const { load, source, harnessStore } = setup(FILES, kind);
    const first = await load();
    const getBlobs = harnessStore.getBlobs.bind(harnessStore);
    harnessStore.getBlobs = async (of, blobs) =>
      new Map([...(await getBlobs(of, blobs))].filter(([, content]) => content !== "How.\n"));
    const before = requests(source).reads.length;
    expect(await load()).toEqual(first);
    expect(requests(source).reads.slice(before)).toEqual([["docs/how.md"]]);
  });

  it("makes one walk for two loads at once, and another for another commit", async () => {
    const { deps, source } = setup(FILES, kind);
    source.setFiles(repo, NEWER, FILES);
    const release = source.hold();
    const both = [loadHarness(deps, repo, BASE), loadHarness(deps, repo, BASE)];
    expect(await harnessState(deps, repo, BASE)).toEqual({ status: "loading" });
    release();
    const [first, second] = await Promise.all(both);
    expect(second).toBe(first);
    const { lists, reads } = requests(source);
    expect([lists, reads.length]).toEqual([kind.lists ? 1 : 0, 2]);
    await loadHarness(deps, repo, NEWER);
    expect(requests(source).lists + requests(source).diffs).toBe(kind.lists ? 2 : 1);
  });

  it.each(["listFiles", "readFiles"] as const)(
    "is an error when the source's %s fails, and leaves the store as it was",
    async (method) => {
      if (method === "listFiles" && !kind.lists) return;
      const { deps, source, harnessStore, logger, load } = setup(FILES, kind);
      const blob = await gitBlobHash(String(FILES["CLAUDE.md"]));
      if (method === "readFiles") {
        // The roots are read, and what they link fails.
        const readFiles = source.readFiles.bind(source);
        let reads = 0;
        source.readFiles = async (...asked) => {
          reads += 1;
          if (reads === 2) source.failNext("readFiles", network);
          return readFiles(...asked);
        };
      } else source.failNext(method, network);

      expect(await loadHarness(deps, repo, BASE)).toEqual({
        ok: false,
        error: { code: "host-error", message: "socket hang up" },
      });
      expect(await harnessStore.getHarness(repo, BASE)).toBeNull();
      expect(await harnessStore.getBlobs(repo, [blob])).toEqual(new Map());
      expect(await harnessState(deps, repo, BASE)).toEqual({
        status: "failed",
        error: { code: "host-error", message: "socket hang up" },
      });
      expect(logger.entries).toMatchObject([
        { level: "warn", message: "Couldn't load the repository's harness" },
      ]);

      const { harness } = await load();
      expect(await harnessState(deps, repo, BASE)).toEqual({ status: "ready", harness });
    },
  );
});

describe("what loading a harness asks a source for", () => {
  const NEWER_FILES: Files = {
    ...FILES,
    "docs/rules.md": "# Rules\n\n@style.md\n",
    "docs/style.md": "Style.\n",
    "docs/copy.md": "How.\n",
    "src/app.ts": "export const app = 1;\n",
  };

  it("reads only what the store doesn't have when the source lists", async () => {
    const { load, source } = setup(FILES);
    source.setFiles(repo, NEWER, NEWER_FILES);
    await load();
    expect(requests(source)).toEqual({
      lists: 1,
      diffs: 0,
      reads: [["CLAUDE.md"], ["docs/rules.md", "docs/plan.md", "docs/how.md"]],
    });

    const { harness } = await load(NEWER);
    expect(paths(harness)).toEqual([
      "CLAUDE.md",
      "docs/rules.md",
      "docs/plan.md",
      "docs/how.md",
      "docs/style.md",
    ]);
    expect(requests(source)).toEqual({
      lists: 2,
      diffs: 0,
      reads: [
        ["CLAUDE.md"],
        ["docs/rules.md", "docs/plan.md", "docs/how.md"],
        ["docs/rules.md"],
        ["docs/style.md"],
      ],
    });
  });

  it("makes one listing and no read when the listing holds nothing new", async () => {
    const { load, source } = setup(FILES);
    source.setFiles(repo, NEWER, { ...FILES, "src/app.ts": "changed" });
    const first = await load();
    const reads = requests(source).reads.length;
    expect((await load(NEWER)).harness).toEqual({ ...first.harness, baseSha: NEWER });
    expect(requests(source)).toMatchObject({ lists: 2, diffs: 0 });
    expect(requests(source).reads).toHaveLength(reads);
  });

  it("keeps the listing's hash of a file, and takes one listed but not given for unreadable", async () => {
    const { load, source } = setup({ "CLAUDE.md": "@a.md", "a.md": "A" });
    const blob = await gitBlobHash("as git has it");
    source.listFiles = async () => ({
      ok: true,
      value: new Map([
        ["CLAUDE.md", await gitBlobHash("@a.md")],
        ["a.md", blob],
        ["AGENTS.md", blob],
      ]),
    });
    const { harness } = await load();
    expect(harness.files[1]).toMatchObject({ path: "a.md", blob });
    expect(harness.skipped).toEqual([{ path: "AGENTS.md", reason: "unreadable" }]);
  });

  it("reads only what changed when the source says what did", async () => {
    const { load, source } = setup(FILES, { lists: false });
    source.setFiles(repo, NEWER, NEWER_FILES);
    await load();
    const reads = requests(source).reads.length;

    const { harness } = await load(NEWER);
    expect(harness.files.map(({ path }) => path)).toContain("docs/style.md");
    expect(requests(source).diffs).toBe(1);
    expect(requests(source).reads.slice(reads)).toEqual([["docs/rules.md"], ["docs/style.md"]]);
  });

  it("makes one diff and no read when nothing of the harness changed, missing and skipped paths too", async () => {
    const files: Files = {
      ...FILES,
      "REVIEW.md": "[none](none.md) and [image](image.txt)",
      "image.txt": { kind: "skipped", reason: "unreadable" },
    };
    const { load, source } = setup(files, { lists: false });
    source.setFiles(repo, NEWER, { ...files, "src/app.ts": "changed" });
    const first = await load();
    const reads = requests(source).reads.length;
    const { harness } = await load(NEWER);
    expect(harness).toEqual({ ...first.harness, baseSha: NEWER });
    expect(harness.skipped).toEqual([{ path: "image.txt", reason: "unreadable" }]);
    expect(requests(source)).toMatchObject({ diffs: 1 });
    expect(requests(source).reads).toHaveLength(reads);
  });

  it("finds a root and a linked file a change adds, and drops one it removes", async () => {
    const { load, source } = setup({ "CLAUDE.md": "@a.md @b.md", "a.md": "" }, { lists: false });
    source.setFiles(repo, NEWER, { "CLAUDE.md": "@a.md @b.md", "b.md": "", "AGENTS.md": "" });
    await load();
    const reads = requests(source).reads.length;
    expect(paths((await load(NEWER)).harness)).toEqual(["AGENTS.md", "CLAUDE.md", "b.md"]);
    expect(requests(source).reads.slice(reads)).toEqual([["AGENTS.md"], ["a.md", "b.md"]]);
  });

  it("reads each hop at once when the source can neither list nor say what changed", async () => {
    const { load, source } = setup(FILES, { lists: false, diffs: false });
    source.setFiles(repo, NEWER, FILES);
    const roots = [
      "REVIEW.md",
      "AGENTS.md",
      "CLAUDE.md",
      "CONTRIBUTING.md",
      ".github/copilot-instructions.md",
    ];
    const walk = [roots, ["docs/rules.md", "docs/plan.md", "docs/how.md"]];
    await load();
    expect(requests(source)).toEqual({ lists: 0, diffs: 0, reads: walk });
    await load(NEWER);
    expect(requests(source)).toEqual({ lists: 0, diffs: 0, reads: [...walk, ...walk] });
  });

  it("walks afresh when the last harness's commit is gone, and fails on another error", async () => {
    const gone: HostError = { kind: "not-found", message: "No commit", retryAfterSeconds: null };
    const { deps, load, source } = setup(FILES, { lists: false });
    source.setFiles(repo, NEWER, FILES);
    await load();
    source.failNext("changedPaths", network);
    expect(await loadHarness(deps, repo, NEWER)).toMatchObject({ ok: false });
    source.failNext("changedPaths", gone);
    expect(paths((await load(NEWER)).harness)).toHaveLength(4);
  });

  it("lists a folder from the listing, and from a source that can't list once a folder", async () => {
    const files: Files = { "CLAUDE.md": "docs/ and none/", "docs/a.md": "", "docs/b/c.md": "" };
    const listed = setup(files, { diffs: false });
    await listed.load();
    expect(listed.source.calls.listFolder).toEqual([]);

    const walked = setup(files, { lists: false, diffs: false });
    expect(paths((await walked.load()).harness)).toEqual(["CLAUDE.md", "docs/a.md", "docs/b/c.md"]);
    expect(walked.source.calls.listFolder).toEqual(["docs", "none"]);
    expect(requests(walked.source).reads.slice(1)).toEqual([["docs/a.md", "docs/b/c.md"]]);
  });

  it("lists a folder again after a change, but not one that wasn't there and still isn't", async () => {
    const files: Files = { "CLAUDE.md": "docs/ and none/", "docs/a.md": "" };
    const { load, source } = setup(files, { lists: false });
    source.setFiles(repo, NEWER, { ...files, "src/app.ts": "changed" });
    await load();
    await load(NEWER);
    expect(source.calls.listFolder).toEqual(["docs", "none", "docs"]);

    const newest = "c".repeat(40);
    source.setFiles(repo, newest, { ...files, "none/d.md": "" });
    expect(paths((await load(newest)).harness)).toEqual(["CLAUDE.md", "docs/a.md", "none/d.md"]);
    expect(source.calls.listFolder.slice(3)).toEqual(["docs", "none"]);
  });

  it("reads folders' files after every file named, however deep, so a large one crowds out none", async () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_HARNESS_FILES + 50 }, (_, index) => [`docs/${index}.md`, ""]),
    );
    const { load } = setup({
      "CLAUDE.md": "docs/ and @a.md",
      "a.md": "[b](b.md) and notes/",
      "b.md": "",
      "notes/c.md": "",
      ...many,
    });
    const { harness } = await load();
    expect(paths(harness).slice(0, 4)).toEqual(["CLAUDE.md", "a.md", "b.md", "docs/0.md"]);
    // Folders take what's left nearest a root first, as files do.
    expect(paths(harness)).not.toContain("notes/c.md");
    expect(harness.files).toHaveLength(MAX_HARNESS_FILES);
    expect(harness.cut).toBe("files");
  });

  it("says the harness was cut when a folder's listing is only part of it", async () => {
    const { load, source } = setup({ "CLAUDE.md": "docs/", "docs/a.md": "" }, { lists: false });
    source.listFolder = async () => ({
      ok: true,
      value: { files: ["docs/a.md"], complete: false },
    });
    const { harness } = await load();
    expect(paths(harness)).toEqual(["CLAUDE.md", "docs/a.md"]);
    expect(harness.cut).toBe("files");
  });

  it("asks for at most 400 paths it doesn't know are there, and says the harness was cut", async () => {
    const none = Array.from({ length: MAX_HARNESS_LOOKUPS + 50 }, (_, index) => `none-${index}.md`);
    const files = {
      "CLAUDE.md": `${none.map((path) => `@${path}`).join("\n")}\n@a.md`,
      "a.md": "",
    };
    const walked = setup(files, { lists: false });
    expect((await walked.load()).harness.cut).toBe("files");
    expect(requests(walked.source).reads.flat()).toHaveLength(MAX_HARNESS_LOOKUPS);

    const listed = setup(files);
    const { harness } = await listed.load();
    expect(harness.cut).toBeNull();
    expect(paths(harness)).toEqual(["CLAUDE.md", "a.md"]);
  });

  it("counts a folder it lists against the 400, and lists none past them", async () => {
    // The roots are asked for first.
    const left = MAX_HARNESS_LOOKUPS - GUIDELINE_PATHS.length;
    const none = Array.from({ length: left }, (_, index) => `@none-${index}.md`);
    const { load, source } = setup(
      { "CLAUDE.md": `${none.join("\n")}\ndocs/`, "docs/a.md": "" },
      { lists: false, diffs: false },
    );
    const { harness } = await load();
    expect(harness.cut).toBe("files");
    expect(source.calls.listFolder).toEqual([]);
  });
});

describe("loadHarness", () => {
  it("loads nothing for a repository without a source", async () => {
    const { deps, harnessStore } = setup();
    expect(await loadHarness({ ...deps, harnessSource: () => null }, repo, BASE)).toEqual({
      ok: true,
      value: null,
    });
    expect(await harnessStore.latestHarness(repo)).toBeNull();
    expect(await harnessState(deps, repo, BASE)).toEqual({ status: "none" });
  });

  it("never throws: a store that can't be read is an error, one that can't be written isn't", async () => {
    class BrokenStore extends InMemoryHarnessStore {
      broken: "getHarness" | "putHarness" = "putHarness";
      override async getHarness(...args: Parameters<InMemoryHarnessStore["getHarness"]>) {
        if (this.broken === "getHarness") throw new Error("disk full");
        return super.getHarness(...args);
      }
      override async putHarness() {
        throw new Error("disk full");
      }
    }
    const store = new BrokenStore();
    const { deps, load, logger } = setup(FILES, { store });
    expect(paths((await load()).harness)).toHaveLength(4);
    store.broken = "getHarness";
    expect(await loadHarness(deps, repo, BASE)).toEqual({
      ok: false,
      error: { code: "internal", message: "Couldn't load the repository's harness" },
    });
    expect(logger.entries.map(({ message }) => message)).toEqual([
      "Couldn't store the repository's harness",
      "Couldn't load the repository's harness",
    ]);
  });
});
