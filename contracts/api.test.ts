import { describe, expect, it } from "vitest";
import {
  smallFeatureAnalysis,
  smallFeaturePublication,
  smallFeatureThreadList,
} from "../src/application/testing/index.ts";
import { CommentKey, PointId } from "../src/domain/review/index.ts";
import {
  AnalysisDoneEvent,
  AnalysisUpdatedEvent,
  ERROR_STATUS,
  ErrorCode,
  ErrorResponse,
  type RouteName,
  routePath,
  routes,
} from "./index.ts";

const pointReview = {
  pointId: PointId.parse("r:h_0123456789abcdef"),
  state: "raised",
  updatedAt: "2026-10-21T09:05:00Z",
} as const;

const receipt = {
  url: "https://github.com/acme/shop/pull/101#pullrequestreview-1",
  publishedAt: "2026-10-21T09:10:00Z",
  postedCommentIds: { [CommentKey.parse("summary")]: "1", [CommentKey.parse("decision:d3")]: "2" },
};

const responses: Record<RouteName, unknown> = {
  getStatus: {
    version: "0.1.0",
    hosts: {
      github: { configured: true, user: { id: "lee-park", name: "Lee Park" }, error: null },
      bitbucket: { configured: false, user: null, error: null },
    },
    jira: { configured: false },
    model: { available: true, via: "Claude Code, on your Pro plan", reason: null },
  },
  listPullRequests: {
    items: [
      {
        ref: smallFeatureAnalysis.key.ref,
        url: "https://github.com/acme/shop/pull/101",
        title: "Add receipt download endpoint",
        author: { id: "dana-kim", name: "Dana Kim" },
        updatedAt: "2026-10-20T16:45:30Z",
        role: "reviewer",
      },
    ],
    errors: [{ host: "bitbucket", message: "Bitbucket returned 401" }],
  },
  startAnalysis: { analysisId: smallFeatureAnalysis.id },
  getAnalysis: {
    analysis: smallFeatureAnalysis,
    pointReviews: [pointReview],
    publication: receipt,
    isAuthor: false,
    stale: false,
  },
  getFileContent: { content: "export const total = 1;\n" },
  retryAnalysis: { analysisId: smallFeatureAnalysis.id },
  runModel: { analysisId: smallFeatureAnalysis.id },
  putPointState: pointReview,
  previewPublication: smallFeaturePublication,
  publish: receipt,
  getThreads: smallFeatureThreadList,
  replyToThread: smallFeatureThreadList.threads[0]?.comments[1],
  resolveThread: { resolved: true },
  postComment: {},
};

const requests: Partial<Record<RouteName, unknown>> = {
  startAnalysis: { url: "https://github.com/acme/shop/pull/101" },
  putPointState: { state: "dismissed" },
  previewPublication: { summary: "Looks good." },
  publish: { summary: "Looks good.", allowStale: false },
  replyToThread: { body: "Capped it." },
  resolveThread: { resolved: false },
  postComment: {
    hunkId: "h_0123456789abcdef",
    side: "new",
    line: 41,
    body: "Name it for what it counts.",
  },
};

const routeNames = Object.keys(routes).filter((name): name is RouteName => name in routes);

describe("routes", () => {
  it.each(routeNames)("%s accepts a realistic response", (name) => {
    expect(routes[name].response.safeParse(responses[name]).error).toBeUndefined();
  });

  it.each(routeNames)("%s accepts a realistic request", (name) => {
    const { request } = routes[name];
    if (request === null) {
      expect(requests[name]).toBeUndefined();
    } else {
      expect(request.safeParse(requests[name]).error).toBeUndefined();
    }
  });

  it("parses path params into domain IDs and rejects bad ones", () => {
    expect(
      routes.putPointState.params.safeParse({ id: smallFeatureAnalysis.id, pointId: "m2" }).success,
    ).toBe(true);
    expect(routes.getAnalysis.params.safeParse({ id: "../etc" }).success).toBe(false);
    expect(
      routes.putPointState.params.safeParse({ id: smallFeatureAnalysis.id, pointId: "h_1" })
        .success,
    ).toBe(false);
  });

  it("have unique method and path pairs, all under /api/", () => {
    const keys = Object.values(routes).map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const route of Object.values(routes)) expect(route.path).toMatch(/^\/api\//);
  });
});

describe("events", () => {
  it("accept realistic payloads", () => {
    expect(AnalysisUpdatedEvent.parse({ stage: "risk", status: "running" })).toEqual({
      stage: "risk",
      status: "running",
    });
    expect(AnalysisDoneEvent.parse({})).toEqual({});
  });
});

describe("errors", () => {
  it("have an HTTP status for every code", () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ErrorCode.options].sort());
  });

  it("parse the error body", () => {
    const body = { error: { code: "stale-analysis", message: "The PR has new commits" } };
    expect(ErrorResponse.parse(body)).toEqual(body);
    expect(ErrorResponse.safeParse({ error: { code: "teapot", message: "" } }).success).toBe(false);
  });
});

describe("routePath", () => {
  it("fills and encodes params", () => {
    expect(routePath(routes.putPointState.path, { id: "a_1", pointId: "r:h_1" })).toBe(
      "/api/analyses/a_1/points/r%3Ah_1",
    );
    expect(routePath(routes.getStatus.path, {})).toBe("/api/status");
  });

  it("throws on a missing param", () => {
    expect(() => routePath(routes.getAnalysis.path, {})).toThrow("missing path param id");
  });
});
