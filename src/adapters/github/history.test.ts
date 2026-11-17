import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describeReviewHistoryContract,
  FixedClock,
  RecordingLogger,
} from "../../application/testing/index.ts";
import {
  comment,
  commentsUrl,
  type Exchange,
  found,
  HIDDEN_REPO,
  HISTORY_REPO,
  hiddenRepoExchanges,
  historyExchanges,
  REVIEWER,
  searchUrl,
  UNREVIEWED_REPO,
  userExchange,
} from "./fixtures/history.synthetic.ts";
import { MAX_PAST_COMMENTS } from "./history.ts";
import { createGitHubReviewHistory } from "./index.ts";

const historyWith = (fetch: typeof globalThis.fetch, logger = new RecordingLogger()) =>
  createGitHubReviewHistory({
    token: "test-token",
    version: "test",
    clock: new FixedClock(),
    logger,
    fetch,
  });

describeReviewHistoryContract("github", () => ({
  history: () => historyWith(createFixtureFetch(historyExchanges)),
  repo: HISTORY_REPO,
  unreviewedRepo: UNREVIEWED_REPO,
}));

/** `count` pull requests, #1 the most recently updated, each with `perPullRequest` comments. */
const manyExchanges = (count: number, perPullRequest: number): Exchange[] => {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const at = (number: number, minute: number) =>
    new Date(Date.UTC(2026, 0, 31 - number, 12, minute)).toISOString();
  return [
    userExchange,
    found(
      HISTORY_REPO,
      30,
      numbers.map((number) => ({ number, updated_at: at(number, 59) })),
    ),
    ...numbers.map((number) => ({
      request: { method: "GET", url: commentsUrl(HISTORY_REPO, number) },
      response: {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: Array.from({ length: perPullRequest }, (_, i) =>
          comment(REVIEWER, "src/index.ts", `Comment ${i + 1} on #${number}.`, at(number, i % 60)),
        ),
      },
    })),
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

describe("GitHub review history", () => {
  it("keeps the user's own comments on code, replies among them, from every page", async () => {
    const result = await historyWith(createFixtureFetch(historyExchanges)).getReviewerComments(
      HISTORY_REPO,
      { pullRequests: 30 },
    );
    if (!result.ok) throw new Error(result.error.message);

    // #40 was read too: the reviewer approved it without a comment on its code.
    expect(result.value.pullRequests).toBe(3);
    expect(
      result.value.comments.map(({ pullRequest, path, at }) => [pullRequest.number, path, at]),
    ).toEqual([
      [42, "src/billing/retry.test.ts", "2026-01-05T11:30:00Z"],
      [42, "src/billing/retry.ts", "2026-01-05T10:40:00Z"],
      [42, "src/billing/retry.ts", "2026-01-05T10:00:00Z"],
      [37, "src/api/orders.ts", "2025-12-20T16:00:00Z"],
    ]);
    expect(result.value.comments.at(-1)?.body).toBe(
      "```suggestion\nconst owner = await requireOwner(order, user);\n```\nEvery route here checks the owner.",
    );
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
      message: "Kept the 300 newest of your comments on GitHub",
      fields: { repo: "octo-org/api", found: 400 },
    });
  });

  it("asks for the comments of six pull requests at a time", async () => {
    const recorded = createFixtureFetch(manyExchanges(14, 1));
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

    expect(result.ok && result.value.pullRequests).toBe(14);
    expect(most).toBe(6);
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
    // The search again, then the one pull request whose comments were lost.
    expect(urls.slice(asked).map((url) => new URL(url).pathname)).toEqual([
      "/search/issues",
      "/repos/octo-org/api/pulls/2/comments",
    ]);

    // A read that succeeded keeps nothing: the next one asks for everything again.
    const third = urls.length;
    await history.getReviewerComments(HISTORY_REPO, { pullRequests: 30 });
    expect(urls.length - third).toBe(4);
  });

  it("warns when GitHub's search was cut short", async () => {
    const logger = new RecordingLogger();
    const result = await historyWith(
      createFixtureFetch([
        userExchange,
        {
          request: { method: "GET", url: searchUrl(UNREVIEWED_REPO, 30) },
          response: {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: { total_count: 0, incomplete_results: true, items: [] },
          },
        },
      ]),
      logger,
    ).getReviewerComments(UNREVIEWED_REPO, { pullRequests: 30 });

    expect(result).toEqual({ ok: true, value: { comments: [], pullRequests: 0 } });
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "GitHub's search returned only some of the pull requests you reviewed",
      fields: { repo: "octo-org/docs" },
    });
  });

  it("fails with GitHub's reason for a repository the token can't search", async () => {
    const result = await historyWith(createFixtureFetch(hiddenRepoExchanges)).getReviewerComments(
      HIDDEN_REPO,
      { pullRequests: 30 },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "rejected",
        message: expect.stringContaining("cannot be searched"),
        retryAfterSeconds: null,
      },
    });
  });

  it("fails as unauthorized when the token is rejected", async () => {
    const unauthorized = (url: string): Exchange => ({
      request: { method: "GET", url },
      response: {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { message: "Bad credentials" },
      },
    });
    const result = await historyWith(
      createFixtureFetch([userExchange.request.url, searchUrl(HIDDEN_REPO, 30)].map(unauthorized)),
    ).getReviewerComments(HIDDEN_REPO, { pullRequests: 30 });
    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });
});
