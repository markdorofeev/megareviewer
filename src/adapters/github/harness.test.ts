import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createFixtureFetch,
  describeHarnessSourceContract,
  FixedClock,
  gitBlobHash,
  InMemoryHarnessStore,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import { loadHarness } from "../../application/use-cases/index.ts";
import { MAX_HARNESS_FILE_BYTES, type RepoRef } from "../../domain/review/index.ts";
import harnessExchanges from "./fixtures/harness.json" with { type: "json" };
import { createGitHubHarnessSource } from "./index.ts";
import { GitHubHarnessBlobs } from "./schemas.ts";

const API = "https://api.github.com";
const repo: RepoRef = { host: "github", owner: "sindresorhus", repo: "is" };
const SHA = "e9c026c611c1160eaad50da00be4e676b626018f";
const linux: RepoRef = { host: "github", owner: "torvalds", repo: "linux" };
const LINUX_SHA = "adc218676eef25575469234709c2d87185ca223a";
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const sourceOver = (fetch: typeof globalThis.fetch) =>
  createGitHubHarnessSource({
    token: "test-token",
    version: "test",
    clock: new FixedClock(),
    logger: new RecordingLogger(),
    fetch,
  });
const sourceWith = (exchanges: readonly RecordedExchange[]) =>
  sourceOver(createFixtureFetch(exchanges));

const treeUrl = (of: RepoRef, sha: string) =>
  `${API}/repos/${of.owner}/${of.repo}/git/trees/${sha}?recursive=1`;
const refused = { message: "Bad credentials" };
const unauthorizedExchanges: RecordedExchange[] = [
  {
    request: { method: "GET", url: treeUrl(repo, SHA) },
    response: { status: 401, headers: jsonHeaders, body: refused },
  },
  {
    request: { method: "GET", url: treeUrl(repo, `${SHA}%3A.github`) },
    response: { status: 401, headers: jsonHeaders, body: refused },
  },
  {
    request: { method: "POST", url: `${API}/graphql` },
    response: { status: 401, headers: jsonHeaders, body: refused },
  },
];

const RecordedQuery = z.object({
  request: z.object({ body: z.object({ variables: z.record(z.string(), z.string()) }) }),
  response: z.object({ body: z.object({ data: GitHubHarnessBlobs }) }),
});

/** The recorded text of a file, whose hash below is what `git ls-tree` prints. */
const recordedText = (path: string): string => {
  for (const exchange of harnessExchanges) {
    const query = RecordedQuery.safeParse(exchange);
    if (!query.success) continue;
    const { variables } = query.data.request.body;
    const [name] = Object.entries(variables).find(([, value]) => value === `${SHA}:${path}`) ?? [];
    const { repository } = query.data.response.body.data;
    const text = name === undefined ? null : repository[name.replace("e", "f")]?.text;
    if (typeof text === "string") return text;
  }
  throw new Error(`no recorded text for ${path}`);
};

describeHarnessSourceContract("github", () => ({
  source: (scenario) =>
    sourceWith(scenario === "normal" ? harnessExchanges : unauthorizedExchanges),
  lists: true,
  diffs: false,
  repo,
  sha: SHA,
  files: [
    {
      path: ".github/security.md",
      content: recordedText(".github/security.md"),
      blob: "34a527ba6b8ef13393330073af5ec736b2e7393a",
    },
    {
      path: "AGENTS.md",
      content: recordedText("AGENTS.md"),
      blob: "2996cf5a36aab4c3067cd8bd0f8286229759f1dd",
    },
    {
      path: "readme.md",
      content: recordedText("readme.md"),
      blob: "509f75fc162053037b834ddb86c12a674a31619a",
    },
  ],
  directory: "source",
  folder: { path: ".github", files: [".github/security.md", ".github/workflows/main.yml"] },
  missingPath: "megareviewer-missing-file.txt",
  skipped: { path: "header.gif", reason: "unreadable" },
  change: null,
}));

const FileQuery = z.object({ variables: z.record(z.string(), z.string()) });

