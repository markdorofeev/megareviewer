import { beforeEach, describe, expect, it } from "vitest";
import {
  type PullRequestRef,
  ThreadComment,
  type ThreadId,
  ThreadList,
} from "../../../domain/review/index.ts";
import type { NewThread, ReviewThreads } from "../../ports/index.ts";

export interface ReviewThreadsContractSetup {
  threads(): ReviewThreads;
  pr: PullRequestRef;
  /** A thread with replies, open, that the user may reply to and resolve. */
  thread: ThreadId;
  resolvedThread: ThreadId;
  outdatedThread: ThreadId;
  /** The reply `reply` posts to `thread`. */
  replyBody: string;
  /** A comment on a line the PR's diff shows. */
  newThread: NewThread;
  /** An image in the host's attachment store. */
  attachment: string;
}

export const describeReviewThreadsContract = (
  name: string,
  setup: () => ReviewThreadsContractSetup,
): void => {
  describe(`ReviewThreads contract: ${name}`, () => {
    let s: ReviewThreadsContractSetup;
    beforeEach(() => {
      s = setup();
    });

    it("reads the threads in domain shape, replies in the order they were written", async () => {
      const result = await s.threads().getThreads(s.pr);
      if (!result.ok) throw new Error(`getThreads failed: ${result.error.message}`);
      expect(ThreadList.parse(result.value)).toEqual(result.value);

      const thread = result.value.threads.find((one) => one.id === s.thread);
      expect(thread?.comments.length).toBeGreaterThan(1);
      const times = thread?.comments.map((comment) => comment.createdAt) ?? [];
      expect(times).toEqual([...times].sort());
      expect(thread?.resolved).toBe(false);
      expect(result.value.threads.find((one) => one.id === s.resolvedThread)?.resolved).toBe(true);
      expect(result.value.threads.find((one) => one.id === s.outdatedThread)?.outdated).toBe(true);
    });

    it("replies, returning the new comment", async () => {
      const result = await s.threads().reply(s.pr, s.thread, s.replyBody);
      if (!result.ok) throw new Error(`reply failed: ${result.error.message}`);
      expect(ThreadComment.parse(result.value)).toEqual(result.value);
      expect(result.value.body).toBe(s.replyBody);
    });

    it("starts a thread with a comment on a line", async () => {
      expect(await s.threads().comment(s.pr, s.newThread)).toEqual({ ok: true, value: null });
    });

    it("resolves a thread and reopens it", async () => {
      const threads = s.threads();
      expect(await threads.setResolved(s.pr, s.thread, true)).toEqual({ ok: true, value: null });
      expect(await threads.setResolved(s.pr, s.thread, false)).toEqual({ ok: true, value: null });
    });

    it("fetches an attachment from the host's store, and nothing from anywhere else", async () => {
      const threads = s.threads();
      const found = await threads.getAttachment(s.attachment);
      if (!found.ok) throw new Error(`getAttachment failed: ${found.error.message}`);
      expect(found.value.contentType).toMatch(/^image\//);
      expect(found.value.bytes.byteLength).toBeGreaterThan(0);
      const foreign = await threads.getAttachment("https://evil.test/pixel.png");
      expect(!foreign.ok && foreign.error.kind).toBe("not-found");
    });
  });
};
