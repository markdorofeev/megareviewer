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
import listExchanges from "./fixtures/list.synthetic.json" with { type: "json" };
import publishExchanges from "./fixtures/publish.synthetic.json" with { type: "json" };
import rateLimitedExchanges from "./fixtures/rate-limited.synthetic.json" with { type: "json" };
import readExchanges from "./fixtures/read.json" with { type: "json" };
import unauthorizedExchanges from "./fixtures/unauthorized.synthetic.json" with { type: "json" };
import { createBitbucketHost } from "./index.ts";
import { BitbucketPullRequest } from "./schemas.ts";

const API = "https://api.bitbucket.org/2.0";
const repo: RepoRef = { host: "bitbucket", owner: "atlassian", repo: "bitbucket-upload-file" };
const pr: PullRequestRef = { repo, number: 26 };
const REPO_URL = `${API}/repositories/atlassian/bitbucket-upload-file`;
const PR_URL = `${REPO_URL}/pullrequests/26`;
const BASE_SHA = "9c2e7d9655b6ac495e905c8e20c933c8e45fa962";
const HEAD_SHA = "b467819f28a4ca3cfbbdb889bd1bc7ba6918522d";
const ADDED_FILE = ".changes/next-release/patch-20241120112812901924.json";
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const okExchanges: RecordedExchange[] = [...readExchanges, ...listExchanges, ...publishExchanges];

const hostWith = (
  exchanges: readonly RecordedExchange[],
  { logger = new RecordingLogger(), workspace = "acme" as string | null } = {},
) =>
  createBitbucketHost({
    username: "reviewer@example.com",
    password: "test-token",
    workspace,
    clock: new FixedClock(),
    logger,
    fetch: createFixtureFetch(exchanges),
  });

const key = (value: string) => CommentKey.parse(value);
const file = (path: string) => ({ sha: HEAD_SHA, path });

const publication: Publication = {
  verdict: "request_changes",
  summary: "Adds useful logs; one question about the pipelines file.",
  comments: [
    {
      key: key("decision:d1"),
      path: "pipe/pipe.py",
      line: 46,
      side: "new",
      body: "Logging the working directory helps, but this logs it on every run.",
    },
    {
      key: key("decision:d2"),
      path: "bitbucket-pipelines.yml",
      line: 4,
      side: "old",
      body: "Was this blank line removed on purpose?",
    },
    {
      key: key("decision:d3"),
      path: "test/test.py",
      line: 31,
      side: "new",
      body: "Worth a test where BITBUCKET_CLONE_DIR is unset.",
    },
  ],
};

describeGitHostContract("bitbucket", () => ({
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
  existingFile: { repo, sha: HEAD_SHA, path: ADDED_FILE },
  missingFile: { repo, sha: HEAD_SHA, path: "megareviewer-missing-file.txt" },
  publishablePr: { ref: pr, headSha: HEAD_SHA },
  publication,
}));

/** A fetch that answers from exchanges and records each request's URL and Authorization. */
const recordingFetch = (exchanges: readonly RecordedExchange[]) => {
  const answer = createFixtureFetch(exchanges);
  const requests: { url: string; authorization: string | null }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, authorization: request.headers.get("authorization") });
    return answer(request);
  };
  return { fetch, requests };
};

const exchange = (
  method: string,
  url: string,
  status: number,
  body: unknown,
  extra: { requestBody?: unknown; headers?: Record<string, string> } = {},
): RecordedExchange => ({
  request: {
    method,
    url,
    ...(extra.requestBody === undefined ? {} : { body: extra.requestBody }),
  },
  response: { status, headers: { ...jsonHeaders, ...extra.headers }, body },
});

/** The recorded exchanges, minus those whose URL contains `part`. */
const recordedWithout = (part: string) =>
  readExchanges.filter((recorded) => !recorded.request.url.includes(part));

const notices = (logger: RecordingLogger) =>
  logger.entries.filter((entry) => entry.level !== "debug");

