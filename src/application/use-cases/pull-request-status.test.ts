import { describe, expect, it } from "vitest";
import { createAnalysisEvents } from "../events/index.ts";
import {
  FakeAnalysisModel,
  FakeCodeParser,
  FakeLocalCheckouts,
  FakePullRequestStatusSource,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  RecordingLogger,
  smallFeature,
  smallFeatureAnalysis,
  smallFeatureStatus,
} from "../testing/index.ts";
import { createUseCases } from "./create-use-cases.ts";

const setup = async (options: { configured?: boolean } = {}) => {
  const statuses = new FakePullRequestStatusSource({ host: "github" });
  statuses.setStatus(smallFeature.pullRequest.ref, smallFeatureStatus);
  const store = new InMemoryAnalysisStore();
  const useCases = createUseCases(
    {
      hosts: {},
      threads: {},
      statuses: options.configured === false ? {} : { github: statuses },
      tickets: new FakeTicketSource(),
      model: new FakeAnalysisModel(),
      modelAvailability: async () => ({ available: true, via: "the fake model" }),
      store,
      fileCache: new InMemoryFileCache(),
      checkouts: new FakeLocalCheckouts(),
      parser: new FakeCodeParser(),
      events: createAnalysisEvents(),
      clock: new FixedClock("2026-10-21T10:00:00Z"),
      logger: new RecordingLogger(),
    },
    { version: "1.2.3" },
  );
  await store.saveAnalysis(smallFeatureAnalysis);
  return { statuses, useCases, id: smallFeatureAnalysis.id };
};

describe("getPullRequestStatus", () => {
  it("reads the status from the PR's host, with the checks on the analysis's head", async () => {
    const { statuses, useCases, id } = await setup();
    expect(await useCases.getPullRequestStatus(id)).toEqual({
      ok: true,
      value: smallFeatureStatus,
    });
    expect(statuses.asked).toEqual([smallFeatureAnalysis.key.headSha]);
  });

  it("fails as a host error, leaving the analysis readable", async () => {
    const { statuses, useCases, id } = await setup();
    statuses.failNext({ kind: "network", message: "down", retryAfterSeconds: null });
    expect(await useCases.getPullRequestStatus(id)).toEqual({
      ok: false,
      error: { code: "host-error", message: "down" },
    });
    expect((await useCases.getAnalysisView(id)).ok).toBe(true);
  });

  it("needs a known analysis and a configured host", async () => {
    const unconfigured = await setup({ configured: false });
    expect(await unconfigured.useCases.getPullRequestStatus(unconfigured.id)).toMatchObject({
      ok: false,
      error: { code: "host-not-configured" },
    });
    const { useCases } = await setup();
    expect(
      await useCases.getPullRequestStatus("a_0000000000000000" as typeof smallFeatureAnalysis.id),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});
