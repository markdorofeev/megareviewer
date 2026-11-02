import { describe, expect, it } from "vitest";
import type { HostError, PullRequest } from "../../domain/review/index.ts";
import { createAnalysisEvents } from "../events/index.ts";
import {
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  RecordingLogger,
  smallFeature,
} from "../testing/index.ts";
import { collect } from "./collect.ts";
import type { AppDeps } from "./deps.ts";

const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);
const paths = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);

/** Twelve modified files: with .gitattributes, 25 files to fetch, so three batches. */
const pullRequest: PullRequest = {
  ...smallFeature.pullRequest,
  baseSha: BASE,
  headSha: HEAD,
  diff: paths
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
    )
    .join(""),
};
const { repo } = pullRequest.ref;

const networkError: HostError = {
  kind: "network",
  message: "Can't reach GitHub: other side closed",
  retryAfterSeconds: null,
};

const setup = () => {
  const host = new FakeGitHost({ host: "github" });
  host.setFiles(repo, BASE, Object.fromEntries(paths.map((path) => [path, `old ${path}`])));
  host.setFiles(repo, HEAD, Object.fromEntries(paths.map((path) => [path, `new ${path}`])));
  const fileCache = new InMemoryFileCache();
  const deps: AppDeps = {
    hosts: { github: host },
    tickets: new FakeTicketSource({ configured: false }),
    model: new FakeAnalysisModel(),
    modelConfigured: true,
    store: new InMemoryAnalysisStore(),
    fileCache,
    parser: new FakeCodeParser(),
    events: createAnalysisEvents(),
    clock: new FixedClock(),
    logger: new RecordingLogger(),
  };
  return { host, fileCache, deps };
};

const fetchedPaths = (host: FakeGitHost) =>
  host.getFilesCalls.flat().map(({ sha, path }) => `${sha === BASE ? "base" : "head"}:${path}`);

describe("collect", () => {
  it("fetches files in batches of 10", async () => {
    const { host, deps } = setup();

    const collected = await collect(deps, host, pullRequest);

    expect(host.getFilesCalls.map((call) => call.length)).toEqual([10, 10, 5]);
    expect(collected.ok && collected.value.headContents.get("src/f3.ts")).toBe("new src/f3.ts");
    expect(collected.ok && collected.value.baseContents.get("src/f3.ts")).toBe("old src/f3.ts");
  });

  it("doesn't fetch files the cache has, and uses its contents", async () => {
    const { host, deps, fileCache } = setup();
    for (const path of paths) await fileCache.put(repo, { sha: BASE, path }, `cached ${path}`);
    await fileCache.put(repo, { sha: BASE, path: ".gitattributes" }, null);

    const collected = await collect(deps, host, pullRequest);

    expect(fetchedPaths(host)).toEqual(paths.map((path) => `head:${path}`));
    expect(collected.ok && collected.value.baseContents.get("src/f0.ts")).toBe("cached src/f0.ts");
    expect(collected.ok && collected.value.gitattributes).toBeNull();
  });

  it("caches what it fetched, including files that aren't there", async () => {
    const { host, deps, fileCache } = setup();

    await collect(deps, host, pullRequest);

    expect(await fileCache.get(repo, { sha: HEAD, path: "src/f0.ts" })).toEqual({
      content: "new src/f0.ts",
    });
    expect(await fileCache.get(repo, { sha: BASE, path: ".gitattributes" })).toEqual({
      content: null,
    });
  });

  it("keeps the batches that worked when one fails, and fetches only the rest next time", async () => {
    const { host, deps } = setup();
    host.failNext("getFiles", networkError);

    const failed = await collect(deps, host, pullRequest);
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "host-error",
        message: `Couldn't fetch the pull request's files: ${networkError.message}`,
      },
    });
    const firstBatch = fetchedPaths(host).slice(0, 10);

    host.getFilesCalls.length = 0;
    const retried = await collect(deps, host, pullRequest);

    expect(retried.ok).toBe(true);
    expect(fetchedPaths(host)).toEqual(firstBatch);
  });

  it("reports how many files are in hand: the cached ones first, then after each batch", async () => {
    const { host, deps, fileCache } = setup();
    for (const path of paths) await fileCache.put(repo, { sha: BASE, path }, `cached ${path}`);
    await fileCache.put(repo, { sha: BASE, path: ".gitattributes" }, null);
    const reported: { done: number; total: number }[] = [];

    await collect(deps, host, pullRequest, async (progress) => {
      reported.push(progress);
    });

    expect(reported).toHaveLength(3);
    expect(reported[0]).toEqual({ done: 13, total: 25 });
    expect(reported.at(-1)).toEqual({ done: 25, total: 25 });
  });

  it("doesn't cache a file over 1 MB, which it treats as unavailable", async () => {
    const { host, deps, fileCache } = setup();
    host.setFiles(repo, HEAD, { "src/f0.ts": "x".repeat(1024 * 1024 + 1) });

    const collected = await collect(deps, host, pullRequest);

    expect(collected.ok && collected.value.headContents.get("src/f0.ts")).toBeNull();
    expect(await fileCache.get(repo, { sha: HEAD, path: "src/f0.ts" })).toBeNull();
  });
});
