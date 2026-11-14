import { describe, expect, it } from "vitest";
import type { HostError } from "../../domain/review/index.ts";
import {
  FakeGitHost,
  FakePullRequestStatusSource,
  FakeReviewThreads,
  RecordingLogger,
  smallFeature,
  smallFeaturePublication,
  smallFeatureThreadList,
} from "../testing/index.ts";
import { retryingGitHost, retryingReviewThreads, retryingStatusSource } from "./index.ts";

const networkError: HostError = {
  kind: "network",
  message: "Can't reach GitHub: other side closed",
  retryAfterSeconds: null,
};

const setup = () => {
  const fake = new FakeGitHost({ host: "github", fixtures: [smallFeature] });
  const logger = new RecordingLogger();
  const delays: number[] = [];
  const host = retryingGitHost(fake, {
    logger,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { fake, host, logger, delays };
};

const { ref } = smallFeature.pullRequest;

describe("retryingGitHost", () => {
  it("retries a network failure after 1 s, then 2 s, then 4 s", async () => {
    const { fake, host, delays } = setup();
    for (let i = 0; i < 3; i += 1) fake.failNext("getPullRequest", networkError);

    const result = await host.getPullRequest(ref);

    expect(result.ok).toBe(true);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("gives up after four attempts with the last network error", async () => {
    const { fake, host, delays } = setup();
    for (let i = 0; i < 4; i += 1) fake.failNext("currentUser", networkError);

    expect(await host.currentUser()).toEqual({ ok: false, error: networkError });
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("logs each retry as a warning", async () => {
    const { fake, host, logger } = setup();
    fake.failNext("listPullRequests", networkError);

    await host.listPullRequests();

    expect(logger.entries.filter((entry) => entry.level === "warn")).toEqual([
      expect.objectContaining({
        message: "Retrying the pull request list after a network error",
        fields: { host: "github", error: networkError.message, delayMs: 1000 },
      }),
    ]);
  });

  it("retries file reads", async () => {
    const { fake, host } = setup();
    fake.failNext("getFiles", networkError);
    const [path, content] = Object.entries(smallFeature.headFiles)[0] ?? [];
    const sha = smallFeature.pullRequest.headSha;

    const result = await host.getFiles(ref.repo, [{ sha, path: path ?? "" }]);

    expect(result).toEqual({ ok: true, value: [content] });
  });

  it("retries the lookup of opened PRs", async () => {
    const { fake, host } = setup();
    fake.failNext("getOpenPullRequests", networkError);

    const result = await host.getOpenPullRequests([ref]);

    expect(result.ok && result.value.map((summary) => summary.ref)).toEqual([ref]);
  });

  it.each([
    ["unauthorized", { kind: "unauthorized", message: "no", retryAfterSeconds: null }],
    ["rate-limited", { kind: "rate-limited", message: "slow down", retryAfterSeconds: 60 }],
    ["not-found", { kind: "not-found", message: "gone", retryAfterSeconds: null }],
  ] as const)("returns %s at once", async (_kind, error) => {
    const { fake, host, delays } = setup();
    fake.failNext("getPullRequest", error);

    expect(await host.getPullRequest(ref)).toEqual({ ok: false, error });
    expect(delays).toEqual([]);
  });

  it("never retries publishing, since a failed post may still have been posted", async () => {
    const { fake, host, delays } = setup();
    fake.failNext("publish", networkError);

    const result = await host.publish(ref, smallFeaturePublication, {
      headSha: smallFeature.pullRequest.headSha,
      alreadyPosted: new Set(),
      onPosted: async () => {},
    });

    expect(result).toEqual({ ok: false, error: networkError });
    expect(delays).toEqual([]);
  });

  it("keeps the wrapped host's kind", () => {
    expect(setup().host.host).toBe("github");
  });
});

describe("retryingReviewThreads", () => {
  const threadSetup = () => {
    const fake = new FakeReviewThreads({ host: "github" });
    fake.setThreads(ref, smallFeatureThreadList);
    const delays: number[] = [];
    const threads = retryingReviewThreads(fake, {
      logger: new RecordingLogger(),
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    return { fake, threads, delays };
  };

  it("retries reading threads after a network failure", async () => {
    const { fake, threads, delays } = threadSetup();
    fake.failNext("getThreads", networkError);
    expect((await threads.getThreads(ref)).ok).toBe(true);
    expect(delays).toEqual([1000]);
    expect(threads.host).toBe("github");
  });

  it("never retries a write", async () => {
    const { fake, threads, delays } = threadSetup();
    fake.failNext("reply", networkError);
    fake.failNext("setResolved", networkError);
    fake.failNext("comment", networkError);
    expect(await threads.reply(ref, "PRRT_cache", "x")).toEqual({ ok: false, error: networkError });
    expect(await threads.setResolved(ref, "PRRT_cache", true)).toEqual({
      ok: false,
      error: networkError,
    });
    expect(
      await threads.comment(ref, {
        path: "src/a.ts",
        side: "new" as const,
        line: 1,
        body: "x",
        headSha: "h",
      }),
    ).toEqual({
      ok: false,
      error: networkError,
    });
    expect(delays).toEqual([]);
    expect((await threads.reply(ref, "PRRT_cache", "x")).ok).toBe(true);
    expect((await threads.setResolved(ref, "PRRT_cache", true)).ok).toBe(true);
  });
});

describe("retryingStatusSource", () => {
  it("retries reading the status after a network failure, but not after a refusal", async () => {
    const fake = new FakePullRequestStatusSource({ host: "github" });
    const delays: number[] = [];
    const source = retryingStatusSource(fake, {
      logger: new RecordingLogger(),
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    fake.failNext(networkError);
    expect((await source.getStatus(ref, "abc")).ok).toBe(true);
    expect(delays).toEqual([1000]);
    expect(source.host).toBe("github");

    fake.failNext({ kind: "forbidden", message: "no", retryAfterSeconds: null });
    expect((await source.getStatus(ref, "abc")).ok).toBe(false);
    expect(delays).toEqual([1000]);
  });
});
