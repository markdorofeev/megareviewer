import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describeReviewThreadsContract,
  FixedClock,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { PullRequestRef } from "../../domain/review/index.ts";
import { refusedRefUpdate, THREADS_HEAD, threadExchanges } from "./fixtures/threads.synthetic.ts";
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

const commit = {
  headSha: THREADS_HEAD,
  message: "Apply 2 suggestions from code review",
  files: [
    { path: "source/index.ts", content: "new source/index.ts\n" },
    { path: "test/test.ts", content: "new test/test.ts\n" },
  ],
};

describeReviewThreadsContract("github", () => ({
  threads: () => threadsWith(createFixtureFetch(threadExchanges)),
  pr,
  thread: "PRRT_kwDOAbc1",
  resolvedThread: "PRRT_kwDOAbc2",
  outdatedThread: "PRRT_kwDOAbc3",
  replyBody: "Thanks!",
  commit,
  staleCommit: { ...commit, headSha: "0".repeat(40) },
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
    const { threads, canApply } = result.value;
    expect(canApply).toBe(true);
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

  it("commits each file's blob in a tree keeping its mode, then moves the branch", async () => {
    const result = await threadsWith(createFixtureFetch(threadExchanges)).applySuggestions(
      pr,
      commit,
    );
    expect(result).toEqual({ ok: true, value: { sha: "4".repeat(40) } });
  });

  it("refuses when GitHub won't fast-forward the branch", async () => {
    const result = await threadsWith(
      createFixtureFetch([
        ...threadExchanges.filter((exchange) => exchange.request.method !== "PATCH"),
        refusedRefUpdate,
      ] satisfies RecordedExchange[]),
    ).applySuggestions(pr, commit);
    expect(!result.ok && result.error.kind).toBe("rejected");
    expect(!result.ok && result.error.message).toContain("not a fast forward");
  });

  it("refuses a PR whose fork was deleted", async () => {
    const exchanges = threadExchanges.map((exchange) =>
      exchange.request.url.endsWith("/pulls/210")
        ? {
            ...exchange,
            response: {
              ...exchange.response,
              body: { head: { ref: "x", sha: THREADS_HEAD, repo: null } },
            },
          }
        : exchange,
    );
    const result = await threadsWith(createFixtureFetch(exchanges)).applySuggestions(pr, commit);
    expect(!result.ok && result.error.message).toContain("fork was deleted");
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

  it("reports rejected credentials", async () => {
    const result = await threadsWith(
      createFixtureFetch(unauthorizedExchanges as RecordedExchange[]),
    ).getThreads(pr);
    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });
});
