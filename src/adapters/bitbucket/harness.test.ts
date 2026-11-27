import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describeHarnessSourceContract,
  InMemoryHarnessStore,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import { loadHarness } from "../../application/use-cases/index.ts";
import { MAX_HARNESS_FILE_BYTES, type RepoRef } from "../../domain/review/index.ts";
import harnessExchanges from "./fixtures/harness.json" with { type: "json" };
import { diffstatUrl, folderUrl } from "./harness.ts";
import { createBitbucketHarnessSource } from "./index.ts";

const API = "https://api.bitbucket.org/2.0";
const repo: RepoRef = { host: "bitbucket", owner: "atlassian", repo: "bitbucket-upload-file" };
const BASE_SHA = "9c2e7d9655b6ac495e905c8e20c933c8e45fa962";
const SHA = "b467819f28a4ca3cfbbdb889bd1bc7ba6918522d";
const aui: RepoRef = { host: "bitbucket", owner: "atlassian", repo: "aui" };
const AUI_FROM = "865f5463141f27cc3fc6631d6f064e817f0e0dcc";
const AUI_TO = "e9ba9f6a61f9b5725fa08e571970108fa8a7e930";
const PATCH = ".changes/next-release/patch-20241120112812901924.json";
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const fileUrl = (path: string, sha = SHA) =>
  `${API}/repositories/atlassian/bitbucket-upload-file/src/${sha}/${path}`;

const sourceOver = (fetch: typeof globalThis.fetch) =>
  createBitbucketHarnessSource({
    username: "reviewer@example.com",
    password: "test-token",
    logger: new RecordingLogger(),
    fetch,
  });
const sourceWith = (exchanges: readonly RecordedExchange[]) =>
  sourceOver(createFixtureFetch(exchanges));

const recordedText = (path: string): string => {
  const body: unknown = harnessExchanges.find(({ request }) => request.url === fileUrl(path))
    ?.response.body;
  if (typeof body !== "string") throw new Error(`no recorded text for ${path}`);
  return body;
};

const refusedAt = (url: string): RecordedExchange => ({
  request: { method: "GET", url },
  response: { status: 401, headers: { "content-type": "text/html" }, body: "" },
});

describeHarnessSourceContract("bitbucket", () => ({
  source: (scenario) =>
    sourceWith(
      scenario === "normal"
        ? harnessExchanges
        : [
            refusedAt(fileUrl("README.md")),
            refusedAt(folderUrl(repo, SHA, ".changes")),
            refusedAt(diffstatUrl(repo, BASE_SHA, SHA)),
          ],
    ),
  lists: false,
  diffs: true,
  repo,
  sha: SHA,
  files: [
    {
      path: "README.md",
      content: recordedText("README.md"),
      blob: "d95006dcc19bcc9965f2ff5466b1968964850522",
    },
    {
      path: PATCH,
      content: recordedText(PATCH),
      blob: "ea3e8c01058212dc3c4a8bed1a25f37c041a1aba",
    },
  ],
  directory: "pipe",
  folder: { path: ".changes", files: [".changes/0.1.0.json", PATCH] },
  missingPath: "megareviewer-missing-file.txt",
  change: {
    fromSha: BASE_SHA,
    toSha: SHA,
    paths: [
      PATCH,
      ".changes/next-release/patch-20241120112831338496.json",
      "bitbucket-pipelines.yml",
      "pipe/pipe.py",
      "test/test.py",
    ],
  },
}));

const response = (
  url: string,
  body: unknown,
  extra: { status?: number; headers?: Record<string, string> } = {},
): RecordedExchange => ({
  request: { method: "GET", url },
  response: {
    status: extra.status ?? 200,
    headers: { "content-type": "text/plain", ...extra.headers },
    body,
  },
});

