import { describe, expect, it } from "vitest";
import { describeReviewThreadsContract } from "./contracts/review-threads-contract.ts";
import { FakeGitHost } from "./fake-git-host.ts";
import { FakeReviewThreads } from "./fake-review-threads.ts";
import { FixedClock } from "./fixed-clock.ts";
import { allFixtures, smallFeature, smallFeatureThreadList } from "./fixtures/index.ts";

const { ref, headSha } = smallFeature.pullRequest;
const commit = {
  headSha,
  message: "Apply suggestion from code review",
  files: [{ path: "src/services/receipts.ts", content: "changed\n" }],
};

const ATTACHMENT = "https://github.com/user-attachments/assets/0a1b2c3d";

const seeded = () => {
  const threads = new FakeReviewThreads({ host: "github" });
  threads.setThreads(ref, smallFeatureThreadList, headSha);
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
  commit,
  staleCommit: { ...commit, headSha: "0".repeat(40) },
  attachment: ATTACHMENT,
}));

describe("FakeReviewThreads", () => {
  it("adds replies and records who resolved a thread", async () => {
    const threads = new FakeReviewThreads({
      host: "github",
      clock: new FixedClock("2026-10-21T10:00:00Z"),
    });
    threads.setThreads(ref, smallFeatureThreadList, headSha);
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
      value: { threads: [], canApply: false },
    });
    expect((await threads.reply(ref, "x", "y")).ok).toBe(false);
    expect((await threads.setResolved(ref, "x", true)).ok).toBe(false);
    expect(await threads.applySuggestions(ref, commit)).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });
  });

  it("fails as scripted", async () => {
    const threads = seeded();
    threads.failNext("getThreads", { kind: "network", message: "down", retryAfterSeconds: null });
    expect((await threads.getThreads(ref)).ok).toBe(false);
    expect((await threads.getThreads(ref)).ok).toBe(true);
  });

  it("moves a fake git host's head when it commits", async () => {
    const gitHost = new FakeGitHost({ host: "github", fixtures: allFixtures });
    const threads = new FakeReviewThreads({ host: "github", gitHost });
    threads.setThreads(ref, smallFeatureThreadList);
    const applied = await threads.applySuggestions(ref, commit);
    if (!applied.ok) throw new Error(applied.error.message);
    const pullRequest = await gitHost.getPullRequest(ref);
    expect(pullRequest.ok && pullRequest.value.headSha).toBe(applied.value.sha);
    expect(threads.commits).toHaveLength(1);
    expect((await threads.applySuggestions(ref, commit)).ok).toBe(false);
  });
});
