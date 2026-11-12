// Records the read fixtures: node src/adapters/bitbucket/fixtures/record.ts <pr-url>
// with BITBUCKET_EMAIL and BITBUCKET_API_TOKEN set. Writes read.json next to this file.
//
// It reads only the PR. `GET /user` would record the token owner and the listing would
// record their workspace, so those fixtures are written by hand. Publishing posts real
// comments, so publish fixtures are too.

import { writeFile } from "node:fs/promises";
import type { z } from "zod";
import { parsePullRequestUrl } from "../../../domain/review/index.ts";
import { createBitbucketHost } from "../bitbucket-host.ts";
import {
  BitbucketCommit,
  BitbucketCommitHash,
  BitbucketErrorBody,
  BitbucketPage,
  BitbucketPullRequestWithState,
} from "../schemas.ts";

/** The format of createFixtureFetch in src/application/testing, which non-test code can't import. */
interface RecordedExchange {
  request: { method: string; url: string; accept?: string; body?: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

const KEPT_HEADERS = /^(x-ratelimit-.*|retry-after|location|content-type)$/;

/** Keep only the fields the adapter reads, so fixtures hold no more than it uses. */
const BODY_SCHEMAS: [RegExp, z.ZodType][] = [
  [/\/pullrequests\/\d+$/, BitbucketPullRequestWithState],
  [/\/pullrequests\/\d+\/commits$/, BitbucketPage(BitbucketCommit)],
  [/\/(commit|merge-base)\/[^/]+$/, BitbucketCommitHash],
];

/** Raw bodies, kept byte for byte. */
const RAW = /\/(diff|src)\//;

/** Names are personal data, and Bitbucket has no public handle to put in their place. */
const pseudonym = (uuid: string): string => `user-${uuid.replace(/[{}]/g, "").slice(0, 8)}`;

const redactAccount = <T extends { uuid: string; display_name: string } | null | undefined>(
  account: T,
): T => (account == null ? account : { ...account, display_name: pseudonym(account.uuid) });

/** Trailers like "Approved-by: Name <email>", which Bitbucket adds to merge commits. */
const NAME_TRAILERS = /^([A-Za-z-]+-by): .*$/gm;

const redact = (path: string, body: unknown): unknown => {
  if (/\/pullrequests\/\d+$/.test(path)) {
    const pullRequest = BitbucketPullRequestWithState.parse(body);
    return { ...pullRequest, author: redactAccount(pullRequest.author) };
  }
  if (path.endsWith("/commits")) {
    const page = BitbucketPage(BitbucketCommit).parse(body);
    return {
      ...page,
      values: page.values.map((commit) => {
        const user = redactAccount(commit.author.user);
        // The git author carries an email. Keep only a pseudonym.
        return {
          ...commit,
          message: commit.message.replace(NAME_TRAILERS, "$1: someone"),
          author: { raw: user?.display_name ?? "author", user },
        };
      }),
    };
  }
  return body;
};

const prune = (url: string, status: number, text: string): unknown => {
  const path = new URL(url).pathname;
  if (status >= 400) {
    try {
      return BitbucketErrorBody.parse(JSON.parse(text));
    } catch {
      return text;
    }
  }
  if (RAW.test(path)) return text;
  const schema = BODY_SCHEMAS.find(([pattern]) => pattern.test(path))?.[1];
  if (schema === undefined) throw new Error(`no schema to prune ${path}`);
  // Parsing normalizes timestamps, which the adapter parses again unchanged.
  return redact(path, schema.parse(JSON.parse(text)));
};

const main = async (): Promise<void> => {
  const [url] = process.argv.slice(2);
  const email = process.env.BITBUCKET_EMAIL;
  const apiToken = process.env.BITBUCKET_API_TOKEN;
  if (url === undefined || email === undefined || apiToken === undefined) {
    throw new Error(
      "usage: BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... node record.ts <bitbucket-pr-url>",
    );
  }
  const ref = parsePullRequestUrl(url);
  if (!ref.ok || ref.value.repo.host !== "bitbucket") throw new Error(`not a Bitbucket PR: ${url}`);

  const exchanges: RecordedExchange[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const requestBody = await request.clone().text();
    const response = await fetch(request);
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
        body: prune(request.url, response.status, await response.clone().text()),
      },
    });
    return response;
  };

  const log = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const host = createBitbucketHost({
    username: email,
    password: apiToken,
    workspace: null,
    clock: { now: () => new Date().toISOString() },
    logger: { debug: () => {}, info: log, warn: log, error: log },
    fetch: recordingFetch,
  });

  const pullRequest = await host.getPullRequest(ref.value);
  if (!pullRequest.ok) throw new Error(pullRequest.error.message);
  const { headSha, diff } = pullRequest.value;
  const changedPath = /^\+\+\+ b\/(.+)$/m.exec(diff)?.[1];
  if (changedPath === undefined) throw new Error("the PR changes no file at head");

  await host.getFiles(ref.value.repo, [
    { sha: headSha, path: changedPath },
    { sha: headSha, path: "megareviewer-missing-file.txt" },
  ]);
  await host.getPullRequest({ ...ref.value, number: 999_999_999 });

  const out = new URL("read.json", import.meta.url);
  await writeFile(out, `${JSON.stringify(exchanges, null, 2)}\n`);
  log(`wrote ${exchanges.length} exchanges to ${out.pathname}`);
};

await main();
