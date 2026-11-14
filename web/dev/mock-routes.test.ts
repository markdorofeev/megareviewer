import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisIdResponse,
  AnalysisView,
  ErrorResponse,
  routes,
  TOKEN_HEADER,
} from "../../contracts/index.ts";
import {
  inProgress,
  PointReview,
  Publication,
  PublicationReceipt,
  pointsOf,
} from "../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks, largeAnalysisView } from "./fixtures/index.ts";
import {
  createMockApi,
  MOCK_FAILING_PR_NUMBER,
  MOCK_LARGE_PR_NUMBER,
  MOCK_STAGE_MS,
  MOCK_TOKEN,
  type MockApi,
  type MockEvent,
  type MockRequest,
} from "./mock-routes.ts";
import { analysisFailed, analysisInProgress } from "./progress.ts";

const NOW = "2026-10-22T10:00:00Z";
const id = fixtureAnalysisView.analysis.id;
const PR_URL = "https://github.com/acme/shop/pull/128";

const request = (method: string, path: string, body?: unknown, token = MOCK_TOKEN): MockRequest => {
  const url = new URL(path, "http://mock");
  return {
    method,
    path: url.pathname,
    query: url.searchParams,
    headers: { [TOKEN_HEADER]: token },
    body,
  };
};

const errorCode = (response: { body: unknown }) => ErrorResponse.parse(response.body).error.code;

let api: MockApi;

beforeEach(() => {
  vi.useFakeTimers();
  api = createMockApi({ now: () => NOW });
});

afterEach(() => {
  api.close();
  vi.useRealTimers();
});

