// Records a read of the token owner's past comments, scrubbed:
//   GITHUB_TOKEN=$(gh auth token) node src/adapters/github/fixtures/record-history.ts <owner>/<repo> [out.json]
// Writes history.json next to this file, or to the path given.
//
// Every comment's text becomes "Comment N.", the token owner's login "reviewer" and every other
// login "user-N". The repository's name, its pull requests' numbers and the files' paths stay,
// so record only from a public repository. The fixtures the tests read are history.synthetic.ts.

import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { createGitHubReviewHistory } from "../history.ts";
import {
  GitHubErrorBody,
  GitHubPullRequestComment,
  GitHubReviewedPullRequests,
  GitHubUser,
} from "../schemas.ts";

/** The format of createFixtureFetch in src/application/testing, which non-test code can't import. */
interface RecordedExchange {
  request: { method: string; url: string; accept?: string };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

const KEPT_HEADERS = /^(x-ratelimit-.*|retry-after|link|content-type)$/;
const REVIEWER = "reviewer";

const pathOf = (exchange: RecordedExchange): string => new URL(exchange.request.url).pathname;

/** The exchanges with only the fields the adapter reads, and without anyone's words or names. */
const scrubbed = (exchanges: readonly RecordedExchange[]): RecordedExchange[] => {
  const user = exchanges.find((exchange) => pathOf(exchange) === "/user");
  const ownerLogin = user === undefined ? null : GitHubUser.parse(user.response.body).login;
  const pseudonyms = new Map<string, string>();
  const pseudonym = (login: string): string => {
    if (login === ownerLogin) return REVIEWER;
    const known = pseudonyms.get(login) ?? `user-${pseudonyms.size + 1}`;
    pseudonyms.set(login, known);
    return known;
  };
  let comments = 0;

  const scrub = ({ status, body }: RecordedExchange["response"], path: string): unknown => {
    if (status >= 400) return GitHubErrorBody.parse(body);
    if (path === "/user") return { login: REVIEWER, name: null };
    if (path === "/search/issues") return GitHubReviewedPullRequests.parse(body);
    return z
      .array(GitHubPullRequestComment)
      .parse(body)
      .map((comment) => {
        comments += 1;
        return {
          ...comment,
          user: comment.user === null ? null : { login: pseudonym(comment.user.login) },
          body: `Comment ${comments}.`,
        };
      });
  };

  return exchanges.map((exchange) => ({
    ...exchange,
    response: { ...exchange.response, body: scrub(exchange.response, pathOf(exchange)) },
  }));
};

const main = async (): Promise<void> => {
  const [name, outPath] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = (name ?? "").split("/");
  if (owner === undefined || repo === undefined || token === undefined) {
    throw new Error("usage: GITHUB_TOKEN=... node record-history.ts <owner>/<repo> [out.json]");
  }

  const exchanges: RecordedExchange[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await fetch(request);
    exchanges.push({
      request: {
        method: request.method,
        url: request.url,
        accept: request.headers.get("accept") ?? "",
      },
      response: {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].filter(([header]) => KEPT_HEADERS.test(header)),
        ),
        body: await response.clone().json(),
      },
    });
    return response;
  };

  const log = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const history = createGitHubReviewHistory({
    token,
    version: "fixture-recorder",
    clock: { now: () => new Date().toISOString() },
    logger: { debug: () => {}, info: log, warn: log, error: log },
    fetch: recordingFetch,
  });

  // The two reads the contract suite makes.
  const target = { host: "github", owner, repo } as const;
  const all = await history.getReviewerComments(target, { pullRequests: 30 });
  if (!all.ok) throw new Error(all.error.message);
  const requests = exchanges.length;
  const one = await history.getReviewerComments(target, { pullRequests: 1 });
  if (!one.ok) throw new Error(one.error.message);

  // The second read asks again for what the first did; one of each is enough.
  const unique = [
    ...new Map(exchanges.map((exchange) => [exchange.request.url, exchange])).values(),
  ];
  const out = outPath ?? new URL("history.json", import.meta.url).pathname;
  await writeFile(out, `${JSON.stringify(scrubbed(unique), null, 2)}\n`);
  log(
    `read ${all.value.pullRequests} pull requests and ${all.value.comments.length} comments of yours in ${requests} requests; wrote ${unique.length} exchanges to ${out}`,
  );
};

await main();
