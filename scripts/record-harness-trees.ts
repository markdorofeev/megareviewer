// Records the harness trees the loader's golden tests walk:
// GITHUB_TOKEN=$(gh auth token) node scripts/record-harness-trees.ts
// Each is a repository's Markdown and text paths at a commit, with the lines that hold links of
// the files the loader reads there, and every other file empty. megareviewer is read from this
// clone at HEAD, so commit what the recording should see first.

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { HarnessSource } from "../src/application/ports/index.ts";
import { InMemoryHarnessStore, RecordingLogger } from "../src/application/testing/index.ts";
import { loadHarness } from "../src/application/use-cases/index.ts";
import { BlobHash, harnessLinks, type RepoRef } from "../src/domain/review/index.ts";
import { ok } from "../src/domain/shared/index.ts";

interface Tree {
  readonly sha: string;
  readonly blobs: ReadonlyMap<string, BlobHash>;
  read(path: string): Promise<string>;
}

const KEPT = /\.(?:md|mdc|markdown|txt)$/i;
const isKept = (path: string): boolean => KEPT.test(path) || path === ".gitattributes";

const localTree = (sha: string): Tree => {
  const listing = execFileSync("git", ["ls-tree", "-r", "-z", sha], { encoding: "utf8" });
  const blobs = new Map<string, BlobHash>();
  for (const entry of listing.split("\0")) {
    const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/s.exec(entry);
    if (match?.[1] !== undefined && match[2] !== undefined && isKept(match[2])) {
      blobs.set(match[2], BlobHash.parse(match[1]));
    }
  }
  return {
    sha,
    blobs,
    read: async (path) => execFileSync("git", ["show", `${sha}:${path}`], { encoding: "utf8" }),
  };
};

const githubTree = async (owner: string, repo: string, token: string): Promise<Tree> => {
  const api = async (path: string): Promise<unknown> => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  };
  const { sha } = (await api("commits/HEAD")) as { sha: string };
  const { tree, truncated } = (await api(`git/trees/${sha}?recursive=1`)) as {
    tree: { path: string; type: string; sha: string }[];
    truncated: boolean;
  };
  if (truncated) throw new Error(`${owner}/${repo}'s tree is cut short`);
  const blobs = new Map<string, BlobHash>();
  for (const entry of tree) {
    if (entry.type === "blob" && isKept(entry.path))
      blobs.set(entry.path, BlobHash.parse(entry.sha));
  }
  return {
    sha,
    blobs,
    async read(path) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.text();
    },
  };
};

const sourceOf = (tree: Tree, read: Map<string, string>): HarnessSource => ({
  host: "github",
  listFiles: async () => ok(tree.blobs),
  async readFiles(_repo, _sha, paths) {
    return ok(
      await Promise.all(
        paths.map(async (path) => {
          const blob = tree.blobs.get(path);
          if (blob === undefined) return null;
          const content = await tree.read(path);
          read.set(path, content);
          return { kind: "text" as const, content, blob };
        }),
      ),
    );
  },
  listFolder: async () => ok(null),
  changedPaths: async () => ok(null),
});

/** A line that opens or closes a fence, kept so the lines between stay in it. */
const FENCE = /^[\s>]*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:`{3,}|~{3,})/;

/**
 * The lines that hold links and the fences around them, the others blank, when they link the same
 * files as the whole file does, else the whole file.
 */
const reduced = (path: string, content: string): string => {
  if (path === ".gitattributes") return content;
  const links = harnessLinks(path, content);
  if (links.length === 0) return "";
  const kept = content
    .split("\n")
    .map((line) => (FENCE.test(line) || harnessLinks(path, line).length > 0 ? line : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return isDeepStrictEqual(harnessLinks(path, kept), links) ? kept : content;
};

const record = async (name: string, repo: RepoRef, tree: Tree): Promise<void> => {
  const read = new Map<string, string>();
  const loaded = await loadHarness(
    {
      harnessSource: () => sourceOf(tree, read),
      harnessStore: new InMemoryHarnessStore(),
      logger: new RecordingLogger(),
    },
    repo,
    tree.sha,
  );
  if (!loaded.ok || loaded.value === null) throw new Error(`${name}: no harness`);
  const files = Object.fromEntries(
    [...tree.blobs.keys()].sort().map((path) => {
      const content = read.get(path);
      return [path, content === undefined ? "" : reduced(path, content)];
    }),
  );
  const out = new URL(`../src/application/use-cases/harness-trees/${name}.json`, import.meta.url);
  const fixture = { repository: `${repo.owner}/${repo.repo}`, commit: tree.sha, files };
  await writeFile(out, `${JSON.stringify(fixture, null, 2)}\n`);
  process.stderr.write(`${name}: ${tree.blobs.size} paths, ${read.size} read\n`);
};

const main = async (): Promise<void> => {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined) throw new Error("usage: GITHUB_TOKEN=... node record-harness-trees.ts");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await record(
    "megareviewer",
    { host: "github", owner: "markdorofeev", repo: "megareviewer" },
    localTree(head),
  );
  for (const [owner, repo] of [
    ["oracle", "graal"],
    ["pytorch", "pytorch"],
  ] as const) {
    await record(repo, { host: "github", owner, repo }, await githubTree(owner, repo, token));
  }
};

await main();
