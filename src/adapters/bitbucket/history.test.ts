import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describeReviewHistoryContract,
  RecordingLogger,
} from "../../application/testing/index.ts";
import {
  comment,
  type Exchange,
  get,
  HIDDEN_REPO,
  HISTORY_REPO,
  hiddenRepoExchanges,
  historyExchanges,
  LEE,
  LIST_PAGE_2,
  listed,
  reviewedAt,
  UNREVIEWED_REPO,
  userExchange,
} from "./fixtures/history.synthetic.ts";
import {
  commentsUrl,
  LISTED_PER_PAGE,
  MAX_PAST_COMMENTS,
  othersPullRequestsUrl,
} from "./history.ts";
import { createBitbucketReviewHistory } from "./index.ts";

const historyWith = (fetch: typeof globalThis.fetch, logger = new RecordingLogger()) =>
  createBitbucketReviewHistory({ username: "lee", password: "token", logger, fetch });

describeReviewHistoryContract("bitbucket", () => ({
  history: () => historyWith(createFixtureFetch(historyExchanges)),
  repo: HISTORY_REPO,
  unreviewedRepo: UNREVIEWED_REPO,
}));

const LIST = othersPullRequestsUrl(HISTORY_REPO, LEE.uuid);

/** `count` reviewed pull requests, #1 the most recently updated, each with `perPullRequest` comments. */
const manyExchanges = (count: number, perPullRequest: number): Exchange[] => {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const at = (number: number, minute: number) =>
    new Date(Date.UTC(2026, 0, 31 - number, 12, minute)).toISOString();
  return [
    userExchange,
    get(LIST, { values: numbers.map((number) => reviewedAt(number, at(number, 59))) }),
    ...numbers.map((number) =>
      get(commentsUrl(HISTORY_REPO, number), {
        values: Array.from({ length: perPullRequest }, (_, i) =>
          comment({
            id: number * 1000 + i,
            content: { raw: `Comment ${i + 1} on #${number}.` },
            created_on: at(number, i % 60),
            inline: { path: "shop/orders.py", from: null, to: i + 1 },
          }),
        ),
      }),
    ),
  ];
};

/** A fetch that answers from `exchanges` and keeps the URLs asked for, in order. */
const counting = (exchanges: readonly Exchange[]) => {
  const recorded = createFixtureFetch(exchanges);
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    urls.push(new Request(input, init).url);
    return recorded(input, init);
  };
  return { fetch, urls };
};