describe("mock API", () => {
  it("rejects requests without the token, like the server", () => {
    const response = api.handle(request("GET", "/api/status", undefined, "wrong"));
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe("unauthorized");
  });

  it("answers status and pull requests with the contract's shapes", () => {
    const status = api.handle(request("GET", "/api/status"));
    expect(routes.getStatus.response.safeParse(status.body).success).toBe(true);
    const list = api.handle(request("GET", "/api/pull-requests"));
    expect(routes.listPullRequests.response.safeParse(list.body).success).toBe(true);
  });

  it("serves a complete analysis before any is started", () => {
    const response = api.handle(request("GET", `/api/analyses/${id}`));
    expect(AnalysisView.parse(response.body).analysis.status).toBe("complete");
  });

  it("answers not-found for unknown analyses and routes", () => {
    expect(errorCode(api.handle(request("GET", "/api/analyses/a_0000000000000000")))).toBe(
      "not-found",
    );
    expect(errorCode(api.handle(request("GET", "/api/nothing")))).toBe("not-found");
  });

  it("validates the URL and the host when starting an analysis", () => {
    const start = (body: unknown) => errorCode(api.handle(request("POST", "/api/analyses", body)));
    expect(start({})).toBe("bad-request");
    expect(start({ url: "https://gitlab.com/a/b/-/merge_requests/1" })).toBe("unsupported-url");
    expect(start({ url: "https://bitbucket.org/acme-team/billing/pull-requests/57" })).toBe(
      "host-not-configured",
    );
  });

  it("simulates an analysis stage by stage, with events, until done", () => {
    const started = api.handle(request("POST", "/api/analyses", { url: PR_URL }));
    expect(AnalysisIdResponse.parse(started.body).analysisId).toBe(id);

    const events: MockEvent[] = [];
    const subscription = api.events(request("GET", `/api/analyses/${id}/events`), (event) =>
      events.push(event),
    );
    expect("unsubscribe" in subscription).toBe(true);
    const view = () => AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body);
    expect(view().analysis.stages.collect).toBe("running");
    expect(view().analysis.pullRequest).toBeNull();

    vi.advanceTimersByTime(MOCK_STAGE_MS);
    expect(events).toEqual([
      { event: "updated", data: { stage: "collect", status: "done" } },
      { event: "updated", data: { stage: "prep", status: "running" } },
    ]);
    expect(view().analysis.pullRequest).not.toBeNull();

    vi.advanceTimersByTime(MOCK_STAGE_MS * 6);
    expect(events.at(-1)).toEqual({ event: "done", data: {} });
    expect(view().analysis).toEqual(fixtureAnalysisView.analysis);
  });

  it("sends done straight away for an analysis that isn't running", () => {
    const events: MockEvent[] = [];
    api.events(
      request("GET", `/api/analyses/${id}/events?token=${MOCK_TOKEN}`, undefined, ""),
      (event) => events.push(event),
    );
    expect(events).toEqual([{ event: "done", data: {} }]);
  });

  it("refuses the event stream without the token or for an unknown analysis", () => {
    const unknown = api.events(request("GET", "/api/analyses/a_0000000000000000/events"), () => {});
    expect("status" in unknown && unknown.status).toBe(404);
    const anonymous = api.events(
      request("GET", `/api/analyses/${id}/events`, undefined, ""),
      () => {},
    );
    expect("status" in anonymous && anonymous.status).toBe(401);
  });

  it("records a point's state on a complete analysis", () => {
    const put = (pointId: string, body: unknown) =>
      api.handle(request("PUT", `/api/analyses/${id}/points/${pointId}`, body));
    const saved = put("f1", { state: "raised" });
    expect(PointReview.parse(saved.body)).toEqual({
      pointId: "f1",
      state: "raised",
      updatedAt: NOW,
    });
    expect(
      AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body).pointReviews,
    ).toHaveLength(1);
    expect(errorCode(put("d9", { state: "raised" }))).toBe("not-found");
    expect(errorCode(put("d1", { state: "maybe" }))).toBe("bad-request");
  });

  it("refuses a point's state and publishing while the analysis runs", () => {
    api.handle(request("POST", "/api/analyses", { url: PR_URL }));
    const put = api.handle(request("PUT", `/api/analyses/${id}/points/d1`, { state: "raised" }));
    expect(errorCode(put)).toBe("analysis-not-complete");
    const publish = api.handle(
      request("POST", `/api/analyses/${id}/publication`, { summary: "", allowStale: false }),
    );
    expect(errorCode(publish)).toBe("analysis-not-complete");
  });

  it("previews and publishes what buildPublication makes, once", () => {
    const comment = {
      hunkId: fixtureHunks.receiptRoute,
      side: "new",
      line: 14,
      body: "Whose order is this?",
    };
    const preview = Publication.parse(
      api.handle(
        request("POST", `/api/analyses/${id}/publication/preview`, {
          summary: "Hi",
          hunkComments: [comment],
          verdict: "request_changes",
        }),
      ).body,
    );
    expect(preview.verdict).toBe("request_changes");
    expect(preview.comments.map((one) => one.key)).toEqual([
      `hunk:${fixtureHunks.receiptRoute}:new:14`,
    ]);

    const publish = () =>
      PublicationReceipt.parse(
        api.handle(
          request("POST", `/api/analyses/${id}/publication`, {
            summary: "Hi",
            allowStale: false,
            hunkComments: [comment],
            verdict: "request_changes",
          }),
        ).body,
      );
    const receipt = publish();
    expect(Object.keys(receipt.postedCommentIds)).toEqual([
      "summary",
      `hunk:${fixtureHunks.receiptRoute}:new:14`,
    ]);
    expect(publish()).toEqual(receipt);
    const view = AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body);
    expect(view.publication).toEqual(receipt);
  });

  it("can't retry an analysis that didn't fail", () => {
    expect(errorCode(api.handle(request("POST", `/api/analyses/${id}/retry`)))).toBe("bad-request");
  });

  it("analyzes a PR with 240 hunks for its own number", () => {
    const url = `https://github.com/acme/shop/pull/${MOCK_LARGE_PR_NUMBER}`;
    const started = api.handle(request("POST", "/api/analyses", { url }));
    const { analysisId } = AnalysisIdResponse.parse(started.body);
    expect(analysisId).toBe(largeAnalysisView.analysis.id);
    vi.advanceTimersByTime(MOCK_STAGE_MS * 6);
    const view = AnalysisView.parse(api.handle(request("GET", `/api/analyses/${analysisId}`)).body);
    expect(view.analysis.files.flatMap((file) => file.hunks)).toHaveLength(240);
    expect(errorCode(api.handle(request("GET", `/api/analyses/${id}`)))).toBe("not-found");
  });

  it("fails the analysis of the failing PR at the prep stage, and retries it", () => {
    const url = `https://github.com/acme/shop/pull/${MOCK_FAILING_PR_NUMBER}`;
    api.handle(request("POST", "/api/analyses", { url }));
    const events: MockEvent[] = [];
    api.events(request("GET", `/api/analyses/${id}/events`), (event) => events.push(event));
    const view = () => AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body);

    vi.advanceTimersByTime(MOCK_STAGE_MS * 2);
    expect(events.slice(-2)).toEqual([
      { event: "updated", data: { stage: "prep", status: "failed" } },
      { event: "done", data: {} },
    ]);
    expect(view().analysis.status).toBe("failed");
    expect(view().analysis.error?.stage).toBe("prep");

    const retried = api.handle(request("POST", `/api/analyses/${id}/retry`));
    expect(AnalysisIdResponse.parse(retried.body).analysisId).toBe(id);
    expect(view().analysis.status).toBe("running");
    vi.advanceTimersByTime(MOCK_STAGE_MS * 7);
    expect(view().analysis).toEqual(fixtureAnalysisView.analysis);
  });
});

