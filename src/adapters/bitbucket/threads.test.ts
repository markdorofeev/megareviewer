import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describeReviewThreadsContract,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { PullRequestRef } from "../../domain/review/index.ts";
import {
  BITBUCKET_ATTACHMENT,
  BITBUCKET_THREADS_HEAD,
  bitbucketAttachmentExchanges,
  bitbucketThreadExchanges,
  refusedCommit,
} from "./fixtures/threads.synthetic.ts";
import { createBitbucketReviewThreads } from "./index.ts";

const pr: PullRequestRef = {
  repo: { host: "bitbucket", owner: "atlassian", repo: "bitbucket-upload-file" },
  number: 26,
};

const threadsWith = (fetch: typeof globalThis.fetch) =>
  createBitbucketReviewThreads({
    username: "lee",
    password: "token",
    logger: new RecordingLogger(),
    fetch,
  });

const commit = {
  headSha: BITBUCKET_THREADS_HEAD,
  message: "Apply suggestion from code review",
  files: [{ path: "pipe/pipe.py", content: "retries = 3\n" }],
};

describeReviewThreadsContract("bitbucket", () => ({
  threads: () =>
    threadsWith(createFixtureFetch([...bitbucketThreadExchanges, ...bitbucketAttachmentExchanges])),
  pr,
  thread: "101",
  resolvedThread: "201",
  outdatedThread: "401",
  replyBody: "Thanks!",
  commit,
  staleCommit: { ...commit, headSha: "0".repeat(40) },
  attachment: BITBUCKET_ATTACHMENT,
}));

describe("Bitbucket review threads", () => {
  it("builds threads from inline comments and their chains of replies", async () => {
    const result = await threadsWith(createFixtureFetch(bitbucketThreadExchanges)).getThreads(pr);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.canApply).toBe(true);
    const byId = new Map(result.value.threads.map((thread) => [thread.id, thread]));
    // A general comment isn't on code; a deleted thread with no replies has nothing to show.
    expect([...byId.keys()]).toEqual(["101", "201", "401", "501"]);
    expect(byId.get("101")).toMatchObject({
      side: "new",
      line: 42,
      startLine: null,
      resolved: false,
      outdated: false,
    });
    expect(byId.get("101")?.comments.map((comment) => comment.id)).toEqual(["101", "103", "104"]);
    expect(byId.get("201")).toMatchObject({
      side: "old",
      line: 17,
      resolved: true,
      resolvedBy: { name: "Ana Silva" },
    });
    expect(byId.get("401")).toMatchObject({ outdated: true, line: 12, startLine: 10 });
    // A deleted first comment keeps the thread for its replies.
    expect(byId.get("501")?.comments.map((comment) => comment.body)).toEqual([
      "Still worth a look.",
    ]);
  });

  it("can't apply without write permission", async () => {
    const exchanges = bitbucketThreadExchanges.map((exchange) =>
      exchange.request.url.includes("/permissions/repositories")
        ? {
            ...exchange,
            response: { ...exchange.response, body: { values: [{ permission: "read" }] } },
          }
        : exchange,
    );
    const result = await threadsWith(createFixtureFetch(exchanges)).getThreads(pr);
    expect(result.ok && result.value.canApply).toBe(false);
  });

  it("commits on the source branch with the head as parent, reading the SHA it made", async () => {
    const result = await threadsWith(createFixtureFetch(bitbucketThreadExchanges)).applySuggestions(
      pr,
      commit,
    );
    expect(result).toEqual({ ok: true, value: { sha: "5".repeat(40) } });
  });

  it("refuses when Bitbucket says the branch moved", async () => {
    const result = await threadsWith(
      createFixtureFetch([
        ...bitbucketThreadExchanges.filter((exchange) => !exchange.request.url.endsWith("/src")),
        refusedCommit,
      ] satisfies RecordedExchange[]),
    ).applySuggestions(pr, commit);
    expect(!result.ok && result.error.kind).toBe("rejected");
  });

  it("makes one request for a write that fails on the network", async () => {
    let calls = 0;
    const dropping: typeof fetch = async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    };
    const result = await threadsWith(dropping).reply(pr, "101", "Thanks!");
    expect(!result.ok && result.error.kind).toBe("network");
    expect(calls).toBe(1);
  });

  it("reads a repository file linked by its raw URL through the API, which takes the token", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const recording: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response("PNGDATA", { headers: { "content-type": "image/png" } });
    };
    const result = await threadsWith(recording).getAttachment(
      "https://bitbucket.org/atlassian/bitbucket-upload-file/raw/51b7da02ca1b/docs/a%20shot.png",
    );
    expect(result.ok && result.value.contentType).toBe("image/png");
    expect(requests).toEqual([
      {
        url: "https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/src/51b7da02ca1b/docs/a%20shot.png",
        authorization: `Basic ${btoa("lee:token")}`,
      },
    ]);
  });

  it("reports rejected credentials", async () => {
    const rejecting = bitbucketThreadExchanges.map((exchange) => ({
      ...exchange,
      response: { status: 401, headers: {}, body: "" },
    }));
    const result = await threadsWith(createFixtureFetch(rejecting)).getThreads(pr);
    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });
});