describe("createBitbucketHarnessSource", () => {
  it("lists a folder's files over its pages, and says when it stopped before the last", async () => {
    const first = folderUrl(repo, SHA, "docs");
    const pageUrl = (page: number) => `${first}&page=${page}`;
    const page = (page: number, next: boolean): RecordedExchange =>
      response(
        page === 1 ? first : pageUrl(page),
        {
          values: [
            { path: `docs/${page}.md`, type: "commit_file" },
            { path: `docs/${page}`, type: "commit_directory" },
          ],
          ...(next ? { next: pageUrl(page + 1) } : {}),
        },
        { headers: jsonHeaders },
      );
    const twoPages = await sourceWith([page(1, true), page(2, false)]).listFolder(
      repo,
      SHA,
      "docs",
    );
    expect(twoPages).toEqual({
      ok: true,
      value: { files: ["docs/1.md", "docs/2.md"], complete: true },
    });

    const endless = Array.from({ length: 11 }, (_, index) => page(index + 1, true));
    const cut = await sourceWith(endless).listFolder(repo, SHA, "docs");
    expect(cut).toMatchObject({ ok: true, value: { complete: false } });
    expect(cut.ok ? cut.value?.files : []).toHaveLength(10);
  });

  it("hashes a file as git does", async () => {
    const read = async (content: string) => {
      const answer = await sourceWith([response(fileUrl("a.md"), content)]).readFiles(repo, SHA, [
        "a.md",
      ]);
      const [file] = answer.ok ? answer.value : [];
      return file?.kind === "text" ? file.blob : null;
    };
    // What `git hash-object` prints for each.
    expect(await read("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(await read("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(await read("– é 🦄\n")).toBe("7886645f3cb5a21a2782179ab3322aafb81cda58");
  });

  it("says a file is too large or isn't text, and reads the others", async () => {
    const source = sourceWith([
      response(fileUrl("large.md"), "x".repeat(MAX_HARNESS_FILE_BYTES + 1)),
      response(fileUrl("announced.md"), "x", {
        headers: { "content-length": String(MAX_HARNESS_FILE_BYTES + 1) },
      }),
      response(fileUrl("binary.md"), "a\u0000b", { headers: { "content-type": "image/png" } }),
      response(fileUrl("timed-out.md"), "", { status: 555 }),
      response(fileUrl("a%20b/c.md"), "text"),
    ]);
    expect(
      await source.readFiles(repo, SHA, [
        "large.md",
        "announced.md",
        "binary.md",
        "timed-out.md",
        "a b/c.md",
      ]),
    ).toEqual({
      ok: true,
      value: [
        { kind: "skipped", reason: "too-large" },
        { kind: "skipped", reason: "too-large" },
        { kind: "skipped", reason: "unreadable" },
        { kind: "skipped", reason: "too-large" },
        { kind: "text", content: "text", blob: "f3a34851d44d6b97c90fbb99dd3d18c261b9a237" },
      ],
    });
  });

  it("asks what changed up to the new commit, straight between the two", () => {
    expect(diffstatUrl(repo, BASE_SHA, SHA)).toBe(
      `${API}/repositories/atlassian/bitbucket-upload-file/diffstat/${SHA}..${BASE_SHA}?topic=false&pagelen=500&fields=next%2Cvalues.old.path%2Cvalues.new.path`,
    );
  });

  it("follows the diffstat's pages, with both paths of a renamed file", async () => {
    const changed = await sourceWith(harnessExchanges).changedPaths(aui, AUI_FROM, AUI_TO);
    const paths = changed.ok ? (changed.value ?? []) : [];
    expect(paths).toContain(".bitbucket/CODEOWNERS");
    expect(paths).toContain("p2/pom.xml");
    expect(paths).toContain("pom.xml");
  });

  it("can't say what changed past its pages, or when Bitbucket can't produce it", async () => {
    const url = diffstatUrl(repo, BASE_SHA, SHA);
    const endless = sourceWith([
      response(
        url,
        { values: [{ old: null, new: { path: "a.md" } }], next: url },
        {
          headers: jsonHeaders,
        },
      ),
    ]);
    expect(await endless.changedPaths(repo, BASE_SHA, SHA)).toEqual({ ok: true, value: null });
    const timedOut = sourceWith([response(url, "", { status: 555 })]);
    expect(await timedOut.changedPaths(repo, BASE_SHA, SHA)).toEqual({ ok: true, value: null });
  });

  it("says a commit that's gone is missing", async () => {
    const gone = sourceWith([
      response(
        diffstatUrl(repo, BASE_SHA, SHA),
        { error: { message: "The source or destination could not be found for spec" } },
        { status: 404, headers: jsonHeaders },
      ),
    ]);
    expect(await gone.changedPaths(repo, BASE_SHA, SHA)).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });
  });
});

describe("loading a harness from Bitbucket", () => {
  it("asks what changed and for no file when nothing in the harness did", async () => {
    const files: Readonly<Record<string, string>> = {
      "CLAUDE.md": "@docs/rules.md\nSee docs/gone.md.\n",
      "docs/rules.md": "- Name the test.\n",
    };
    const requests: string[] = [];
    const source = sourceOver(async (input, init) => {
      const { url } = new Request(input, init);
      requests.push(url.replace(/^.*\/bitbucket-upload-file\//, "").replace(/\?.*$/, ""));
      const path = /\/src\/\w+\/(.*)$/.exec(url)?.[1];
      if (path === undefined) {
        return new Response(JSON.stringify({ values: [{ old: null, new: { path: "a.py" } }] }), {
          headers: jsonHeaders,
        });
      }
      const content = files[path];
      return new Response(content ?? "", {
        status: content === undefined ? 404 : 200,
        headers: { "content-type": "text/plain" },
      });
    });
    const deps = {
      harnessSource: () => source,
      harnessStore: new InMemoryHarnessStore(),
      logger: new RecordingLogger(),
    };
    expect((await loadHarness(deps, repo, BASE_SHA)).ok).toBe(true);
    // The five roots and .gitattributes, then what CLAUDE.md links.
    expect(requests).toHaveLength(8);
    requests.length = 0;

    const loaded = await loadHarness(deps, repo, SHA);

    expect(loaded.ok && loaded.value?.harness.files.map(({ path }) => path)).toEqual([
      "CLAUDE.md",
      "docs/rules.md",
    ]);
    expect(requests).toEqual([`diffstat/${SHA}..${BASE_SHA}`]);
  });
});