/** A GitHub over files by commit, which answers trees and file queries and counts them. */
const fakeGitHub = async (commits: Readonly<Record<string, Readonly<Record<string, string>>>>) => {
  const requests = { trees: 0, queries: 0 };
  const most = { files: 0, queries: 0 };
  let going = 0;
  const hashes = new Map<string, string>();
  for (const files of Object.values(commits)) {
    for (const content of Object.values(files)) hashes.set(content, await gitBlobHash(content));
  }
  const answer = (body: unknown) => new Response(JSON.stringify(body), { headers: jsonHeaders });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const tree = /\/git\/trees\/(\w+)\?/.exec(request.url);
    if (tree !== null) {
      requests.trees += 1;
      return answer({
        truncated: false,
        tree: Object.entries(commits[tree[1] ?? ""] ?? {}).map(([path, content]) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: hashes.get(content),
        })),
      });
    }
    requests.queries += 1;
    going += 1;
    most.queries = Math.max(most.queries, going);
    await new Promise((resolve) => setTimeout(resolve, 1));
    going -= 1;
    const { variables } = FileQuery.parse(await request.json());
    const asked = Object.keys(variables).filter((name) => /^e\d+$/.test(name)).length;
    most.files = Math.max(most.files, asked);
    const repository = Object.fromEntries(
      Object.entries(variables)
        .filter(([name]) => /^e\d+$/.test(name))
        .map(([name, expression]) => {
          const [sha = "", path = ""] = expression.split(":");
          const text = commits[sha]?.[path];
          return [
            name.replace("e", "f"),
            text === undefined
              ? null
              : {
                  __typename: "Blob",
                  text,
                  isBinary: false,
                  isTruncated: false,
                  oid: hashes.get(text),
                  byteSize: text.length,
                },
          ];
        }),
    );
    return answer({ data: { repository } });
  };
  return { source: sourceOver(fetch), requests, most };
};

