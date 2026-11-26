// Records the harness fixtures: node src/adapters/github/fixtures/record-harness.ts
// with GITHUB_TOKEN set (e.g. GITHUB_TOKEN=$(gh auth token)). Writes harness.json next to this
// file, from two public repositories.

import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { RepoRef } from "../../../domain/review/index.ts";
import { createGitHubHarnessSource } from "../harness.ts";
import { GitHubErrorBody, GitHubHarnessBlobs, GitHubTree } from "../schemas.ts";

const REPO: RepoRef = { host: "github", owner: "sindresorhus", repo: "is" };
const SHA = "e9c026c611c1160eaad50da00be4e676b626018f";
/** A tree GitHub cuts short; its first entries are enough to tell it from a whole one. */
const LARGE: RepoRef = { host: "github", owner: "torvalds", repo: "linux" };
const LARGE_SHA = "adc218676eef25575469234709c2d87185ca223a";
const KEPT_ENTRIES = 3;

const KEPT_HEADERS = /^(x-ratelimit-.*|retry-after|content-type)$/;

const prune = (status: number, body: unknown): unknown => {
  if (status >= 400) return GitHubErrorBody.parse(body);
  const tree = GitHubTree.safeParse(body);
  if (!tree.success) return z.object({ data: GitHubHarnessBlobs }).parse(body);
  const { truncated, tree: entries } = tree.data;
  return { truncated, tree: truncated ? entries.slice(0, KEPT_ENTRIES) : entries };
};

const main = async (): Promise<void> => {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined) throw new Error("usage: GITHUB_TOKEN=... node record-harness.ts");
  const exchanges: unknown[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const requestBody = await request.clone().text();
    const response = await fetch(request);
    exchanges.push({
      request: {
        method: request.method,
        url: request.url,
        ...(requestBody === "" ? {} : { body: JSON.parse(requestBody) }),
      },
      response: {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].filter(([name]) => KEPT_HEADERS.test(name)),
        ),
        body: prune(response.status, await response.clone().json()),
      },
    });
    return response;
  };
  const log = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const source = createGitHubHarnessSource({
    token,
    version: "fixture-recorder",
    clock: { now: () => new Date().toISOString(), wait: async () => {} },
    logger: { debug: () => {}, info: log, warn: log, error: log },
    fetch: recordingFetch,
  });
  const recorded = [
    await source.listFiles(REPO, SHA),
    await source.listFiles(LARGE, LARGE_SHA),
    // In the order the contract suite asks.
    await source.readFiles(REPO, SHA, [
      "megareviewer-missing-file.txt",
      "readme.md",
      "AGENTS.md",
      ".github/security.md",
      "source",
    ]),
    await source.readFiles(REPO, SHA, ["header.gif"]),
  ];
  for (const result of recorded) if (!result.ok) throw new Error(result.error.message);
  const out = new URL("harness.json", import.meta.url);
  await writeFile(out, `${JSON.stringify(exchanges, null, 2)}\n`);
  log(`wrote ${exchanges.length} exchanges to ${out.pathname}`);
};

await main();
