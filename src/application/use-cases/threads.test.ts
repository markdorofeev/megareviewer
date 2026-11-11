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
import { applyMessage } from "./threads.ts";

const { ref, headSha } = smallFeature.pullRequest;

const setup = async (options: { threads?: readonly ReviewThread[]; noThreads?: boolean } = {}) => {
  const clock = new FixedClock("2026-10-21T10:00:00Z");
  const github = new FakeGitHost({ host: "github", fixtures: allFixtures, clock });
  const threads = new FakeReviewThreads({ host: "github", clock, gitHost: github });
  threads.setThreads(ref, {
    threads: options.threads ?? smallFeatureThreadList.threads,
    canApply: true,
  });
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

describe("applySuggestions", () => {
  it("commits the suggestions in one commit on the analysis's head", async () => {
    const { useCases, threads, id } = await setup();
    const result = await useCases.applySuggestions(id, ["PRRC_ttl1", "PRRC_charset1"]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.paths).toEqual(["src/services/receipts.ts", "src/routes/orders.ts"]);
    const [commit] = threads.commits;
    expect(threads.commits).toHaveLength(1);
    expect(commit?.headSha).toBe(headSha);
    expect(commit?.message).toBe("Apply 2 suggestions from code review");
    const receipts = commit?.files.find((file) => file.path === "src/services/receipts.ts");
    expect(receipts?.content.split("\n")[2]).toBe("const RECEIPT_TTL_MS = 60 * 60 * 1_000;");
    expect(receipts?.content.split("\n")[3]).toBe(
      smallFeature.headFiles["src/services/receipts.ts"]?.split("\n")[3],
    );
    const orders = commit?.files.find((file) => file.path === "src/routes/orders.ts");
    expect(orders?.content.split("\n")[38]).toContain("charset=utf-8");
  });

  it("refuses a stale analysis and commits nothing", async () => {
    const { useCases, github, threads, id } = await setup();
    github.setHeadSha(ref, "f".repeat(40));
    expect(await useCases.applySuggestions(id, ["PRRC_ttl1"])).toMatchObject({
      ok: false,
      error: { code: "stale-analysis" },
    });
    expect(threads.commits).toEqual([]);
  });

  it("reads the files from the cache Collect filled before the host", async () => {
    const { useCases, fileCache, threads, id } = await setup();
    await fileCache.put(ref.repo, { sha: headSha, path: "src/services/receipts.ts" }, "a\nb\nc\n");
    const result = await useCases.applySuggestions(id, ["PRRC_ttl1"]);
    expect(result.ok).toBe(true);
    expect(threads.commits[0]?.message).toBe(applyMessage(1));
    expect(threads.commits[0]?.files[0]?.content).toBe(
      "a\nb\nconst RECEIPT_TTL_MS = 60 * 60 * 1_000;\n",
    );
  });

  it("refuses overlapping suggestions, comments without one and outdated ones", async () => {
    const base = smallFeatureThreadList.threads.find((thread) => thread.id === "PRRT_ttl");
    if (base === undefined) throw new Error("no fixture thread");
    const overlapping: ReviewThread = {
      ...base,
      id: "PRRT_ttl2",
      startLine: 2,
      comments: [{ ...base.comments[0], id: "PRRC_ttl2" } as ReviewThread["comments"][0]],
    };
    const { useCases, threads, id } = await setup({
      threads: [...smallFeatureThreadList.threads, overlapping],
    });
    expect(await useCases.applySuggestions(id, ["PRRC_ttl1", "PRRC_ttl2"])).toMatchObject({
      ok: false,
      error: { code: "bad-request", message: expect.stringContaining("Two suggestions change") },
    });
    expect(await useCases.applySuggestions(id, ["PRRC_cache1"])).toMatchObject({
      ok: false,
      error: { code: "bad-request", message: expect.stringContaining("doesn't suggest") },
    });
    expect(await useCases.applySuggestions(id, ["PRRC_outdated1"])).toMatchObject({
      ok: false,
      error: { code: "bad-request" },
    });
    expect(await useCases.applySuggestions(id, ["PRRC_missing"])).toMatchObject({
      ok: false,
      error: { code: "bad-request", message: expect.stringContaining("No comment") },
    });
    expect(threads.commits).toEqual([]);
  });

  it("turns the host refusing a moved branch into a stale analysis", async () => {
    const { useCases, threads, id } = await setup();
    threads.failNext("applySuggestions", {
      kind: "rejected",
      message: "Update is not a fast forward",
      retryAfterSeconds: null,
    });
    expect(await useCases.applySuggestions(id, ["PRRC_ttl1"])).toEqual({
      ok: false,
      error: { code: "stale-analysis", message: "Update is not a fast forward" },
    });
  });

  it("refuses an analysis that isn't complete, and runs one apply at a time", async () => {
    const { useCases, store, threads, id } = await setup();
    const [first, second] = await Promise.all([
      useCases.applySuggestions(id, ["PRRC_ttl1"]),
      useCases.applySuggestions(id, ["PRRC_ttl1"]),
    ]);
    expect(first).toEqual(second);
    expect(threads.commits).toHaveLength(1);
    await store.saveAnalysis({ ...smallFeatureAnalysis, status: "running" });
    expect(await useCases.applySuggestions(id, ["PRRC_ttl1"])).toMatchObject({
      ok: false,
      error: { code: "analysis-not-complete" },
    });
  });
});
