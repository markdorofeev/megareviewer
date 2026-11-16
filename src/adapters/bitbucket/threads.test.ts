import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createFixtureFetch,
  describeReviewThreadsContract,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { PullRequestRef } from "../../domain/review/index.ts";
import resolvedThreadExchanges from "./fixtures/resolved-threads.json" with { type: "json" };
import {
  BITBUCKET_ATTACHMENT,
  bitbucketAttachmentExchanges,
  bitbucketThreadExchanges,
} from "./fixtures/threads.synthetic.ts";
import { createBitbucketReviewThreads } from "./index.ts";
import { BitbucketThreadComment } from "./schemas.ts";
import { toThreads, withMentions } from "./threads.ts";

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

describeReviewThreadsContract("bitbucket", () => ({
  threads: () =>
    threadsWith(createFixtureFetch([...bitbucketThreadExchanges, ...bitbucketAttachmentExchanges])),
  pr,
  thread: "101",
  resolvedThread: "201",
  outdatedThread: "401",
  replyBody: "Thanks!",
  newThread: {
    path: "pipe/pipe.py",
    side: "new",
    line: 42,
    body: "Retry once more?",
    headSha: "b467819f28a4ca3cfbbdb889bd1bc7ba6918522d",
  },
  attachment: BITBUCKET_ATTACHMENT,
}));

describe("Bitbucket review threads", () => {
  it("builds threads from inline comments and their chains of replies", async () => {
    const result = await threadsWith(createFixtureFetch(bitbucketThreadExchanges)).getThreads(pr);
    if (!result.ok) throw new Error(result.error.message);
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

describe("withMentions", () => {
  const names = new Map([
    ["557058:0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", "Ana Silva"],
    ["5b0edaebb485a923ce5a46dd", "Lee *the* [Park]"],
  ]);

  it("names the people a mention writes as an account ID, when the comments show who", () => {
    expect(
      withMentions(
        "Hi @{557058:0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f}, ask @{5b0edaebb485a923ce5a46dd} or @{6132486f44c8ed0068a6ba6a}",
        names,
      ),
    ).toBe("Hi @Ana Silva, ask @Lee \\*the\\* \\[Park\\] or @{6132486f44c8ed0068a6ba6a}");
  });

  it("reads the account IDs from the comments' authors when building threads", () => {
    const threads = toThreads([
      {
        id: 1,
        content: { raw: "@{5b0edaebb485a923ce5a46dd} is this needed?" },
        user: { uuid: "{a}", display_name: "Ana Silva", account_id: "557058:a" },
        created_on: "2026-01-02T09:00:00.000000+00:00",
        inline: { path: "app.py", from: null, to: 3 },
      },
      {
        id: 2,
        content: { raw: "@{557058:a} yes" },
        user: { uuid: "{l}", display_name: "Lee Park", account_id: "5b0edaebb485a923ce5a46dd" },
        created_on: "2026-01-02T09:05:00.000000+00:00",
        parent: { id: 1 },
      },
    ]);
    expect(threads[0]?.comments.map((comment) => comment.body)).toEqual([
      "@Lee Park is this needed?",
      "@Ana Silva yes",
    ]);
  });
});

describe("who resolved a Bitbucket thread", () => {
  const triggerPipeline: PullRequestRef = {
    repo: { host: "bitbucket", owner: "atlassian", repo: "trigger-pipeline" },
    number: 56,
  };
  const [asked, unasked] = resolvedThreadExchanges as RecordedExchange[];

  it("names the person who resolved it, which the comments list gives only when asked", async () => {
    const result = await threadsWith(createFixtureFetch(resolvedThreadExchanges)).getThreads(
      triggerPipeline,
    );
    if (!result.ok) throw new Error(result.error.message);
    const thread = result.value.threads.find((one) => one.id === "498821522");
    expect(thread?.comments[0]?.author.name).toBe("user-7a306388");
    expect(thread?.resolvedBy).toEqual({
      id: "{5d6d69c0-bfad-4ee1-9e60-6af86e640907}",
      name: "user-5d6d69c0",
    });
    expect(asked?.request.url).toContain("fields=");
  });

  it("says nothing about who when the resolution doesn't name them", () => {
    const body = unasked?.response.body as { values: unknown[] };
    const threads = toThreads(z.array(BitbucketThreadComment).parse(body.values));
    const resolved = threads.filter((thread) => thread.resolved);
    expect(resolved.map((thread) => thread.id)).toEqual([
      "498821522",
      "498822059",
      "498823189",
      "498823865",
    ]);
    expect(resolved.map((thread) => thread.resolvedBy)).toEqual([null, null, null, null]);
  });
});
