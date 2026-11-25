// Records a read of the credentials' owner's past comments, scrubbed:
//   BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... node src/adapters/bitbucket/fixtures/record-history.ts <workspace>/<repo> [out.json]
// (or BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD). Writes history.json next to this file, or
// to the path given.
//
// Every comment's text becomes "Comment N.", the owner's UUID a made-up one and their name
// "reviewer", every other name "user-<uuid prefix>". The repository's name, its pull requests'
// numbers and the files' paths stay, so record only from a public repository. The fixtures the
// tests read are history.synthetic.ts.

import { writeFile } from "node:fs/promises";
import { createBitbucketReviewHistory } from "../history.ts";
import {
  BitbucketAccount,
  BitbucketErrorBody,
  BitbucketListedPullRequest,
  BitbucketPage,
  BitbucketRepositoryPermission,
  BitbucketThreadComment,
} from "../schemas.ts";

/** The format of createFixtureFetch in src/application/testing, which non-test code can't import. */
interface RecordedExchange {
  request: { method: string; url: string; accept?: string };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

const KEPT_HEADERS = /^(x-ratelimit-.*|retry-after|content-type)$/;
const PERMISSIONS = "/2.0/user/workspaces/";
const REVIEWER_UUID = "00000000-0000-4000-8000-000000000000";

const pathOf = (exchange: RecordedExchange): string => new URL(exchange.request.url).pathname;
const bare = (uuid: string): string => uuid.replace(/[{}]/g, "");

/** The owner's account, from whichever answer named them. */
const ownerIn = (exchange: RecordedExchange): BitbucketAccount | null => {
  const { response } = exchange;
  const path = pathOf(exchange);
  if (response.status >= 400) return null;
  if (path === "/2.0/user") return BitbucketAccount.parse(response.body);
  if (!path.startsWith(PERMISSIONS)) return null;
  return BitbucketPage(BitbucketRepositoryPermission).parse(response.body).values[0]?.user ?? null;
};

/** The exchanges with only the fields the adapter reads, and without anyone's words or names. */
const scrubbed = (exchanges: readonly RecordedExchange[]): string => {
  const owner = exchanges.map(ownerIn).find((account) => account !== null)?.uuid ?? null;
  const named = (account: BitbucketAccount | null | undefined) =>
    account == null
      ? account
      : {
          uuid: account.uuid,
          display_name:
            account.uuid === owner ? "reviewer" : `user-${bare(account.uuid).slice(0, 8)}`,
        };
  let comments = 0;

  const scrub = ({ status, body }: RecordedExchange["response"], path: string): unknown => {
    if (status >= 400) {
      const error = BitbucketErrorBody.safeParse(body);
      return error.success ? error.data : body;
    }
    if (path === "/2.0/user") return named(BitbucketAccount.parse(body));
    if (path.startsWith(PERMISSIONS)) {
      const permissions = BitbucketPage(BitbucketRepositoryPermission).parse(body);
      return { values: permissions.values.map(({ user }) => ({ user: named(user) })) };
    }
    if (path.endsWith("/pullrequests")) {
      return BitbucketPage(BitbucketListedPullRequest).parse(body);
    }
    const page = BitbucketPage(BitbucketThreadComment).parse(body);
    return {
      ...page,
      values: page.values.map((comment) => {
        comments += 1;
        return {
          ...comment,
          user: named(comment.user),
          content: { raw: `Comment ${comments}.` },
          // Who resolved a thread isn't read, and is someone's name.
          resolution: undefined,
        };
      }),
    };
  };

  const text = JSON.stringify(
    exchanges.map((exchange) => ({
      ...exchange,
      response: { ...exchange.response, body: scrub(exchange.response, pathOf(exchange)) },
    })),
    null,
    2,
  );
  // The owner's UUID is in the list's query and among the participants too.
  return owner === null ? text : text.replaceAll(bare(owner), REVIEWER_UUID);
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const main = async (): Promise<void> => {
  const [name, outPath] = process.argv.slice(2);
  const username = process.env.BITBUCKET_EMAIL ?? process.env.BITBUCKET_USERNAME;
  const password = process.env.BITBUCKET_API_TOKEN ?? process.env.BITBUCKET_APP_PASSWORD;
  const [owner, repo] = (name ?? "").split("/");
  if (owner === undefined || repo === undefined || !username || !password) {
    throw new Error(
      "usage: BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... node record-history.ts <workspace>/<repo> [out.json]",
    );
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
        body: await readBody(response.clone()),
      },
    });
    return response;
  };

  const log = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const history = createBitbucketReviewHistory({
    username,
    password,
    // The repository's own is asked, so the owner's workspace isn't recorded.
    workspace: null,
    logger: { debug: () => {}, info: log, warn: log, error: log },
    fetch: recordingFetch,
  });

  // The two reads the contract suite makes.
  const target = { host: "bitbucket", owner, repo } as const;
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
  await writeFile(out, `${scrubbed(unique)}\n`);
  log(
    `read ${all.value.pullRequests} pull requests and ${all.value.comments.length} comments of yours in ${requests} requests; wrote ${unique.length} exchanges to ${out}`,
  );
};

await main();
