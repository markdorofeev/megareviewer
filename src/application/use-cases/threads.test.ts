import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../../domain/review/index.ts";
import { createAnalysisEvents } from "../events/index.ts";
import {
  allFixtures,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckouts,
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
  const store = new InMemoryAnalysisStore();
  const fileCache = new InMemoryFileCache();
  const useCases = createUseCases(
    {
      hosts: { github },
      threads: options.noThreads ? {} : { github: threads },
      tickets: new FakeTicketSource(),
      model: new FakeAnalysisModel(),
      modelEnabled: false,
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
  });

  it("passes the host's refusal on", async () => {
    const { useCases, id } = await setup();
    expect(await useCases.replyToThread(id, "PRRT_nope", "x")).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await useCases.resolveThread(id, "PRRT_nope", true)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});
