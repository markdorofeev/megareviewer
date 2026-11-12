import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describeReviewThreadsContract,
  FixedClock,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { PullRequestRef } from "../../domain/review/index.ts";
import {
  ATTACHMENT,
  attachmentExchanges,
  THREADS_HEAD,
  threadExchanges,
} from "./fixtures/threads.synthetic.ts";
import unauthorizedExchanges from "./fixtures/unauthorized.synthetic.json" with { type: "json" };
import { createGitHubReviewThreads } from "./index.ts";

const pr: PullRequestRef = {
  repo: { host: "github", owner: "sindresorhus", repo: "is" },
  number: 210,
};

const threadsWith = (fetch: typeof globalThis.fetch, logger = new RecordingLogger()) =>
  createGitHubReviewThreads({
    token: "test-token",
    version: "test",
    clock: new FixedClock(),
    logger,
    fetch,
  });

describeReviewThreadsContract("github", () => ({
  threads: () => threadsWith(createFixtureFetch([...threadExchanges, ...attachmentExchanges])),
  pr,
  thread: "PRRT_kwDOAbc1",
  resolvedThread: "PRRT_kwDOAbc2",
  outdatedThread: "PRRT_kwDOAbc3",
  replyBody: "Thanks!",
  newThread: {
    path: "source/index.ts",
    side: "new",
    line: 12,
    startLine: 10,
    body: "Name it for what it checks.",
    headSha: THREADS_HEAD,
  },
  attachment: ATTACHMENT,
}));

/** A fetch that counts its calls and fails each with a dropped connection. */
const droppingFetch = () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  };
  return { fetch, calls: () => calls };
};

describe("GitHub review threads", () => {
  it("reads every page, in domain terms", async () => {
    const result = await threadsWith(createFixtureFetch(threadExchanges)).getThreads(pr);
    if (!result.ok) throw new Error(result.error.message);
    const { threads } = result.value;
    // A thread with no comments has nothing to show.
    expect(threads.map((thread) => thread.id)).toEqual([
      "PRRT_kwDOAbc1",
      "PRRT_kwDOAbc2",
      "PRRT_kwDOAbc3",
    ]);
    const [first, resolved, outdated] = threads;
    expect(first?.comments.map((comment) => comment.author)).toEqual([
      { id: "lee-park", name: "Lee Park" },
      { id: "sindresorhus", name: "sindresorhus" },
    ]);
    expect(first?.can).toEqual({ reply: true, resolve: true });
    // GitHub's start line equals the line on a one-line thread.
    expect(first?.startLine).toBeNull();
    expect(resolved).toMatchObject({
      side: "old",
      resolved: true,
      resolvedBy: { id: "sindresorhus", name: "sindresorhus" },
      can: { resolve: true },
      comments: [{ author: { id: "ghost" } }],
    });
    expect(outdated).toMatchObject({ outdated: true, line: null, originalLine: 776 });
  });

  it("makes one request for a write that fails on the network", async () => {
    for (const write of [
      (threads: ReturnType<typeof threadsWith>) => threads.reply(pr, "PRRT_kwDOAbc1", "Thanks!"),
      (threads: ReturnType<typeof threadsWith>) => threads.setResolved(pr, "PRRT_kwDOAbc1", true),
    ]) {
      const dropping = droppingFetch();
      const result = await write(threadsWith(dropping.fetch));
      expect(!result.ok && result.error.kind).toBe("network");
      expect(dropping.calls()).toBe(1);
    }
  });

  it("sends the token to github.com only, not to where an attachment redirects", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const recorded = createFixtureFetch(attachmentExchanges);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      seen.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return recorded(input, init);
    };
    const result = await threadsWith(fetch).getAttachment(ATTACHMENT);
    expect(result.ok && new TextDecoder().decode(result.value.bytes)).toBe("PNGDATA");
    expect(seen.map((one) => one.authorization)).toEqual(["Bearer test-token", null]);
  });

  it("refuses an attachment that isn't an image or a video, or is too large", async () => {
    const serving = (headers: Record<string, string>) =>
      createFixtureFetch([
        {
          request: { method: "GET", url: ATTACHMENT },
          response: { status: 200, headers, body: "x" },
        },
      ]);
    const svg = await threadsWith(serving({ "content-type": "image/svg+xml" })).getAttachment(
      ATTACHMENT,
    );
    expect(!svg.ok && svg.error.kind).toBe("rejected");
    const huge = await threadsWith(
      serving({ "content-type": "video/mp4", "content-length": String(26 * 1024 * 1024) }),
    ).getAttachment(ATTACHMENT);
    expect(!huge.ok && huge.error.kind).toBe("too-large");
    const missing = await threadsWith(
      createFixtureFetch([
        {
          request: { method: "GET", url: ATTACHMENT },
          response: { status: 404, headers: {}, body: null },
        },
      ]),
    ).getAttachment(ATTACHMENT);
    expect(!missing.ok && missing.error.kind).toBe("not-found");
    const dropped = await threadsWith(async () => {
      throw new TypeError("fetch failed");
    }).getAttachment(ATTACHMENT);
    expect(!dropped.ok && dropped.error.kind).toBe("network");
  });

  it("reports rejected credentials", async () => {
    const result = await threadsWith(
      createFixtureFetch(unauthorizedExchanges as RecordedExchange[]),
    ).getThreads(pr);
    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });
});
