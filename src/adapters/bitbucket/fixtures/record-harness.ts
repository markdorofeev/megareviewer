// Records the harness fixtures: node src/adapters/bitbucket/fixtures/record-harness.ts
// with BITBUCKET_EMAIL and BITBUCKET_API_TOKEN set. Writes harness.json next to this file, from
// two public repositories.

import { writeFile } from "node:fs/promises";
import type { RepoRef } from "../../../domain/review/index.ts";
import { createBitbucketHarnessSource } from "../harness.ts";
import { BitbucketDiffstat, BitbucketPage } from "../schemas.ts";

const REPO: RepoRef = { host: "bitbucket", owner: "atlassian", repo: "bitbucket-upload-file" };
const BASE_SHA = "9c2e7d9655b6ac495e905c8e20c933c8e45fa962";
const SHA = "b467819f28a4ca3cfbbdb889bd1bc7ba6918522d";
/** Two commits 700 files apart, so on two pages, one of them renamed. */
const LARGE: RepoRef = { host: "bitbucket", owner: "atlassian", repo: "aui" };
const FROM_SHA = "865f5463141f27cc3fc6631d6f064e817f0e0dcc";
const TO_SHA = "e9ba9f6a61f9b5725fa08e571970108fa8a7e930";
/** Kept of each page, with every renamed file. */
const KEPT_FILES = 5;

const KEPT_HEADERS = /^(x-ratelimit-.*|retry-after|content-type)$/;

const prune = (url: string, { status, headers }: Response, text: string): unknown => {
  if (status >= 400) return text;
  if (!new URL(url).pathname.includes("/diffstat/")) {
    // A folder's listing asks only for what's read; a directory's carries links and commits too.
    if (new URL(url).searchParams.has("max_depth")) return JSON.parse(text);
    return headers.get("content-type")?.startsWith("application/json") ? { values: [] } : text;
  }
  const { values, next } = BitbucketPage(BitbucketDiffstat).parse(JSON.parse(text));
  const renamed = values.filter((file) => file.old && file.new && file.old.path !== file.new.path);
  return { values: [...new Set([...values.slice(0, KEPT_FILES), ...renamed])], next };
};

const main = async (): Promise<void> => {
  const username = process.env.BITBUCKET_EMAIL ?? process.env.BITBUCKET_USERNAME;
  const password = process.env.BITBUCKET_API_TOKEN ?? process.env.BITBUCKET_APP_PASSWORD;
  if (username === undefined || password === undefined) {
    throw new Error("usage: BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... node record-harness.ts");
  }
  const exchanges: unknown[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await fetch(request);
    exchanges.push({
      request: { method: request.method, url: request.url },
      response: {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].filter(([name]) => KEPT_HEADERS.test(name)),
        ),
        body: prune(request.url, response, await response.clone().text()),
      },
    });
    return response;
  };
  const log = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const source = createBitbucketHarnessSource({
    username,
    password,
    logger: { debug: () => {}, info: log, warn: log, error: log },
    fetch: recordingFetch,
  });
  const recorded = [
    await source.readFiles(REPO, SHA, [
      "megareviewer-missing-file.txt",
      ".changes/next-release/patch-20241120112812901924.json",
      "README.md",
      "pipe",
    ]),
    await source.listFolder(REPO, SHA, ".changes"),
    await source.listFolder(REPO, SHA, "README.md"),
    await source.listFolder(REPO, SHA, "megareviewer-missing-file.txt"),
    await source.changedPaths(REPO, BASE_SHA, SHA),
    await source.changedPaths(LARGE, FROM_SHA, TO_SHA),
  ];
  for (const result of recorded) if (!result.ok) throw new Error(result.error.message);
  const out = new URL("harness.json", import.meta.url);
  await writeFile(out, `${JSON.stringify(exchanges, null, 2)}\n`);
  log(`wrote ${exchanges.length} exchanges to ${out.pathname}`);
};

await main();
