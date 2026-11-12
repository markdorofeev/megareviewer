import { describe, expect, it } from "vitest";
import { describeReviewThreadsContract } from "./contracts/review-threads-contract.ts";
import { FakeReviewThreads } from "./fake-review-threads.ts";
import { FixedClock } from "./fixed-clock.ts";
import { smallFeature, smallFeatureThreadList } from "./fixtures/index.ts";

const { ref } = smallFeature.pullRequest;

const ATTACHMENT = "https://github.com/user-attachments/assets/0a1b2c3d";

const seeded = () => {
  const threads = new FakeReviewThreads({ host: "github" });
  threads.setThreads(ref, smallFeatureThreadList);
  threads.setAttachment(ATTACHMENT, { contentType: "image/png", bytes: new Uint8Array([1]) });
  return threads;
};

describeReviewThreadsContract("fake", () => ({
  threads: seeded,
  pr: ref,
  thread: "PRRT_cache",
  resolvedThread: "PRRT_rate",
  outdatedThread: "PRRT_outdated",
  replyBody: "Capped at 1,000 entries.",
  newThread: {
    path: "src/services/receipts.ts",
    side: "new",
    line: 4,
    body: "Name it for what it counts.",
    headSha: smallFeature.pullRequest.headSha,
  },
  attachment: ATTACHMENT,
}));

describe("FakeReviewThreads", () => {
  it("adds replies and records who resolved a thread", async () => {
    const threads = new FakeReviewThreads({
      host: "github",
      clock: new FixedClock("2026-10-21T10:00:00Z"),
    });
    threads.setThreads(ref, smallFeatureThreadList);
    await threads.reply(ref, "PRRT_ttl", "Done.");
    await threads.setResolved(ref, "PRRT_ttl", true);
    const list = await threads.getThreads(ref);
    const thread = list.ok ? list.value.threads.find((one) => one.id === "PRRT_ttl") : undefined;
    expect(thread?.comments.at(-1)).toMatchObject({
      body: "Done.",
      createdAt: "2026-10-21T10:00:00.000Z",
    });
    expect(thread?.resolvedBy?.id).toBe("lee-park");
  });

  it("has no threads for an unknown PR, and no thread to write to", async () => {
    const threads = new FakeReviewThreads({ host: "github" });
    expect(await threads.getThreads(ref)).toEqual({
      ok: true,
      value: { threads: [] },
    });
    expect((await threads.reply(ref, "x", "y")).ok).toBe(false);
    expect((await threads.setResolved(ref, "x", true)).ok).toBe(false);
  });

  it("lists a new thread with its comment", async () => {
    const threads = seeded();
    await threads.comment(ref, {
      path: "src/a.ts",
      side: "new",
      line: 9,
      startLine: 7,
      body: "Split this.",
      headSha: "h",
    });
    const list = await threads.getThreads(ref);
    expect(list.ok && list.value.threads.at(-1)).toMatchObject({
      path: "src/a.ts",
      line: 9,
      startLine: 7,
      comments: [{ body: "Split this." }],
    });
  });

  it("fails as scripted", async () => {
    const threads = seeded();
    threads.failNext("getThreads", { kind: "network", message: "down", retryAfterSeconds: null });
    expect((await threads.getThreads(ref)).ok).toBe(false);
    expect((await threads.getThreads(ref)).ok).toBe(true);
  });
});
