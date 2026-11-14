import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../../domain/review/index.ts";
import { createAnalysisEvents } from "../events/index.ts";
import {
  allFixtures,
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakeReviewThreads,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  RecordingLogger,
  smallFeature,
  smallFeatureAnalysis,
  smallFeatureThreadList,
} from "../testing/index.ts";
import { createUseCases } from "./create-use-cases.ts";
import { MAX_CACHED_ATTACHMENT_BYTES } from "./threads.ts";

const { ref } = smallFeature.pullRequest;

const setup = async (options: { threads?: readonly ReviewThread[]; noThreads?: boolean } = {}) => {
  const clock = new FixedClock("2026-10-21T10:00:00Z");
  const github = new FakeGitHost({ host: "github", fixtures: allFixtures, clock });
  const threads = new FakeReviewThreads({ host: "github", clock });
  threads.setThreads(ref, { threads: options.threads ?? smallFeatureThreadList.threads });
  const store = new InMemoryAnalysisStore(clock);
  const fileCache = new InMemoryFileCache();
  const useCases = createUseCases(
    {
      hosts: { github },
      threads: options.noThreads ? {} : { github: threads },
      statuses: {},
      tickets: new FakeTicketSource(),
      models: new FakeModelCatalog(),
      store,
      fileCache,
      checkouts: new FakeLocalCheckouts(),
      parser: new FakeCodeParser(),
      events: createAnalysisEvents(),
      clock,
      logger: new RecordingLogger(),
    },
    { version: "1.2.3" },
  );
  await store.saveAnalysis(smallFeatureAnalysis);
  return { github, threads, store, fileCache, useCases, id: smallFeatureAnalysis.id };
};