describe("Bitbucket review history", () => {
  it("reads the pull requests the user acted on, asked to review or not, and their comments on code", async () => {
    const result = await historyWith(createFixtureFetch(historyExchanges)).getReviewerComments(
      HISTORY_REPO,
      { pullRequests: 30 },
    );
    if (!result.ok) throw new Error(result.error.message);

    // #25 was read too, approved without a comment; #30, never acted on, and #29 weren't.
    expect(result.value.pullRequests).toBe(3);
    expect(result.value.comments).toEqual([
      {
        pullRequest: { repo: HISTORY_REPO, number: 31 },
        path: "shop/orders.py",
        body: "Then say so in a test.",
        at: "2026-01-05T11:30:00.000Z",
      },
      {
        pullRequest: { repo: HISTORY_REPO, number: 31 },
        path: "shop/orders.py",
        // The mention is named and the editor's mark after the link is gone, as in a thread.
        body: "@Ana Silva this skips the tenant check, see [the guide](https://acme.example/guide).",
        at: "2026-01-05T10:00:00.000Z",
      },
      {
        pullRequest: { repo: HISTORY_REPO, number: 27 },
        path: "shop/payments.py",
        body: "It retries a charge that may have gone through.",
        at: "2026-01-03T10:00:00.000Z",
      },
    ]);
  });

  it("lists no further once it has the pull requests asked for", async () => {
    const { fetch, urls } = counting(historyExchanges);

    const result = await historyWith(fetch).getReviewerComments(HISTORY_REPO, { pullRequests: 1 });

    expect(result.ok && result.value.pullRequests).toBe(1);
    expect(urls).not.toContain(LIST_PAGE_2);
    expect(urls).toHaveLength(3);
  });

  it("looks among the 500 most recently updated pull requests, and says so", async () => {
    const page = (number: number) => (number === 1 ? LIST : `${LIST}&page=${number}`);
    const { fetch, urls } = counting([
      userExchange,
      ...Array.from({ length: 11 }, (_, i) =>
        get(page(i + 1), {
          values: [listed(100 - i, "2026-01-05T12:00:00.000000+00:00", [])],
          next: page(i + 2),
        }),
      ),
    ]);
    const logger = new RecordingLogger();

    const result = await historyWith(fetch, logger).getReviewerComments(HISTORY_REPO, {
      pullRequests: 30,
    });

    expect(result).toEqual({ ok: true, value: { comments: [], pullRequests: 0 } });
    expect(urls).toHaveLength(11);
    expect(LISTED_PER_PAGE).toBe(50);
    expect(logger.entries).toContainEqual({
      level: "info",
      message:
        "Looked for the pull requests you reviewed among the 500 most recently updated; older ones aren't read",
      fields: { repo: "acme/shop", found: 0 },
    });
  });

  it("answers the 300 newest comments, with every pull request it read", async () => {
    const logger = new RecordingLogger();
    const result = await historyWith(
      createFixtureFetch(manyExchanges(4, 100)),
      logger,
    ).getReviewerComments(HISTORY_REPO, { pullRequests: 30 });
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.pullRequests).toBe(4);
    expect(result.value.comments).toHaveLength(MAX_PAST_COMMENTS);
    // #4 is the one updated longest ago, so its comments are the ones left out.
    expect(new Set(result.value.comments.map((one) => one.pullRequest.number))).toEqual(
      new Set([1, 2, 3]),
    );
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "Kept the 300 newest of your comments on Bitbucket",
      fields: { repo: "acme/shop", found: 400 },
    });
  });

  it("asks for the comments of five pull requests at a time", async () => {
    const recorded = createFixtureFetch(manyExchanges(12, 1));
    let inFlight = 0;
    let most = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return recorded(input, init);
    };

    const result = await historyWith(fetch).getReviewerComments(HISTORY_REPO, { pullRequests: 30 });

    expect(result.ok && result.value.pullRequests).toBe(12);
    expect(most).toBe(5);
  });

  it("asks again only for what a failed read didn't get", async () => {
    const { fetch: recorded, urls } = counting(manyExchanges(3, 1));
    let dropped = false;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!dropped && new Request(input, init).url === commentsUrl(HISTORY_REPO, 2)) {
        dropped = true;
        throw new TypeError("fetch failed");
      }
      return recorded(input, init);
    };
    const history = historyWith(fetch);

    const first = await history.getReviewerComments(HISTORY_REPO, { pullRequests: 30 });
    expect(!first.ok && first.error.kind).toBe("network");
    const asked = urls.length;
    const second = await history.getReviewerComments(HISTORY_REPO, { pullRequests: 30 });

    expect(second.ok && second.value.comments).toHaveLength(3);
    // The list again, then the one pull request whose comments were lost.
    expect(urls.slice(asked)).toEqual([LIST, commentsUrl(HISTORY_REPO, 2)]);

    // A read that succeeded keeps nothing: the next one asks for everything again.
    const third = urls.length;
    await history.getReviewerComments(HISTORY_REPO, { pullRequests: 30 });
    expect(urls.length - third).toBe(4);
  });

  it("fails as not found for a repository the credentials can't see", async () => {
    const result = await historyWith(createFixtureFetch(hiddenRepoExchanges)).getReviewerComments(
      HIDDEN_REPO,
      { pullRequests: 30 },
    );
    expect(!result.ok && result.error.kind).toBe("not-found");
  });

  it("fails as unauthorized when the credentials are rejected", async () => {
    const result = await historyWith(
      createFixtureFetch([
        {
          request: { method: "GET", url: userExchange.request.url },
          response: { status: 401, headers: { "content-type": "text/html" }, body: "" },
        },
      ]),
    ).getReviewerComments(HISTORY_REPO, { pullRequests: 30 });
    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });
});