describe("analysisInProgress", () => {
  const analysis = fixtureAnalysisView.analysis;

  it("shows each result once its stage is done", () => {
    expect(analysisInProgress(analysis, 1).status).toBe("running");
    // The code's stages are done: the analysis is complete, and the model runs on it.
    const afterPrep = analysisInProgress(analysis, 2);
    expect(afterPrep.status).toBe("complete");
    expect(afterPrep.stages).toMatchObject({ prep: "done", intent: "running", risk: "pending" });
    expect(afterPrep.files).toEqual(analysis.files);
    expect(afterPrep.intent).toBeNull();
    expect(afterPrep.risk.every((assessment) => assessment.source === "proof")).toBe(true);
    expect(afterPrep.usage).toEqual([]);
    expect(AnalysisView.safeParse({ ...fixtureAnalysisView, analysis: afterPrep }).success).toBe(
      true,
    );
  });

  it("keeps earlier stages' results when a model stage fails, leaving the analysis complete", () => {
    const failed = analysisFailed(analysis, "risk", "Bad output");
    expect(failed.status).toBe("complete");
    expect(failed.stages).toMatchObject({ intent: "done", risk: "failed", decisions: "skipped" });
    expect(failed.intent).toEqual(analysis.intent);
    expect(failed.decisions).toEqual([]);
    expect(failed.error).toBeNull();
    expect(failed.modelError).toEqual({
      stage: "risk",
      code: "model-error",
      message: "Bad output",
    });
    expect(AnalysisView.safeParse({ ...fixtureAnalysisView, analysis: failed }).success).toBe(true);
  });

  it("is the analysis itself once every stage is done", () => {
    expect(analysisInProgress(analysis, 7)).toBe(analysis);
  });
});

describe("a scenario", () => {
  const run = (
    scenario: Parameters<typeof createMockApi>[0] extends infer O
      ? O extends { scenario?: infer S }
        ? NonNullable<S>
        : never
      : never,
  ) => {
    const api = createMockApi({ now: () => NOW, scenario });
    const view = () => AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body);
    api.handle(request("POST", `/api/analyses/${id}/model`));
    // Every model stage, and the one that ends the run.
    vi.advanceTimersByTime(MOCK_STAGE_MS * 10);
    const analysis = view().analysis;
    api.close();
    return analysis;
  };

  it("starts before Claude ran, with the code's review alone", () => {
    const api = createMockApi({ now: () => NOW, scenario: "ready" });
    const analysis = AnalysisView.parse(
      api.handle(request("GET", `/api/analyses/${id}`)).body,
    ).analysis;
    expect(analysis.status).toBe("complete");
    expect(analysis.stages.findings).toBe("skipped");
    expect(pointsOf(analysis)).toEqual([]);
    api.close();
  });

  it("analyzes a PR opened afresh without running Claude, as the server does", () => {
    const api = createMockApi({ now: () => NOW, scenario: "ready" });
    const view = () => AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body);
    api.handle(request("POST", "/api/analyses", { url: PR_URL }));
    // Each step of the code's analysis: Claude's stages never run on their own.
    for (let step = 0; step < 7; step += 1) {
      const { status, stages } = view().analysis;
      expect(status !== "complete" || !inProgress({ status, stages })).toBe(true);
      vi.advanceTimersByTime(MOCK_STAGE_MS);
    }
    expect(view().analysis.status).toBe("complete");
    expect(view().analysis.stages.intent).toBe("skipped");
    api.close();
  });

  it("plays Claude's run to each scenario's end", () => {
    expect(pointsOf(run("ready")).length).toBeGreaterThan(0);
    expect(pointsOf(run("nothing-found"))).toEqual([]);
    expect(pointsOf(run("many")).length).toBeGreaterThan(40);

    const limited = run("limit-after-findings");
    expect(limited.stages.risk).toBe("failed");
    expect(limited.modelError?.message).toContain("resets at");
    expect(pointsOf(limited).every((point) => point.kind === "finding")).toBe(true);

    const refused = run("refusal");
    expect(refused.findings).toEqual([]);
    expect(refused.modelError?.message).toContain("declined");

    const signedOut = run("not-signed-in");
    expect(signedOut.stages.intent).toBe("failed");
    expect(pointsOf(signedOut)).toEqual([]);
  });

  it("gives each of many points its own ID", () => {
    const ids = pointsOf(run("many")).map((point) => point.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records a point's state once Claude's run has landed it", () => {
    const api = createMockApi({ now: () => NOW, scenario: "ready" });
    api.handle(request("POST", `/api/analyses/${id}/model`));
    vi.advanceTimersByTime(MOCK_STAGE_MS * 10);
    const saved = api.handle(request("PUT", `/api/analyses/${id}/points/f1`, { state: "raised" }));
    expect(PointReview.parse(saved.body).state).toBe("raised");
    api.close();
  });

  it("plays Claude's run again on Try again", () => {
    const api = createMockApi({ now: () => NOW, scenario: "limit-after-findings" });
    const view = () => AnalysisView.parse(api.handle(request("GET", `/api/analyses/${id}`)).body);
    api.handle(request("POST", `/api/analyses/${id}/model`));
    vi.advanceTimersByTime(MOCK_STAGE_MS * 10);
    expect(view().analysis.stages.risk).toBe("failed");

    api.handle(request("POST", `/api/analyses/${id}/model`));
    expect(view().analysis.stages.intent).toBe("running");
    vi.advanceTimersByTime(MOCK_STAGE_MS * 10);
    expect(view().analysis.stages.risk).toBe("failed");
    api.close();
  });
});