describe("createGitHubHarnessSource", () => {
  it("lists a folder's files without its symlinks, and says when GitHub cut its tree short", async () => {
    const folder = (truncated: boolean): RecordedExchange => ({
      request: { method: "GET", url: treeUrl(repo, `${SHA}%3Adocs/a%20b`) },
      response: {
        status: 200,
        headers: jsonHeaders,
        body: {
          truncated,
          tree: [
            { path: "rules.md", mode: "100644", type: "blob", sha: "a".repeat(40) },
            { path: "api", mode: "040000", type: "tree", sha: "b".repeat(40) },
            { path: "api/errors.md", mode: "100644", type: "blob", sha: "c".repeat(40) },
            { path: "link.md", mode: "120000", type: "blob", sha: "d".repeat(40) },
          ],
        },
      },
    });
    const files = ["docs/a b/rules.md", "docs/a b/api/errors.md"];
    expect(await sourceWith([folder(false)]).listFolder(repo, SHA, "docs/a b")).toEqual({
      ok: true,
      value: { files, complete: true },
    });
    expect(await sourceWith([folder(true)]).listFolder(repo, SHA, "docs/a b")).toEqual({
      ok: true,
      value: { files, complete: false },
    });
  });

  it("leaves a symlink out of the list, whose blob holds a path and no rules", async () => {
    const listed = await sourceWith(harnessExchanges).listFiles(repo, SHA);
    const paths = listed.ok && listed.value !== null ? [...listed.value.keys()] : [];
    expect(paths).toContain("AGENTS.md");
    // A link to AGENTS.md in this repository.
    expect(paths).not.toContain("CLAUDE.md");
  });

  it("leaves a submodule out of the list", async () => {
    const source = sourceWith([
      {
        request: { method: "GET", url: treeUrl(repo, SHA) },
        response: {
          status: 200,
          headers: jsonHeaders,
          body: {
            truncated: false,
            tree: [{ path: "vendored", mode: "160000", type: "commit", sha: "a".repeat(40) }],
          },
        },
      },
    ]);
    expect(await source.listFiles(repo, SHA)).toEqual({ ok: true, value: new Map() });
  });

  it("can't list a tree GitHub cuts short", async () => {
    expect(await sourceWith(harnessExchanges).listFiles(linux, LINUX_SHA)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("says a commit that isn't there is missing, never empty", async () => {
    const source = sourceWith([
      {
        request: { method: "GET", url: treeUrl(repo, "0".repeat(40)) },
        response: { status: 404, headers: jsonHeaders, body: { message: "Not Found" } },
      },
    ]);
    expect(await source.listFiles(repo, "0".repeat(40))).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });
  });

  const blob = (fields: object) => ({
    __typename: "Blob",
    oid: "b".repeat(40),
    isBinary: false,
    isTruncated: false,
    byteSize: 10,
    text: "text",
    ...fields,
  });
  const reading = (fields: object, rest: readonly RecordedExchange[] = []) =>
    sourceWith([
      {
        request: { method: "POST", url: `${API}/graphql` },
        response: {
          status: 200,
          headers: jsonHeaders,
          body: { data: { repository: { f0: blob(fields) } } },
        },
      },
      ...rest,
    ]).readFiles(repo, SHA, ["docs/long file.md"]);
  const rawUrl = `${API}/repos/sindresorhus/is/contents/docs/long%20file.md?ref=${SHA}`;

  it("reads a file GraphQL cuts short whole over REST, with GraphQL's hash", async () => {
    const read = await reading({ isTruncated: true, text: "the start", byteSize: 700_000 }, [
      {
        request: { method: "GET", url: rawUrl },
        response: { status: 200, headers: { "content-type": "text/plain" }, body: "the whole" },
      },
    ]);
    expect(read).toEqual({
      ok: true,
      value: [{ kind: "text", content: "the whole", blob: "b".repeat(40) }],
    });
  });

  it("says a cut file REST won't give is unreadable, and passes another failure on", async () => {
    const answering = (status: number) =>
      reading({ isTruncated: true, text: "the start" }, [
        {
          request: { method: "GET", url: rawUrl },
          response: { status, headers: jsonHeaders, body: { message: "no" } },
        },
      ]);
    expect(await answering(404)).toEqual({
      ok: true,
      value: [{ kind: "skipped", reason: "unreadable" }],
    });
    expect(await answering(401)).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
  });

  it("doesn't download a file over the limit", async () => {
    expect(await reading({ isTruncated: true, byteSize: MAX_HARNESS_FILE_BYTES + 1 })).toEqual({
      ok: true,
      value: [{ kind: "skipped", reason: "too-large" }],
    });
  });

  it("reads more files than one query takes in order", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `docs/${i}.md`);
    const { source, requests } = await fakeGitHub({
      [SHA]: Object.fromEntries(paths.map((path) => [path, `# ${path}`])),
    });
    const read = await source.readFiles(repo, SHA, paths);
    expect(
      read.ok && read.value.map((file) => (file?.kind === "text" ? file.content : null)),
    ).toEqual(paths.map((path) => `# ${path}`));
    expect(requests).toEqual({ trees: 0, queries: 10 });
  });

  it("asks for three files a query, six queries at a time", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `docs/${i}.md`);
    const { source, most } = await fakeGitHub({
      [SHA]: Object.fromEntries(paths.map((path) => [path, `# ${path}`])),
    });
    await source.readFiles(repo, SHA, paths);
    expect(most).toEqual({ files: 3, queries: 6 });
  });
});

describe("loading a harness from GitHub", () => {
  it("asks for the tree and no file at a base commit whose files are all stored", async () => {
    const files = { "CLAUDE.md": "@docs/rules.md\n", "docs/rules.md": "- Name the test.\n" };
    const NEXT = "f".repeat(40);
    const { source, requests } = await fakeGitHub({
      [SHA]: files,
      [NEXT]: { ...files, "src/app.ts": "changed" },
    });
    const deps = {
      harnessSource: () => source,
      harnessStore: new InMemoryHarnessStore(),
      logger: new RecordingLogger(),
    };
    expect((await loadHarness(deps, repo, SHA)).ok).toBe(true);
    // The tree, the root, then the file it imports.
    expect(requests).toEqual({ trees: 1, queries: 2 });

    const loaded = await loadHarness(deps, repo, NEXT);

    expect(loaded.ok && loaded.value?.harness.files.map(({ path }) => path)).toEqual([
      "CLAUDE.md",
      "docs/rules.md",
    ]);
    expect(requests).toEqual({ trees: 2, queries: 2 });
  });
});
