// Records the read fixtures: node src/adapters/github/fixtures/record.ts <pr-url>
// with GITHUB_TOKEN set (e.g. GITHUB_TOKEN=$(gh auth token)). Writes read.json next to this file.
//
// It reads only the PR and the token's user. The search behind listPullRequests would record
// the token owner's own PRs, so search.synthetic.json is written by hand. Publishing posts a
// real review, so publish.synthetic.json is too.

import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { retryingGitHost } from "../../../application/retries/index.ts";
import { parsePullRequestUrl } from "../../../domain/review/index.ts";
import { createGitHubHost } from "../github-host.ts";
import {
  GitHubBlobs,
  GitHubCommit,
  GitHubComparison,
  GitHubErrorBody,
  GitHubPullRequest,
  GitHubUser,
} from "../schemas.ts";

/** The format of createFixtureFetch in src/application/testing, which non-test code can't import. */
interface RecordedExchange {
  request: { method: string; url: string; accept?: string; body?: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

const KEPT_HEADERS = /^(x-ratelimit-.*|retry-after|link|content-type)$/;

/** Keep only the fields the adapter reads, so fixtures hold no more than it uses. */
const BODY_SCHEMAS: [RegExp, z.ZodType][] = [
  [/\/user$/, GitHubUser],
  [/\/pulls\/\d+$/, GitHubPullRequest],
  [/\/pulls\/\d+\/commits$/, GitHubCommit.array()],
  [/\/compare\/[^/]+$/, GitHubComparison],
  [/^\/graphql$/, z.object({ data: GitHubBlobs })],
];

const prune = (url: string, status: number, body: unknown): unknown => {
  if (typeof body === "string") return body;
  if (status >= 400) return GitHubErrorBody.parse(body);
  const path = new URL(url).pathname;
  const schema = BODY_SCHEMAS.find(([pattern]) => pattern.test(path))?.[1];
  if (schema === undefined) throw new Error(`no schema to prune ${path}`);
  return redact(path, schema.parse(body));
};

/** Names are personal data; logins are public. */
const redact = (path: string, body: unknown): unknown => {
  if (path === "/user") return { ...GitHubUser.parse(body), name: null };
  if (path.endsWith("/commits")) {
    return GitHubCommit.array()
      .parse(body)
      .map((commit) => ({
        ...commit,
        commit: { ...commit.commit, author: { name: commit.author?.login ?? "author" } },
      }));
  }
  return body;
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!(response.headers.get("content-type") ?? "").includes("json")) return text;
  return text === "" ? null : JSON.parse(text);
};

const main = async (): Promise<void> => {
  const [url] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  if (url === undefined || token === undefined) {
    throw new Error("usage: GITHUB_TOKEN=... node record.ts <github-pr-url>");
  }
  const ref = parsePullRequestUrl(url);
  if (!ref.ok || ref.value.repo.host !== "github") throw new Error(`not a GitHub PR: ${url}`);

  const exchanges: RecordedExchange[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const requestBody = await request.clone().text();
    const response = await fetch(request);
    const body = await readBody(response.clone());
    exchanges.push({
      request: {
        method: request.method,
        url: request.url,
        accept: request.headers.get("accept") ?? "",
        ...(requestBody === "" ? {} : { body: JSON.parse(requestBody) }),
      },
      response: {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].filter(([name]) => KEPT_HEADERS.test(name)),
        ),
        body: prune(request.url, response.status, body),
      },
    });
    return response;
  };

  const log = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const logger = { debug: () => {}, info: log, warn: log, error: log };
  // Retried like the app's hosts, so a flaky link doesn't stop a recording. A failed attempt
  // records nothing.
  const host = retryingGitHost(
    createGitHubHost({
      token,
      version: "fixture-recorder",
      clock: { now: () => new Date().toISOString() },
      logger,
      fetch: recordingFetch,
    }),
    { sleep, logger },
  );

  const pullRequest = await host.getPullRequest(ref.value);
  if (!pullRequest.ok) throw new Error(pullRequest.error.message);
  const { headSha, diff } = pullRequest.value;
  const changedPath = /^\+\+\+ b\/(.+)$/m.exec(diff)?.[1];
  if (changedPath === undefined) throw new Error("the PR changes no file at head");

  await host.currentUser();
  // The order the contract suite asks in: a missing file, then one the PR changes.
  await host.getFiles(ref.value.repo, [
    { sha: headSha, path: "megareviewer-missing-file.txt" },
    { sha: headSha, path: changedPath },
  ]);
  await host.getPullRequest({ ...ref.value, number: 999_999_999 });

  // A retry records the requests that succeeded in the failed attempt again; keep one of each.
  const unique = [
    ...new Map(exchanges.map((exchange) => [JSON.stringify(exchange.request), exchange])).values(),
  ];
  const out = new URL("read.json", import.meta.url);
  await writeFile(out, `${JSON.stringify(unique, null, 2)}\n`);
  log(`wrote ${unique.length} exchanges to ${out.pathname}`);
};

await main();
