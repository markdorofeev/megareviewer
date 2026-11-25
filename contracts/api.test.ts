import { describe, expect, it } from "vitest";
import {
  smallFeatureAnalysis,
  smallFeaturePublication,
  smallFeatureStatus,
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

const repo = { host: "github", owner: "acme", repo: "shop" } as const;
const preference = {
  id: "pref_0123456789abcdef",
  kind: "look-for",
  text: "Tenant isolation: every query filters by tenant ID",
  scope: { kind: "global" },
  source: "written",
  enabled: true,
  createdAt: "2026-11-10T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
} as const;
const proposal = {
  id: "prop_0123456789abcdef",
  kind: "dont-flag",
  text: "Missing JSDoc on internal helpers",
  scope: { kind: "repo", repo },
  source: "learned",
  evidence: ["Dismissed: Missing JSDoc on `parseConfig`, acme/shop #12"],
  status: "pending",
  createdAt: "2026-11-10T10:05:00Z",
} as const;

const claudeMd = {
  path: "CLAUDE.md",
  bytes: 98_000,
  enabled: true,
  tooLarge: true,
  use: "on-request",
  linked: [
    {
      path: "docs/rules.md",
      bytes: 6_000,
      linkedFrom: "CLAUDE.md",
      via: "import",
      enabled: true,
      use: "prompt",
    },
    {
      path: "docs/testing.md",
      bytes: 900,
      linkedFrom: "docs/rules.md",
      via: "mention",
      enabled: false,
      use: null,
    },
  ],
};

const responses: Record<RouteName, unknown> = {
  getStatus: {
    version: "0.1.0",
    hosts: {
      github: { configured: true, user: { id: "lee-park", name: "Lee Park" }, error: null },
      bitbucket: { configured: false, user: null, error: null },
    },
    jira: { configured: false },
    model: {
      options: [
        {
          id: "claude-code/claude-sonnet-5-5",
          provider: "claude-code",
          providerName: "Claude Code",
          model: "claude-sonnet-5-5",
          modelName: "Sonnet 5.5",
          family: "Claude",
          via: "Claude Code, on your Pro plan",
          measured: true,
          available: true,
          reason: null,
        },
        {
          id: "anthropic-api/claude-sonnet-5-5",
          provider: "anthropic-api",
          providerName: "Anthropic API",
          model: "claude-sonnet-5-5",
          modelName: "Sonnet 5.5",
          family: "Claude",
          via: "Anthropic API",
          measured: true,
          available: false,
          reason: "No Anthropic API credentials: set ANTHROPIC_API_KEY or run `ant auth login`",
        },
      ],
      defaultId: "claude-code/claude-sonnet-5-5",
    },
    cloneSearchFolder: "/home/lee",
  },
  getReviewActivity: {
    reviews: [
      {
        at: "2026-10-21T09:10:00Z",
        pullRequest: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 101 },
      },
    ],
    comments: ["2026-10-21T09:10:00Z"],
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
    currentUserId: "lee",
    stale: false,
  },
  getFileContent: { content: "export const total = 1;\n" },
  retryAnalysis: { analysisId: smallFeatureAnalysis.id },
  runModel: { analysisId: smallFeatureAnalysis.id },
  removeModelRun: { analysis: smallFeatureAnalysis, pointReviews: [] },
  putPointState: pointReview,
  previewPublication: smallFeaturePublication,
  publish: receipt,
  revokeApproval: {},
  getThreads: smallFeatureThreadList,
  getPullRequestStatus: smallFeatureStatus,
  replyToThread: smallFeatureThreadList.threads[0]?.comments[1],
  resolveThread: { resolved: true },
  postComment: {},
  getPreferences: {
    preferences: [preference],
    proposals: [proposal],
    repositories: [
      {
        repo,
        guidelineFiles: [
          {
            path: "REVIEW.md",
            bytes: 1200,
            enabled: true,
            tooLarge: false,
            use: "prompt",
            linked: [],
          },
          claudeMd,
        ],
        guidelineNote: null,
        harnessCut: "files",
        harnessSkipped: [{ path: "docs/changelog.md", reason: "too-large" }],
        harnessNote: null,
      },
      {
        repo: { ...repo, repo: "api" },
        guidelineFiles: null,
        guidelineNote: "No pull request of this repository has been analyzed yet",
        harnessCut: null,
        harnessSkipped: [],
        harnessNote: null,
      },
    ],
  },
  addPreference: preference,
  updatePreference: { ...preference, enabled: false },
  deletePreference: {},
  suggestPreferences: { proposals: [proposal], signals: 14, comments: 92, pullRequests: 30 },
  decideProposal: { preference: { ...preference, source: "learned" } },
  setGuidelineSwitch: {
    repo,
    guidelineFiles: [claudeMd],
    guidelineNote: null,
    harnessCut: null,
    harnessSkipped: [],
    harnessNote: "Couldn't load the files they link: GitHub is down",
  },
  getHarness: { status: "ready", inPrompt: ["CLAUDE.md", "docs/rules.md"], onRequest: 66 },
};