describe("createBitbucketHost", () => {
  describe("getPullRequest", () => {
    it("maps the recorded PR, with full SHAs and the merge base as baseSha", async () => {
      const result = await hostWith(okExchanges).getPullRequest(pr);
      if (!result.ok) throw new Error(result.error.message);

      expect(result.value).toMatchObject({
        ref: pr,
        url: "https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/26",
        title: "PIPES-1654: Add logs and warnings about directory from upload.",
        description: "",
        author: { id: "{5d6d69c0-bfad-4ee1-9e60-6af86e640907}", name: "user-5d6d69c0" },
        sourceBranch: "feature/PIPES-1654",
        targetBranch: "master",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        createdAt: "2024-11-20T11:29:49.479Z",
        updatedAt: "2024-11-21T14:51:51.177Z",
      });
      expect(result.value.commits.map((commit) => commit.sha)).toContain(HEAD_SHA);
      expect(result.value.diff).toMatch(/^diff --git a\/\.changes\//);
    });

    it("echoes the requested ref", async () => {
      const result = await hostWith(okExchanges).getPullRequest(pr);
      expect(result.ok && result.value.ref).toBe(pr);
    });

    it("sends Basic auth with the email and API token", async () => {
      const { fetch, requests } = recordingFetch(readExchanges);
      await createBitbucketHost({
        username: "reviewer@example.com",
        password: "test-token",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      }).getPullRequest(pr);

      const expected = `Basic ${Buffer.from("reviewer@example.com:test-token").toString("base64")}`;
      expect(requests.map((request) => request.authorization)).toEqual(
        requests.map(() => expected),
      );
    });

    it("falls back to the destination commit when the merge base is unavailable", async () => {
      const logger = new RecordingLogger();
      const result = await hostWith(
        [
          ...recordedWithout("/merge-base/"),
          exchange("GET", `${REPO_URL}/merge-base/b467819f28a4..9c2e7d9655b6`, 404, {
            error: { message: "Commit not found" },
          }),
          exchange("GET", `${REPO_URL}/commit/9c2e7d9655b6`, 200, { hash: "f".repeat(40) }),
        ],
        { logger },
      ).getPullRequest(pr);

      expect(result.ok && result.value.baseSha).toBe("f".repeat(40));
      expect(notices(logger)).toMatchObject([{ level: "warn" }]);
    });

    it("doesn't fall back when the merge base fails for a reason every call shares", async () => {
      const result = await hostWith([
        ...recordedWithout("/merge-base/"),
        exchange("GET", `${REPO_URL}/merge-base/b467819f28a4..9c2e7d9655b6`, 429, "", {
          headers: { "retry-after": "5" },
        }),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error).toMatchObject({
        kind: "rate-limited",
        retryAfterSeconds: 5,
      });
    });

    it("fails when the destination commit can't be found either", async () => {
      const result = await hostWith([
        ...recordedWithout("/merge-base/"),
        exchange("GET", `${REPO_URL}/merge-base/b467819f28a4..9c2e7d9655b6`, 500, ""),
        exchange("GET", `${REPO_URL}/commit/9c2e7d9655b6`, 404, ""),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("not-found");
    });

    it("fails with not-found when the source commit is gone", async () => {
      const body = BitbucketPullRequest.parse(readExchanges[0]?.response.body);
      const result = await hostWith([
        exchange("GET", PR_URL, 200, { ...body, source: { ...body.source, commit: null } }),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("not-found");
    });

    it("follows next links across pages of commits", async () => {
      const commit = (sha: string) => ({ hash: sha, message: "m", author: { raw: "Ada <a@b.c>" } });
      const page2 = `${PR_URL}/commits?pagelen=100&page=Xy1`;
      const result = await hostWith([
        ...recordedWithout("/commits"),
        exchange("GET", `${PR_URL}/commits?pagelen=100`, 200, {
          values: [commit("a".repeat(40))],
          next: page2,
        }),
        exchange("GET", page2, 200, { values: [commit(HEAD_SHA)] }),
      ]).getPullRequest(pr);

      expect(result.ok && result.value.commits).toEqual([
        { sha: "a".repeat(40), message: "m", author: "Ada" },
        { sha: HEAD_SHA, message: "m", author: "Ada" },
      ]);
    });

    it("stops after 10 pages and warns", async () => {
      const logger = new RecordingLogger();
      const pageUrl = (page: number) =>
        page === 0 ? `${PR_URL}/commits?pagelen=100` : `${PR_URL}/commits?pagelen=100&page=${page}`;
      const pages = Array.from({ length: 11 }, (_, page) =>
        exchange("GET", pageUrl(page), 200, {
          values: [{ hash: page.toString(16).padStart(40, "0"), message: "m", author: {} }],
          next: pageUrl(page + 1),
        }),
      );
      const result = await hostWith([...recordedWithout("/commits"), ...pages], {
        logger,
      }).getPullRequest(pr);

      expect(result.ok && result.value.commits).toHaveLength(10);
      expect(notices(logger)).toMatchObject([{ level: "warn" }]);
    });

    it("fails with too-large when Bitbucket times out producing the diff", async () => {
      const result = await hostWith([
        ...recordedWithout("/diff/"),
        exchange("GET", `${REPO_URL}/diff/b467819f28a4..9c2e7d9655b6?topic=true`, 555, {
          error: { message: "Service Timeout" },
        }),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("too-large");
    });

    it("fails with invalid-response when Bitbucket's answer doesn't fit the schema", async () => {
      const result = await hostWith([
        exchange("GET", PR_URL, 200, { title: "no source or destination" }),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("invalid-response");
    });

    it("fails with invalid-response when the body isn't JSON", async () => {
      const result = await hostWith([
        exchange("GET", PR_URL, 200, "<html>", { headers: { "content-type": "text/html" } }),
      ]).getPullRequest(pr);
      expect(!result.ok && result.error.kind).toBe("invalid-response");
    });

    it("fails with network when fetch can't connect", async () => {
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch: async () => {
          throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
        },
      });
      expect(await host.getPullRequest(pr)).toEqual({
        ok: false,
        error: {
          kind: "network",
          message: "Can't reach Bitbucket: getaddrinfo ENOTFOUND",
          retryAfterSeconds: null,
        },
      });
    });

    it("fails with network when the connection drops mid-body", async () => {
      const dropped = new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated", { cause: new Error("other side closed") }));
        },
      });
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch: async () => new Response(dropped, { status: 200, headers: jsonHeaders }),
      });
      expect(await host.getPullRequest(pr)).toEqual({
        ok: false,
        error: {
          kind: "network",
          message: "Can't reach Bitbucket: other side closed",
          retryAfterSeconds: null,
        },
      });
    });

    it("fails with network when Bitbucket doesn't answer in time", async () => {
      vi.useFakeTimers();
      try {
        const host = createBitbucketHost({
          username: "e",
          password: "t",
          workspace: null,
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
            message: "Bitbucket didn't answer within 5 seconds",
            retryAfterSeconds: null,
          },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("rethrows what isn't a network failure, because it's a bug", async () => {
      const host = hostWith([]);
      await expect(host.getPullRequest(pr)).rejects.toThrow(/No recorded exchange/);
    });
  });

  describe("redirects", () => {
    const fileUrl = `${REPO_URL}/src/${HEAD_SHA}/big.bin`;

    it("follows a redirect within the API, keeping the credentials", async () => {
      const moved = `${API}/repositories/atlassian/renamed/src/${HEAD_SHA}/big.bin`;
      const { fetch, requests } = recordingFetch([
        exchange("GET", fileUrl, 302, "", { headers: { location: moved } }),
        exchange("GET", moved, 200, "content", { headers: { "content-type": "text/plain" } }),
      ]);
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });

      expect(await host.getFiles(repo, [file("big.bin")])).toEqual({
        ok: true,
        value: ["content"],
      });
      expect(requests.map((request) => request.authorization !== null)).toEqual([true, true]);
    });

    it("follows a redirect elsewhere (an LFS file) without the credentials", async () => {
      const media = "https://api.media.atlassian.com/file/abc/binary?token=xyz";
      const { fetch, requests } = recordingFetch([
        exchange("GET", fileUrl, 301, "", { headers: { location: media } }),
        exchange("GET", media, 200, "lfs content", { headers: { "content-type": "text/plain" } }),
      ]);
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });

      expect(await host.getFiles(repo, [file("big.bin")])).toEqual({
        ok: true,
        value: ["lfs content"],
      });
      expect(requests).toEqual([
        { url: fileUrl, authorization: expect.stringMatching(/^Basic /) },
        { url: media, authorization: null },
      ]);
    });

    it("gives up after 5 redirects", async () => {
      const hop = (n: number) => `${API}/hop/${n}`;
      const hops = Array.from({ length: 6 }, (_, n) =>
        exchange("GET", n === 0 ? fileUrl : hop(n), 302, "", { headers: { location: hop(n + 1) } }),
      );
      const result = await hostWith(hops).getFiles(repo, [file("big.bin")]);
      expect(!result.ok && result.error.kind).toBe("unexpected");
    });
  });

  describe("getFiles", () => {
    it("encodes each path segment but keeps the slashes", async () => {
      const result = await hostWith([
        exchange("GET", `${REPO_URL}/src/${HEAD_SHA}/docs/a%20b%23c.md`, 200, "content", {
          headers: { "content-type": "text/markdown" },
        }),
      ]).getFiles(repo, [file("docs/a b#c.md")]);
      expect(result).toEqual({ ok: true, value: ["content"] });
    });

    it("decodes content as UTF-8", async () => {
      const result = await hostWith([
        exchange("GET", `${REPO_URL}/src/${HEAD_SHA}/a.txt`, 200, "é", {
          headers: { "content-type": "application/octet-stream" },
        }),
      ]).getFiles(repo, [file("a.txt")]);
      expect(result).toEqual({ ok: true, value: ["é"] });
    });

    it("fails with the first error when any file fails", async () => {
      const result = await hostWith([
        exchange("GET", `${REPO_URL}/src/${HEAD_SHA}/a.txt`, 200, "a", {
          headers: { "content-type": "text/plain" },
        }),
        exchange("GET", `${REPO_URL}/src/${HEAD_SHA}/b.txt`, 403, {
          type: "error",
          error: { message: "Forbidden" },
        }),
      ]).getFiles(repo, [file("a.txt"), file("b.txt")]);
      expect(!result.ok && result.error.kind).toBe("forbidden");
    });
  });

  describe("currentUser", () => {
    it("asks Bitbucket once per adapter", async () => {
      const { fetch, requests } = recordingFetch(listExchanges);
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });

      expect(await host.currentUser()).toEqual({
        ok: true,
        value: { id: "{8d3c1a52-6f0e-4a8b-9a51-2f4c7e0b9d13}", name: "Grace Hopper" },
      });
      await host.currentUser();
      expect(requests.map((request) => request.url)).toEqual([`${API}/user`]);
    });

    it("asks again after a failure", async () => {
      const { fetch, requests } = recordingFetch(unauthorizedExchanges);
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });
      await host.currentUser();
      await host.currentUser();
      expect(requests).toHaveLength(2);
    });

    it("says which scope the token lacks", async () => {
      const result = await hostWith([
        exchange("GET", `${API}/user`, 403, {
          type: "error",
          error: {
            message: "Your credentials lack one or more required privilege scopes.",
            detail: { required: ["read:user:bitbucket"], granted: ["read:repository:bitbucket"] },
          },
        }),
      ]).currentUser();
      expect(!result.ok && result.error).toMatchObject({
        kind: "forbidden",
        message: expect.stringContaining("read:user:bitbucket"),
      });
    });
  });

  describe("listPullRequests", () => {
    it("lists nothing, and calls nothing, without a workspace", async () => {
      expect(await hostWith([], { workspace: null }).listPullRequests()).toEqual({
        ok: true,
        value: [],
      });
    });

    it("merges PRs to review and own PRs, newest first, with lowercased refs", async () => {
      const logger = new RecordingLogger();
      const result = await hostWith(okExchanges, { logger }).listPullRequests();
      if (!result.ok) throw new Error(result.error.message);

      expect(
        result.value.map(({ ref, role, updatedAt }) => [
          `${ref.repo.owner}/${ref.repo.repo}#${ref.number}`,
          role,
          updatedAt,
        ]),
      ).toEqual([
        ["acme/web-app#42", "reviewer", "2026-01-02T10:00:00.000Z"],
        ["acme/docs#3", "author", "2025-12-31T12:00:00.000Z"],
        ["acme/api#7", "reviewer", "2025-12-30T08:15:00.000Z"],
      ]);
      expect(result.value[0]?.url).toBe("https://bitbucket.org/acme/Web-App/pull-requests/42");
      expect(notices(logger)).toMatchObject([
        { level: "info", fields: { workspace: "acme", repositories: 2, more: false } },
      ]);
    });

    it("fails when scanning a repository fails", async () => {
      const failing = listExchanges.map((recorded) =>
        recorded.request.url.includes("/acme/api/")
          ? { ...recorded, response: { ...recorded.response, status: 403, body: "" } }
          : recorded,
      );
      const result = await hostWith(failing).listPullRequests();
      expect(!result.ok && result.error.kind).toBe("forbidden");
    });

    it("fails when listing own PRs fails", async () => {
      const failing = listExchanges.map((recorded) =>
        recorded.request.url.includes("/workspaces/")
          ? { ...recorded, response: { ...recorded.response, status: 500, body: "" } }
          : recorded,
      );
      const result = await hostWith(failing).listPullRequests();
      expect(!result.ok && result.error.kind).toBe("unexpected");
    });
  });

  describe("publish", () => {
    const COMMENTS_URL = `${PR_URL}/comments`;
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
    /** The publish exchanges, with the one posting `body` failing with `status`. */
    const failingAt = (body: string, status: number) =>
      [...readExchanges, ...publishExchanges].map((recorded) =>
        JSON.stringify("body" in recorded.request ? recorded.request.body : null).includes(body)
          ? { ...recorded, response: { ...recorded.response, status, body: "" } }
          : recorded,
      );

    it("anchors new-side comments with `to` and old-side ones with `from`", async () => {
      const { fetch, requests } = recordingFetch([...readExchanges, ...publishExchanges]);
      const bodies: unknown[] = [];
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const body = await request.clone().text();
          if (body !== "") bodies.push(JSON.parse(body));
          return fetch(request);
        },
      });
      await host.publish(pr, publication, options());

      expect(bodies.slice(0, 2)).toEqual([
        {
          content: { raw: publication.comments[0]?.body },
          inline: { path: "pipe/pipe.py", to: 46 },
        },
        {
          content: { raw: publication.comments[1]?.body },
          inline: { path: "bitbucket-pipelines.yml", from: 4 },
        },
      ]);
      expect(requests.at(-1)?.url).toBe(`${PR_URL}/request-changes`);
    });

    it("returns the PR's link and the clock's time", async () => {
      const result = await hostWith(okExchanges).publish(pr, publication, options());
      expect(result.ok && result.value).toEqual({
        url: "https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/26",
        publishedAt: "2026-01-01T00:00:00.000Z",
        postedCommentIds: {
          "decision:d1": "901",
          "decision:d2": "902",
          "decision:d3": "903",
          summary: "904",
        },
      });
    });

    it("posts only the rest when retried after a comment failed", async () => {
      const first = options();
      const failed = await hostWith(failingAt("Worth a test", 500)).publish(pr, publication, first);
      expect(!failed.ok && failed.error.kind).toBe("unexpected");
      expect(first.posted).toEqual([
        ["decision:d1", "901"],
        ["decision:d2", "902"],
      ]);

      const retry = options(first.posted.map(([postedKey]) => postedKey));
      const { fetch, requests } = recordingFetch(okExchanges);
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });
      const result = await host.publish(pr, publication, retry);

      expect(result.ok && result.value.postedCommentIds).toEqual({
        "decision:d3": "903",
        summary: "904",
      });
      expect(retry.posted).toEqual([
        ["decision:d3", "903"],
        ["summary", "904"],
      ]);
      expect(requests.filter((request) => request.url === COMMENTS_URL)).toHaveLength(2);
    });

    it("returns the verdict's failure after posting every comment, and a retry redoes only it", async () => {
      const failing = [...readExchanges, ...publishExchanges].map((recorded) =>
        recorded.request.url.endsWith("/request-changes")
          ? {
              ...recorded,
              response: {
                ...recorded.response,
                status: 400,
                body: {
                  type: "error",
                  error: { message: "You can't request changes on your own pull request." },
                },
              },
            }
          : recorded,
      );
      const first = options();
      const failed = await hostWith(failing).publish(pr, publication, first);

      expect(!failed.ok && failed.error).toEqual({
        kind: "rejected",
        message: "You can't request changes on your own pull request.",
        retryAfterSeconds: null,
      });
      expect(first.posted.map(([postedKey]) => postedKey)).toEqual([
        "decision:d1",
        "decision:d2",
        "decision:d3",
        "summary",
      ]);

      const { fetch, requests } = recordingFetch(okExchanges);
      const retry = options(first.posted.map(([postedKey]) => postedKey));
      const result = await createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      }).publish(pr, publication, retry);

      expect(result.ok && result.value.postedCommentIds).toEqual({});
      expect(requests.map((request) => request.url)).toEqual([PR_URL, `${PR_URL}/request-changes`]);
    });

    it("approves with the approve endpoint, and a plain comment calls neither", async () => {
      const approve = exchange("POST", `${PR_URL}/approve`, 200, { approved: true });
      const summary = (body: string, id: number) =>
        exchange("POST", COMMENTS_URL, 201, { id }, { requestBody: { content: { raw: body } } });

      const { fetch, requests } = recordingFetch([...readExchanges, approve, summary("ok", 1)]);
      const host = createBitbucketHost({
        username: "e",
        password: "t",
        workspace: null,
        clock: new FixedClock(),
        logger: new RecordingLogger(),
        fetch,
      });
      await host.publish(pr, { verdict: "approve", summary: "ok", comments: [] }, options());
      await host.publish(pr, { verdict: "comment", summary: "ok", comments: [] }, options());

      expect(requests.map((request) => request.url)).toEqual([
        PR_URL,
        COMMENTS_URL,
        `${PR_URL}/approve`,
        PR_URL,
        COMMENTS_URL,
      ]);
    });

    it("doesn't post an empty summary", async () => {
      const recorded = options();
      const result = await hostWith(readExchanges).publish(
        pr,
        { verdict: "comment", summary: "  ", comments: [] },
        recorded,
      );
      expect(result.ok && result.value.postedCommentIds).toEqual({});
      expect(recorded.posted).toEqual([]);
    });

    it("refuses when the PR has new commits since the analysis", async () => {
      const recorded = options();
      const result = await hostWith(readExchanges).publish(pr, publication, {
        ...recorded,
        headSha: "c".repeat(40),
      });
      expect(!result.ok && result.error.kind).toBe("rejected");
      expect(recorded.posted).toEqual([]);
    });

    it("returns Bitbucket's reason when it rejects a comment", async () => {
      const recorded = options();
      const result = await hostWith(
        failingAt("Logging the working directory", 400).map((rejected) =>
          rejected.response.status === 400
            ? {
                ...rejected,
                response: {
                  ...rejected.response,
                  body: {
                    type: "error",
                    error: { message: "Bad request", detail: "Line not in diff" },
                  },
                },
              }
            : rejected,
        ),
      ).publish(pr, publication, recorded);

      expect(!result.ok && result.error).toEqual({
        kind: "rejected",
        message: "Bad request: Line not in diff",
        retryAfterSeconds: null,
      });
      expect(recorded.posted).toEqual([]);
    });
  });
});
