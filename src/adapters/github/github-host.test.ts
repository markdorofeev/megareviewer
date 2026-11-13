import { describe, expect, it, vi } from "vitest";
import {
  createFixtureFetch,
  describeGitHostContract,
  FixedClock,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import {
  CommentKey,
  type Publication,
  type PullRequestRef,
  type RepoRef,
} from "../../domain/review/index.ts";
import { openExchanges } from "./fixtures/open.synthetic.ts";
import publishExchanges from "./fixtures/publish.synthetic.json" with { type: "json" };
import rateLimitedExchanges from "./fixtures/rate-limited.synthetic.json" with { type: "json" };
import readExchanges from "./fixtures/read.json" with { type: "json" };
import searchExchanges from "./fixtures/search.synthetic.json" with { type: "json" };
import unauthorizedExchanges from "./fixtures/unauthorized.synthetic.json" with { type: "json" };
import { openPullRequestsQuery } from "./github-host.ts";
import { createGitHubHost } from "./index.ts";

const API = "https://api.github.com";
const repo: RepoRef = { host: "github", owner: "sindresorhus", repo: "is" };
const pr: PullRequestRef = { repo, number: 210 };
const PR_URL = `${API}/repos/sindresorhus/is/pulls/210`;
const BASE_SHA = "ab85d9bca9564eb0f867ab45e3cbf45659d9ac4c";
const HEAD_SHA = "b177d02e3aee907af72dc76aece21faf74be7935";
const JSONV3 = "application/vnd.github.v3+json";
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const okExchanges: RecordedExchange[] = [
  ...readExchanges,
  ...searchExchanges,
  ...publishExchanges,
  ...openExchanges,
];

/** What the adapter logs beyond Octokit's request log. */
const notices = (logger: RecordingLogger) =>
  logger.entries.filter((entry) => entry.level !== "debug");

const hostWith = (exchanges: readonly RecordedExchange[], logger = new RecordingLogger()) =>
  createGitHubHost({
    token: "test-token",
    version: "test",
    clock: new FixedClock(),
    logger,
    fetch: createFixtureFetch(exchanges),
  });

const key = (value: string) => CommentKey.parse(value);

const publication: Publication = {
  verdict: "request_changes",
  summary: "Fixes the message being lost; one question about the test.",
  comments: [
    {
      key: key("decision:d1"),
      path: "source/index.ts",
      line: 1146,
      side: "new",
      body: "The assertion now receives the message as a second argument.",
    },
    {
      key: key("decision:d2"),
      path: "source/index.ts",
      line: 1152,
      side: "old",
      body: "Dropping forEach also drops the index argument. Intended?",
    },
    {
      key: key("decision:d3"),
      path: "test/test.ts",
      line: 776,
      side: "new",
      body: "Worth a case without a custom message too.",
    },
  ],
};

describeGitHostContract("github", () => ({
  host: (scenario) =>
    hostWith(
      scenario === "ok"
        ? okExchanges
        : scenario === "unauthorized"
          ? unauthorizedExchanges
          : rateLimitedExchanges,
    ),
  existingPr: pr,
  missingPr: { repo, number: 999_999_999 },
  existingFile: { repo, sha: HEAD_SHA, path: "source/index.ts" },
  missingFile: { repo, sha: HEAD_SHA, path: "megareviewer-missing-file.txt" },
  publishablePr: { ref: pr, headSha: HEAD_SHA },
  publication,
}));

const countingFetch = (exchanges: readonly RecordedExchange[]) => {
  const answer = createFixtureFetch(exchanges);
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${request.url}`);
    return answer(request);
  };
  return { fetch, requests };
};

const exchange = (
  method: string,
  url: string,
  status: number,
  body: unknown,
  extra: { accept?: string; requestBody?: unknown; headers?: Record<string, string> } = {},
): RecordedExchange => ({
  request: {
    method,
    url,
    ...(extra.accept === undefined ? {} : { accept: extra.accept }),
    ...(extra.requestBody === undefined ? {} : { body: extra.requestBody }),
  },
  response: { status, headers: { ...jsonHeaders, ...extra.headers }, body },
});

describe("createGitHubHost", () => {
  describe("getPullRequest", () => {
    it("maps the recorded PR, with the merge base as baseSha", async () => {
      const result = await hostWith(okExchanges).getPullRequest(pr);
      if (!result.ok) throw new Error(result.error.message);

      expect(result.value).toMatchObject({
        ref: pr,
        url: "https://github.com/sindresorhus/is/pull/210",
        title: "Fix passing in assertion message to `assertArray`",
        author: { id: "marlun78", name: "marlun78" },
        targetBranch: "main",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
      });
      expect(result.value.commits.map((commit) => commit.sha).at(-1)).toBe(HEAD_SHA);
      expect(result.value.diff).toMatch(/^diff --git a\/source\/index\.ts b\/source\/index\.ts\n/);
    });

    it("echoes the requested ref, whatever casing GitHub uses", async () => {
      const result = await hostWith(okExchanges).getPullRequest(pr);
      expect(result.ok && result.value.ref).toBe(pr);
    });

    it("follows the link header across pages of commits", async () => {
      const commit = (sha: string) => ({
        sha,
        commit: { message: `commit ${sha.slice(0, 1)}`, author: { name: "Ada" } },
        author: null,
      });
      const recorded = readExchanges.filter(
        (exchange) => !exchange.request.url.includes("/commits"),
      );
      const page2 = `${PR_URL}/commits?per_page=100&page=2`;
      const result = await hostWith([
        ...recorded,
        exchange("GET", `${PR_URL}/commits?per_page=100`, 200, [commit("a".repeat(40))], {
          accept: JSONV3,
          headers: { link: `<${page2}>; rel="next", <${page2}>; rel="last"` },
        }),
        exchange("GET", page2, 200, [commit(HEAD_SHA)], { accept: JSONV3 }),
      ]).getPullRequest(pr);

      expect(result.ok && result.value.commits.map((c) => c.sha)).toEqual([
        "a".repeat(40),
        HEAD_SHA,
      ]);
    });

    it("warns when GitHub's 250-commit cap may have cut the list", async () => {
      const commits = Array.from({ length: 250 }, (_, index) => ({
        sha: index.toString(16).padStart(40, "0"),
        commit: { message: "m", author: null },
        author: { login: "ada" },
      }));
      const logger = new RecordingLogger();
      const recorded = readExchanges.filter(
        (exchange) => !exchange.request.url.includes("/commits"),
      );
      const result = await hostWith(
        [...recorded, exchange("GET", `${PR_URL}/commits?per_page=100`, 200, commits)],
        logger,
      ).getPullRequest(pr);

      expect(result.ok && result.value.commits).toHaveLength(250);
      expect(notices(logger).map((entry) => entry.level)).toEqual(["warn"]);
    });

    it("fails with invalid-response when GitHub's answer doesn't fit the schema", async () => {
      const result = await hostWith([
        exchange("GET", PR_URL, 200, { title: "no head or base" }),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("invalid-response");
    });

    it("fails with too-large when GitHub can't produce the diff", async () => {
      const recorded = readExchanges.filter(
        (exchange) => exchange.request.accept !== "application/vnd.github.diff",
      );
      const result = await hostWith([
        ...recorded,
        exchange(
          "GET",
          `${API}/repos/sindresorhus/is/compare/${BASE_SHA}...${HEAD_SHA}`,
          422,
          { message: "The diff is taking too long to generate." },
          { accept: "application/vnd.github.diff" },
        ),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("too-large");
    });

    it("fails with network when fetch throws", async () => {
      const host = createGitHubHost({
        token: "t",
        version: "test",
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch: async () => {
          throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
        },
      });
      const result = await host.getPullRequest(pr);
      expect(!result.ok && result.error).toEqual({
        kind: "network",
        message: "Can't reach GitHub: getaddrinfo ENOTFOUND",
        retryAfterSeconds: null,
      });
    });

    it("fails with network when GitHub doesn't answer in time", async () => {
      vi.useFakeTimers();
      try {
        const host = createGitHubHost({
          token: "t",
          version: "test",
          clock: new FixedClock(),
          logger: new RecordingLogger(),
          requestTimeoutMs: 5000,
          fetch: (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
            }),
        });
        const result = host.getPullRequest(pr);
        await vi.advanceTimersByTimeAsync(5000);
        expect(await result).toEqual({
          ok: false,
          error: {
            kind: "network",
            message: "GitHub didn't answer within 5 seconds",
            retryAfterSeconds: null,
          },
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("currentUser", () => {
    it("asks GitHub once per adapter", async () => {
      const { fetch, requests } = countingFetch(readExchanges);
      const host = createGitHubHost({
        token: "t",
        version: "test",
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });

      expect(await host.currentUser()).toEqual({
        ok: true,
        value: { id: "markd6v", name: "markd6v" },
      });
      await host.currentUser();
      expect(requests).toEqual([`GET ${API}/user`]);
    });

    it("asks again after a failure", async () => {
      const { fetch, requests } = countingFetch(unauthorizedExchanges);
      const host = createGitHubHost({
        token: "t",
        version: "test",
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });
      await host.currentUser();
      await host.currentUser();
      expect(requests).toHaveLength(2);
    });
  });

  describe("getFiles", () => {
    const GRAPHQL_URL = `${API}/graphql`;
    const blobs = (repository: Record<string, unknown>) =>
      exchange("POST", GRAPHQL_URL, 200, { data: { repository } });
    const blob = (text: string, extra: Record<string, unknown> = {}) => ({
      __typename: "Blob",
      text,
      isBinary: false,
      isTruncated: false,
      ...extra,
    });
    const raw = (path: string, status: number, body: string) =>
      exchange(
        "GET",
        `${API}/repos/sindresorhus/is/contents/${path}?ref=${HEAD_SHA}`,
        status,
        body,
        {
          accept: "application/vnd.github.raw",
          headers: { "content-type": "application/vnd.github.raw; charset=utf-8" },
        },
      );
    const file = (path: string) => ({ sha: HEAD_SHA, path });

    it("reads a batch in one query, naming each file by a variable, with null for a missing one", async () => {
      const answer = createFixtureFetch([blobs({ f0: blob("a"), f1: null })]);
      const bodies: unknown[] = [];
      const host = createGitHubHost({
        token: "t",
        version: "test",
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch: async (input, init) => {
          const request = new Request(input, init);
          bodies.push(await request.clone().json());
          return answer(request);
        },
      });

      const result = await host.getFiles(repo, [file("a.ts"), file("gone.ts")]);

      expect(result).toEqual({ ok: true, value: ["a", null] });
      expect(bodies).toEqual([
        {
          query: expect.stringContaining("f1: object(expression: $e1)"),
          variables: {
            owner: "sindresorhus",
            repo: "is",
            e0: `${HEAD_SHA}:a.ts`,
            e1: `${HEAD_SHA}:gone.ts`,
          },
        },
      ]);
    });

    it("splits more than 25 files into several queries, keeping the order", async () => {
      const first = Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [`f${i}`, blob(`${i}`)]),
      );
      const result = await hostWith([
        blobs(first),
        blobs({ f0: blob("25"), f1: blob("26") }),
      ]).getFiles(
        repo,
        Array.from({ length: 27 }, (_, i) => file(`${i}.ts`)),
      );
      expect(result).toEqual({
        ok: true,
        value: Array.from({ length: 27 }, (_, i) => `${i}`),
      });
    });

    it("reads truncated, binary and non-file objects through the REST API", async () => {
      const result = await hostWith([
        blobs({
          f0: blob("cut", { isTruncated: true }),
          f1: { __typename: "Blob", text: null, isBinary: true, isTruncated: false },
          f2: { __typename: "Commit" },
        }),
        raw("big.ts", 200, "whole"),
        raw("logo.png", 200, "png"),
        raw("vendor/lib", 200, "submodule"),
      ]).getFiles(repo, [file("big.ts"), file("logo.png"), file("vendor/lib")]);
      expect(result).toEqual({ ok: true, value: ["whole", "png", "submodule"] });
    });

    it("encodes each path segment but keeps the slashes over REST", async () => {
      const result = await hostWith([
        blobs({ f0: blob("cut", { isTruncated: true }) }),
        raw("docs/a%20b%23c.md", 200, "content"),
      ]).getFiles(repo, [file("docs/a b#c.md")]);
      expect(result).toEqual({ ok: true, value: ["content"] });
    });

    it("decodes REST content without a charset as UTF-8", async () => {
      const result = await hostWith([
        blobs({ f0: blob("cut", { isTruncated: true }) }),
        exchange("GET", `${API}/repos/sindresorhus/is/contents/a.txt?ref=${HEAD_SHA}`, 200, "é", {
          headers: { "content-type": "application/octet-stream" },
        }),
      ]).getFiles(repo, [file("a.txt")]);
      expect(result).toEqual({ ok: true, value: ["é"] });
    });

    it("treats a file GitHub won't serve as too large as unavailable", async () => {
      const result = await hostWith([
        blobs({ f0: blob("cut", { isTruncated: true }) }),
        exchange("GET", `${API}/repos/sindresorhus/is/contents/huge.bin?ref=${HEAD_SHA}`, 406, {
          message: "Sorry, this file is too large to be displayed.",
        }),
      ]).getFiles(repo, [file("huge.bin")]);
      expect(result).toEqual({ ok: true, value: [null] });
    });

    it("returns not-found when GraphQL can't resolve the repository", async () => {
      const result = await hostWith([
        exchange("POST", GRAPHQL_URL, 200, {
          data: { repository: null },
          errors: [
            {
              type: "NOT_FOUND",
              message: "Could not resolve to a Repository with the name 'sindresorhus/is'.",
            },
          ],
        }),
      ]).getFiles(repo, [file("a.ts")]);
      expect(result).toEqual({
        ok: false,
        error: {
          kind: "not-found",
          message:
            "GitHub answered: Could not resolve to a Repository with the name 'sindresorhus/is'.",
          retryAfterSeconds: null,
        },
      });
    });
  });

  describe("listPullRequests", () => {
    it("merges both searches, newest first, with lowercased refs", async () => {
      const result = await hostWith(okExchanges).listPullRequests();
      if (!result.ok) throw new Error(result.error.message);

      expect(
        result.value.map(({ ref, role, updatedAt }) => [
          `${ref.repo.owner}/${ref.repo.repo}#${ref.number}`,
          role,
          updatedAt,
        ]),
      ).toEqual([
        ["octo-org/web-app#42", "reviewer", "2026-01-02T10:00:00Z"],
        ["octo-org/docs#3", "author", "2025-12-31T12:00:00Z"],
        ["octo-org/api#7", "reviewer", "2025-12-30T08:15:00Z"],
      ]);
      expect(result.value[0]?.url).toBe("https://github.com/Octo-Org/Web-App/pull/42");
    });

    it("warns when the search returned only some PRs", async () => {
      const logger = new RecordingLogger();
      const [reviewing, authored] = searchExchanges;
      if (reviewing === undefined || authored === undefined) throw new Error("fixture changed");
      const truncated: RecordedExchange = {
        ...reviewing,
        response: { ...reviewing.response, body: { ...reviewing.response.body, total_count: 80 } },
      };
      await hostWith([truncated, authored], logger).listPullRequests();
      expect(notices(logger)).toMatchObject([
        { level: "warn", fields: { qualifier: "review-requested:@me", total: 80, returned: 2 } },
      ]);
    });
  });

  describe("getOpenPullRequests", () => {
    const graphql = (refs: readonly PullRequestRef[], data: unknown, status = 200) =>
      exchange("POST", `${API}/graphql`, status, data, {
        accept: JSONV3,
        requestBody: {
          query: openPullRequestsQuery(refs.length),
          variables: Object.fromEntries(
            refs.flatMap((ref, i) => [
              [`o${i}`, ref.repo.owner],
              [`r${i}`, ref.repo.repo],
              [`n${i}`, ref.number],
            ]),
          ),
        },
      });
    const node = (state: string) => ({
      pullRequest: {
        state,
        title: `A ${state.toLowerCase()} PR`,
        url: "https://github.com/acme/shop/pull/7",
        updatedAt: "2026-10-21T10:00:00Z",
        author: { login: "lee-park" },
      },
    });
    const shop = (number: number): PullRequestRef => ({
      repo: { host: "github", owner: "acme", repo: "shop" },
      number,
    });

    it("returns an open PR as one to review, under the ref asked about", async () => {
      const refs = [shop(7), shop(8)];
      const result = await hostWith([
        graphql(refs, { data: { p0: node("OPEN"), p1: node("CLOSED") } }),
      ]).getOpenPullRequests(refs);

      expect(result).toEqual({
        ok: true,
        value: [
          {
            ref: shop(7),
            url: "https://github.com/acme/shop/pull/7",
            title: "A open PR",
            author: { id: "lee-park", name: "lee-park" },
            updatedAt: "2026-10-21T10:00:00Z",
            role: "reviewer",
          },
        ],
      });
    });

    it("leaves out a PR whose repository is gone, keeping the others", async () => {
      const refs = [{ ...shop(7), repo: { ...shop(7).repo, repo: "gone" } }, shop(8)];
      const result = await hostWith([
        graphql(refs, {
          data: { p0: null, p1: node("OPEN") },
          errors: [{ type: "NOT_FOUND", path: ["p0"], message: "Could not resolve" }],
        }),
      ]).getOpenPullRequests(refs);

      expect(result.ok && result.value.map((summary) => summary.ref)).toEqual([shop(8)]);
    });

    it("fails when GitHub answers errors without data", async () => {
      const refs = [shop(7)];
      const result = await hostWith([
        graphql(refs, { errors: [{ type: "INTERNAL", message: "Something went wrong" }] }),
      ]).getOpenPullRequests(refs);

      expect(!result.ok && result.error.kind).toBe("unexpected");
    });
  });

  describe("publish", () => {
    const REVIEWS_URL = `${PR_URL}/reviews`;
    const review = (id: number) => ({
      id,
      html_url: `https://github.com/sindresorhus/is/pull/210#pullrequestreview-${id}`,
      submitted_at: "2026-01-01T00:00:05Z",
    });
    const options = (alreadyPosted: string[] = []) => {
      const posted: [string, string][] = [];
      return {
        headSha: HEAD_SHA,
        alreadyPosted: new Set(alreadyPosted.map(key)),
        onPosted: async (postedKey: CommentKey, id: string) => {
          posted.push([postedKey, id]);
        },
        posted,
      };
    };

    it("waits for a slow review post instead of abandoning it, since GitHub may still post it", async () => {
      vi.useFakeTimers();
      try {
        const answer = createFixtureFetch([exchange("POST", REVIEWS_URL, 200, review(7))]);
        const host = createGitHubHost({
          token: "t",
          version: "test",
          clock: new FixedClock(),
          logger: new RecordingLogger(),
          requestTimeoutMs: 5000,
          fetch: async (input, init) => {
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            return answer(input, init);
          },
        });
        const recorded = options(["decision:d1", "decision:d2", "decision:d3"]);
        const result = host.publish(pr, publication, recorded);
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await result).ok).toBe(true);
        expect(recorded.posted).toEqual([["summary", "7"]]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("calls nothing when everything is already posted", async () => {
      const recorded = options(["summary", "decision:d1", "decision:d2", "decision:d3"]);
      const result = await hostWith([]).publish(pr, publication, recorded);

      expect(result).toEqual({
        ok: true,
        value: { url: null, publishedAt: "2026-01-01T00:00:00.000Z", postedCommentIds: {} },
      });
      expect(recorded.posted).toEqual([]);
    });

    it("posts the rest as a plain comment once the summary and verdict are posted", async () => {
      const recorded = options(["summary", "decision:d1", "decision:d2"]);
      const result = await hostWith([
        exchange("POST", REVIEWS_URL, 200, review(7), {
          requestBody: {
            commit_id: HEAD_SHA,
            event: "COMMENT",
            comments: [
              {
                path: "test/test.ts",
                line: 776,
                side: "RIGHT",
                body: "Worth a case without a custom message too.",
              },
            ],
          },
        }),
        exchange("GET", `${REVIEWS_URL}/7/comments?per_page=100`, 200, [
          { id: 70, path: "test/test.ts", body: "Worth a case without a custom message too." },
        ]),
      ]).publish(pr, publication, recorded);

      expect(result.ok && result.value.postedCommentIds).toEqual({ "decision:d3": "70" });
      expect(recorded.posted).toEqual([["decision:d3", "70"]]);
    });

    it("maps each verdict to GitHub's review event", async () => {
      for (const [verdict, event] of [
        ["approve", "APPROVE"],
        ["request_changes", "REQUEST_CHANGES"],
        ["comment", "COMMENT"],
      ] as const) {
        const result = await hostWith([
          exchange("POST", REVIEWS_URL, 200, review(1), {
            requestBody: { commit_id: HEAD_SHA, event, body: "ok", comments: [] },
          }),
        ]).publish(pr, { verdict, summary: "ok", comments: [] }, options());
        expect(result.ok && result.value.postedCommentIds).toEqual({ summary: "1" });
      }
    });

    it("pairs comments on the same line by body, and identical ones in order", async () => {
      const comment = (id: string, body: string) => ({
        key: key(`decision:${id}`),
        path: "a.ts",
        line: 3,
        side: "new" as const,
        body,
      });
      const sameLine: Publication = {
        verdict: "comment",
        summary: "s",
        comments: [comment("d1", "first"), comment("d2", "second"), comment("d3", "first")],
      };
      const hostComment = (id: number, body: string) => ({
        id,
        path: "a.ts",
        line: 3,
        side: "RIGHT",
        body,
      });
      const recorded = options();
      await hostWith([
        exchange("POST", REVIEWS_URL, 200, review(2)),
        exchange("GET", `${REVIEWS_URL}/2/comments?per_page=100`, 200, [
          hostComment(21, "second"),
          hostComment(22, "first\r\n"),
          hostComment(23, "first"),
        ]),
      ]).publish(pr, sameLine, recorded);

      expect(recorded.posted).toEqual([
        ["summary", "2"],
        ["decision:d1", "22"],
        ["decision:d2", "21"],
        ["decision:d3", "23"],
      ]);
    });

    it("doesn't pair comments on the other side of the diff", async () => {
      const recorded = options(["decision:d1", "decision:d3"]);
      const logger = new RecordingLogger();
      await hostWith(
        [
          exchange("POST", REVIEWS_URL, 200, review(3)),
          exchange("GET", `${REVIEWS_URL}/3/comments?per_page=100`, 200, [
            {
              id: 31,
              path: "source/index.ts",
              line: 1152,
              side: "RIGHT",
              body: "Dropping forEach also drops the index argument. Intended?",
            },
          ]),
        ],
        logger,
      ).publish(pr, publication, recorded);

      // Unpaired, so it's recorded under the review's ID rather than posted again on retry.
      expect(recorded.posted).toEqual([
        ["summary", "3"],
        ["decision:d2", "3"],
      ]);
      expect(notices(logger)).toMatchObject([{ level: "warn", fields: { key: "decision:d2" } }]);
    });

    it("records every key when the comments can't be read back", async () => {
      const recorded = options();
      const logger = new RecordingLogger();
      const result = await hostWith(
        [
          exchange("POST", REVIEWS_URL, 200, review(4)),
          exchange("GET", `${REVIEWS_URL}/4/comments?per_page=100`, 502, { message: "Bad" }),
        ],
        logger,
      ).publish(pr, publication, recorded);

      expect(result.ok && result.value.url).toBe(review(4).html_url);
      expect(recorded.posted.map(([, id]) => id)).toEqual(["4", "4", "4", "4"]);
      expect(notices(logger).map((entry) => entry.level)).toEqual(["warn"]);
    });

    it("returns GitHub's reason when it rejects the review", async () => {
      const recorded = options();
      const result = await hostWith([
        exchange("POST", REVIEWS_URL, 422, {
          message: "Unprocessable Entity",
          errors: ["Can not request changes on your own pull request"],
        }),
      ]).publish(pr, publication, recorded);

      expect(!result.ok && result.error).toEqual({
        kind: "rejected",
        message: "Unprocessable Entity: Can not request changes on your own pull request",
        retryAfterSeconds: null,
      });
      expect(recorded.posted).toEqual([]);
    });

    it("uses the clock when GitHub doesn't say when the review was submitted", async () => {
      const result = await hostWith([
        exchange("POST", REVIEWS_URL, 200, { ...review(5), submitted_at: null }),
      ]).publish(pr, { verdict: "approve", summary: "", comments: [] }, options());
      expect(result.ok && result.value.publishedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });
});