const requests: Partial<Record<RouteName, unknown>> = {
  startAnalysis: { url: "https://github.com/acme/shop/pull/101" },
  putPointState: { state: "dismissed" },
  previewPublication: { summary: "Looks good." },
  publish: {
    publicationId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    summary: "Looks good.",
    allowStale: false,
  },
  replyToThread: { body: "Capped it." },
  resolveThread: { resolved: false },
  postComment: {
    hunkId: "h_0123456789abcdef",
    side: "new",
    line: 41,
    body: "Name it for what it counts.",
  },
  addPreference: { kind: "dont-flag", text: "Naming", scope: { kind: "repo", repo } },
  updatePreference: { enabled: false },
  suggestPreferences: { repo },
  decideProposal: { decision: "accept", text: "Missing JSDoc on helpers" },
  setGuidelineSwitch: { repo, path: "CLAUDE.md", enabled: true },
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

  it("takes a suggestion's repository, with or without a model option", () => {
    const { request } = routes.suggestPreferences;
    expect(request.safeParse({ repo }).success).toBe(true);
    expect(request.safeParse({ repo, optionId: "claude-code/claude-haiku-5-5" }).success).toBe(
      true,
    );
    expect(request.safeParse(undefined).success).toBe(false);
  });

  it("takes a preference's text trimmed, between 1 and 300 characters", () => {
    const request = { kind: "look-for", scope: { kind: "global" } };
    const parsed = routes.addPreference.request.safeParse({ ...request, text: "  Naming " });
    expect(parsed.success && parsed.data.text).toBe("Naming");
    for (const text of ["   ", "x".repeat(301)]) {
      expect(routes.addPreference.request.safeParse({ ...request, text }).success).toBe(false);
      expect(routes.updatePreference.request.safeParse({ text }).success).toBe(false);
      expect(routes.decideProposal.request.safeParse({ decision: "accept", text }).success).toBe(
        false,
      );
    }
  });

  it("takes any path for a guideline switch, and refuses an empty one and a file used some other way", () => {
    const { request, response } = routes.setGuidelineSwitch;
    const body = { repo, path: "docs/STYLE.md", enabled: true };
    expect(request.safeParse(body).success).toBe(true);
    expect(request.safeParse({ ...body, path: "" }).success).toBe(false);
    const section = (file: object) => ({
      repo,
      guidelineFiles: [file],
      guidelineNote: null,
      harnessCut: null,
      harnessSkipped: [],
      harnessNote: null,
    });
    expect(response.safeParse(section(claudeMd)).success).toBe(true);
    expect(response.safeParse(section({ ...claudeMd, use: "sometimes" })).success).toBe(false);
    expect(response.safeParse(section({ ...claudeMd, path: "docs/STYLE.md" })).success).toBe(false);
  });

  it("says where a harness's load stands in one of four words", () => {
    const { response } = routes.getHarness;
    for (const status of ["loading", "ready", "none", "failed"]) {
      expect(response.safeParse({ status, inPrompt: [], onRequest: 0 }).success).toBe(true);
    }
    expect(response.safeParse({ status: "stale", inPrompt: [], onRequest: 0 }).success).toBe(false);
  });

  it("refuses a preference saved as imported", () => {
    expect(
      routes.addPreference.request.safeParse({
        kind: "look-for",
        text: "Naming",
        scope: { kind: "global" },
        source: "imported",
      }).success,
    ).toBe(false);
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