describe("getThreads", () => {
  it("reads the PR's threads from its host", async () => {
    const { useCases, id } = await setup();
    const result = await useCases.getThreads(id);
    expect(result.ok && result.value.threads.map((thread) => thread.id)).toContain("PRRT_cache");
  });

  it("fails as a host error, leaving the analysis readable", async () => {
    const { useCases, threads, id } = await setup();
    threads.failNext("getThreads", { kind: "network", message: "down", retryAfterSeconds: null });
    expect(await useCases.getThreads(id)).toEqual({
      ok: false,
      error: { code: "host-error", message: "down" },
    });
    expect((await useCases.getAnalysisView(id)).ok).toBe(true);
  });

  it("needs a known analysis and a configured host", async () => {
    const { useCases } = await setup({ noThreads: true });
    expect(await useCases.getThreads(smallFeatureAnalysis.id)).toMatchObject({
      ok: false,
      error: { code: "host-not-configured" },
    });
    const missing = await setup();
    expect(
      await missing.useCases.getThreads("a_0000000000000000" as typeof smallFeatureAnalysis.id),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});

describe("getAttachment", () => {
  it("fetches an attachment through the PR's host", async () => {
    const { useCases, threads, id } = await setup();
    const url = "https://github.com/user-attachments/assets/1a2b";
    threads.setAttachment(url, { contentType: "video/mp4", bytes: new Uint8Array([1]) });
    expect(await useCases.getAttachment(id, url)).toMatchObject({
      ok: true,
      value: { contentType: "video/mp4" },
    });
    expect(await useCases.getAttachment(id, "https://evil.test/a.png")).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("getAttachment's memory", () => {
  const url = (n: number) => `https://github.com/user-attachments/assets/${n}`;

  it("asks the host once per attachment, but again after a failure", async () => {
    const { useCases, threads, id } = await setup();
    threads.setAttachment(url(1), { contentType: "video/mp4", bytes: new Uint8Array([1]) });
    let asked = 0;
    const original = threads.getAttachment.bind(threads);
    threads.getAttachment = (one) => {
      asked += 1;
      return original(one);
    };
    threads.failNext("getAttachment", {
      kind: "network",
      message: "down",
      retryAfterSeconds: null,
    });
    expect((await useCases.getAttachment(id, url(1))).ok).toBe(false);
    expect((await useCases.getAttachment(id, url(1))).ok).toBe(true);
    expect((await useCases.getAttachment(id, url(1))).ok).toBe(true);
    expect(asked).toBe(2);
  });

  it("forgets the oldest past 100 MB", async () => {
    const { useCases, threads, id } = await setup();
    const big = new Uint8Array(MAX_CACHED_ATTACHMENT_BYTES / 2);
    for (const n of [1, 2, 3])
      threads.setAttachment(url(n), { contentType: "video/mp4", bytes: big });
    let asked: string[] = [];
    const original = threads.getAttachment.bind(threads);
    threads.getAttachment = (one) => {
      asked.push(one);
      return original(one);
    };
    for (const n of [1, 2, 3]) await useCases.getAttachment(id, url(n));
    asked = [];
    await useCases.getAttachment(id, url(3));
    await useCases.getAttachment(id, url(2));
    await useCases.getAttachment(id, url(1));
    expect(asked).toEqual([url(1)]);
  });
});

describe("replyToThread and resolveThread", () => {
  it("posts a trimmed reply and resolves", async () => {
    const { useCases, id } = await setup();
    const reply = await useCases.replyToThread(id, "PRRT_cache", "  Capped.  ");
    expect(reply.ok && reply.value.body).toBe("Capped.");
    expect(await useCases.resolveThread(id, "PRRT_cache", true)).toEqual({
      ok: true,
      value: { resolved: true },
    });
    const list = await useCases.getThreads(id);
    const thread = list.ok ? list.value.threads.find((one) => one.id === "PRRT_cache") : undefined;
    expect(thread?.resolved).toBe(true);
    expect(thread?.comments.at(-1)?.body).toBe("Capped.");
    // A reply is review activity; resolving isn't.
    expect(await useCases.getReviewActivity()).toEqual({
      reviews: [],
      comments: ["2026-10-21T10:00:00.000Z"],
    });
  });

  it("passes the host's refusal on, recording nothing", async () => {
    const { useCases, id } = await setup();
    expect(await useCases.replyToThread(id, "PRRT_nope", "x")).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect((await useCases.getReviewActivity()).comments).toEqual([]);
    expect(await useCases.resolveThread(id, "PRRT_nope", true)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("postComment", () => {
  // A hunk with two added lines, for a range.
  const hunk = smallFeatureAnalysis.files
    .flatMap((file) => file.hunks)
    .find((one) => one.lines.filter((line) => line.kind === "add").length >= 2);
  const added = hunk?.lines.filter((line) => line.kind === "add").map((line) => line.newLine);
  const [first, second] = added ?? [];
  if (hunk === undefined || first == null || second == null) {
    throw new Error("small-feature has two added lines");
  }
  const comment = { hunkId: hunk.id, side: "new" as const, line: second, body: "Why 600?" };

  it("starts a thread on the lines now, on the analysis's head", async () => {
    const { useCases, id } = await setup();
    const posted = await useCases.postComment(id, {
      ...comment,
      startLine: first,
    });
    expect(posted).toEqual({ ok: true, value: null });
    expect((await useCases.getReviewActivity()).comments).toHaveLength(1);
    const list = await useCases.getThreads(id);
    expect(list.ok && list.value.threads.at(-1)).toMatchObject({
      path: hunk.path,
      side: "new",
      line: second,
      startLine: first,
      comments: [{ body: "Why 600?", originalCommit: smallFeature.pullRequest.headSha }],
    });
  });

  it("refuses a line the diff doesn't show, a comment with no text and a stale analysis", async () => {
    const { useCases, github, id } = await setup();
    expect(await useCases.postComment(id, { ...comment, line: 9_999 })).toMatchObject({
      ok: false,
      error: { code: "bad-request" },
    });
    expect(await useCases.postComment(id, { ...comment, body: "  " })).toMatchObject({
      ok: false,
      error: { code: "bad-request" },
    });
    github.setHeadSha(ref, "2".repeat(40));
    expect(await useCases.postComment(id, comment)).toMatchObject({
      ok: false,
      error: { code: "stale-analysis" },
    });
    const list = await useCases.getThreads(id);
    expect(list.ok && list.value.threads.length).toBe(smallFeatureThreadList.threads.length);
  });

  it("passes the host's refusal on, recording nothing", async () => {
    const { useCases, threads, id } = await setup();
    threads.failNext("comment", { kind: "rejected", message: "No.", retryAfterSeconds: null });
    expect(await useCases.postComment(id, comment)).toMatchObject({ ok: false });
    expect((await useCases.getReviewActivity()).comments).toEqual([]);
  });
});
