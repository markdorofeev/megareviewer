import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  ERROR_STATUS,
  ErrorResponse,
  type RouteName,
  routePath,
  routes,
  TOKEN_HEADER,
} from "../../../contracts/index.ts";
import {
  type AnalysisEvent,
  type AnalysisEvents,
  createAnalysisEvents,
} from "../../application/events/index.ts";
import type { AnalysisInput, AnalysisStore, PassOptions } from "../../application/ports/index.ts";
import {
  allFixtures,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakePullRequestStatusSource,
  FakeReviewThreads,
  FakeTicketSource,
  FixedClock,
  fakeModelOption,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  RecordingLogger,
  smallFeature,
  smallFeatureAnalysis,
  smallFeatureStatus,
  smallFeatureThreadList,
} from "../../application/testing/index.ts";
import { createUseCases } from "../../application/use-cases/index.ts";
import { type Analysis, AnalysisId } from "../../domain/review/index.ts";
import { createHttpApp } from "./index.ts";

const TOKEN = "session-token-0123456789abcdef";
const ATTACHMENT = "https://github.com/user-attachments/assets/771a3d24";
const HOST = "127.0.0.1:4823";
const ALLOWED_HOSTS = [HOST, "localhost:4823"];

const setupApp = (
  options: {
    model?: FakeAnalysisModel;
    store?: AnalysisStore;
    events?: AnalysisEvents;
    onlyGithub?: boolean;
    staticDir?: string;
  } = {},
) => {
  const clock = new FixedClock("2026-10-21T10:00:00Z");
  const github = new FakeGitHost({ host: "github", fixtures: allFixtures, clock });
  const bitbucket = new FakeGitHost({ host: "bitbucket", fixtures: allFixtures, clock });
  const threads = new FakeReviewThreads({ host: "github", clock });
  threads.setThreads(smallFeature.pullRequest.ref, smallFeatureThreadList);
  threads.setAttachment(ATTACHMENT, { contentType: "image/png", bytes: new Uint8Array([137, 80]) });
  const statuses = new FakePullRequestStatusSource({ host: "github" });
  statuses.setStatus(smallFeature.pullRequest.ref, smallFeatureStatus);
  const store = options.store ?? new InMemoryAnalysisStore();
  const events = options.events ?? createAnalysisEvents();
  const logger = new RecordingLogger();
  const useCases = createUseCases(
    {
      hosts: options.onlyGithub ? { github } : { github, bitbucket },
      tickets: new FakeTicketSource({ tickets: allFixtures.flatMap((fixture) => fixture.tickets) }),
      models: new FakeModelCatalog({ model: options.model ?? new FakeAnalysisModel() }),
      store,
      fileCache: new InMemoryFileCache(),
      checkouts: new FakeLocalCheckouts(),
      threads: { github: threads },
      statuses: { github: statuses },
      parser: new FakeCodeParser(),
      events,
      clock,
      logger,
    },
    { version: "1.2.3" },
  );
  const app = createHttpApp({
    useCases,
    events,
    sessionToken: TOKEN,
    allowedHosts: ALLOWED_HOSTS,
    staticDir: options.staticDir ?? null,
    logger,
  });

  /** Resolves once the analysis's code stages have ended. */
  const complete = (analysisId: AnalysisId) =>
    new Promise<void>((resolve, reject) => {
      const off = events.subscribe(analysisId, (event) => {
        if (event.type === "done") {
          off();
          resolve();
        }
      });
      // Done before subscribing, too.
      store.getAnalysis(analysisId).then((analysis) => {
        if (analysis !== null && analysis.status !== "running") {
          off();
          resolve();
        }
      }, reject);
    });

  /** A request from the UI's own tab: allowed host and the session token. */
  const request = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { host: HOST, [TOKEN_HEADER]: TOKEN, ...init.headers },
    });

  /**
   * Calls a contract route and checks the response against the contract: the route's response
   * schema on success, and the error body with its code's status otherwise.
   */
  const call = async <N extends RouteName>(
    name: N,
    input: { params?: Record<string, string>; body?: unknown; rawBody?: string } = {},
  ) => {
    const route = routes[name];
    const response = await request(routePath(route.path, input.params ?? {}), {
      method: route.method,
      ...(input.rawBody !== undefined || input.body !== undefined
        ? {
            body: input.rawBody ?? JSON.stringify(input.body),
            headers: { "content-type": "application/json" },
          }
        : {}),
    });
    const json: unknown = await response.json();
    if (response.ok) {
      expect(response.status).toBe(200);
      // Parsing: the schema of route N gives route N's response type.
      const body = route.response.parse(json) as z.output<(typeof routes)[N]["response"]>;
      return { status: response.status, body, error: null };
    }
    const { error } = ErrorResponse.parse(json);
    expect(response.status).toBe(ERROR_STATUS[error.code]);
    return { status: response.status, body: null, error };
  };

  return {
    app,
    clock,
    github,
    bitbucket,
    threads,
    store,
    events,
    logger,
    useCases,
    request,
    call,
    complete,
  };
};

const { id } = smallFeatureAnalysis;
const { ref, url } = smallFeature.pullRequest;
const bitbucketUrl = "https://bitbucket.org/acme/payments/pull-requests/42";
const missingId = "a_0000000000000000";
const network = { kind: "network", message: "socket hang up", retryAfterSeconds: null } as const;
const eventsPath = (analysisId: string = id) => `/api/analyses/${analysisId}/events`;

const running: Analysis = { ...smallFeatureAnalysis, status: "running" };
const failed: Analysis = {
  ...smallFeatureAnalysis,
  status: "failed",
  error: { stage: "intent", code: "model-error", message: "refused" },
};

const seeded = async (
  analysis: Analysis = smallFeatureAnalysis,
  options: Parameters<typeof setupApp>[0] = {},
) => {
  const setup = setupApp(options);
  await setup.store.saveAnalysis(analysis);
  return setup;
};

const INDEX = "<!doctype html><title>megareviewer</title>";
const SCRIPT = "console.log('ui');";

/** Holds a built UI; its parent holds a file a traversal would reach. */
let root: string;
let staticDir: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "megareviewer-static-"));
  staticDir = join(root, "ui");
  await mkdir(join(staticDir, "assets"), { recursive: true });
  await writeFile(join(staticDir, "index.html"), INDEX);
  await writeFile(join(staticDir, "assets", "index-abc123.js"), SCRIPT);
  await writeFile(join(staticDir, "favicon.svg"), "<svg/>");
  await writeFile(join(root, "secret.txt"), "secret");
});

afterEach(() => {
  vi.useRealTimers();
});

const getUi = (path: string, init: RequestInit = {}) => {
  const { app } = setupApp({ staticDir });
  return app.request(path, { ...init, headers: { host: HOST } });
};

const expectSecurityHeaders = (response: Response) => {
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; " +
      "base-uri 'none'; form-action 'none'",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
};

/** Holds the intent pass until released, so the analysis stays running. */
class GatedModel extends FakeAnalysisModel {
  readonly entered: Promise<void>;
  private enter = () => {};
  private gate = Promise.withResolvers<void>();

  constructor() {
    super();
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
  }

  release(): void {
    this.gate.resolve();
  }

  override async intent(input: AnalysisInput, options?: PassOptions) {
    this.enter();
    await this.gate.promise;
    return super.intent(input, options);
  }
}

/** Counts live subscriptions, to see that a closed stream unsubscribes. */
const countingEvents = () => {
  const inner = createAnalysisEvents();
  let active = 0;
  const events: AnalysisEvents = {
    emit: inner.emit,
    subscribe(analysisId, listener) {
      active += 1;
      const unsubscribe = inner.subscribe(analysisId, listener);
      return () => {
        active -= 1;
        unsubscribe();
      };
    },
  };
  return { events, active: () => active };
};

interface SseMessage {
  readonly event: string | null;
  readonly data: string | null;
  readonly comment: string | null;
}

const parseSse = (text: string): SseMessage[] =>
  text
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block) => {
      const lines = block.split("\n");
      const field = (name: string) =>
        lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2) ?? null;
      return { event: field("event"), data: field("data"), comment: field("") };
    });

const readChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
};

describe("GET /api/status", () => {
  it("reports hosts, Jira, the model and the version", async () => {
    const { call } = setupApp({ onlyGithub: true });
    const { body } = await call("getStatus");
    expect(body).toMatchObject({
      version: "1.2.3",
      hosts: { github: { configured: true, error: null }, bitbucket: { configured: false } },
      jira: { configured: true },
      model: { options: [fakeModelOption()], defaultId: fakeModelOption().id },
    });
  });
});

describe("GET /api/pull-requests", () => {
  it("lists every host's PRs and the hosts that failed", async () => {
    const { call, bitbucket } = setupApp();
    bitbucket.failNext("listPullRequests", network);
    const { body } = await call("listPullRequests");
    expect(body?.items.length).toBeGreaterThan(0);
    expect(body?.items.every((item) => item.ref.repo.host === "github")).toBe(true);
    expect(body?.errors).toEqual([{ host: "bitbucket", message: "socket hang up" }]);
  });
});

describe("POST /api/analyses", () => {
  it("starts an analysis that runs to completion", async () => {
    const { call } = setupApp();
    const { body } = await call("startAnalysis", { body: { url } });
    const analysisId = body?.analysisId ?? "";
    await vi.waitFor(async () => {
      const view = await call("getAnalysis", { params: { id: analysisId } });
      expect(view.body?.analysis.status).toBe("complete");
    });
  });

  it("rejects a body that isn't valid", async () => {
    const { call } = setupApp();
    expect((await call("startAnalysis", { body: {} })).error).toEqual({
      code: "bad-request",
      message: "body.url: Invalid input: expected string, received undefined",
    });
    expect((await call("startAnalysis", { rawBody: "{" })).error).toEqual({
      code: "bad-request",
      message: "The body isn't valid JSON",
    });
    expect((await call("startAnalysis")).error?.code).toBe("bad-request");
  });

  it("maps each use-case error to its status", async () => {
    const { call, github } = setupApp({ onlyGithub: true });
    const start = async (prUrl: string) =>
      (await call("startAnalysis", { body: { url: prUrl } })).error;

    expect((await start("https://gitlab.com/acme/shop/-/merge_requests/1"))?.code).toBe(
      "unsupported-url",
    );
    expect(await start(bitbucketUrl)).toEqual({
      code: "host-not-configured",
      message: "Bitbucket Cloud isn't configured",
    });
    expect((await start("https://github.com/acme/none/pull/1"))?.code).toBe("not-found");
    github.failNext("getPullRequest", network);
    expect(await start(url)).toEqual({ code: "host-error", message: "socket hang up" });
  });
});

describe("GET /api/analyses/:id", () => {
  it("returns the analysis view", async () => {
    const { call } = await seeded();
    const { body } = await call("getAnalysis", { params: { id } });
    expect(body).toEqual({
      analysis: smallFeatureAnalysis,
      pointReviews: [],
      publication: null,
      isAuthor: false,
      stale: false,
    });
  });

  it("rejects a malformed ID and reports an unknown one", async () => {
    const { call } = await seeded();
    expect((await call("getAnalysis", { params: { id: "nope" } })).error?.code).toBe("bad-request");
    expect((await call("getAnalysis", { params: { id: missingId } })).error).toEqual({
      code: "not-found",
      message: `No analysis ${missingId}`,
    });
  });
});

describe("GET /api/analyses/:id/files/:side/:path", () => {
  it("serves a changed file, its path one encoded segment", async () => {
    const { call, request } = await seeded();
    const params = { id, side: "head", path: "src/services/receipts.ts" };
    const { body } = await call("getFileContent", { params });
    expect(body).toEqual({ content: smallFeature.headFiles["src/services/receipts.ts"] });
    const unencoded = await request(`/api/analyses/${id}/files/head/src/services/receipts.ts`);
    expect(unencoded.status).toBe(404);
  });

  it("rejects an unknown side", async () => {
    const { call } = await seeded();
    const params = { id, side: "middle", path: "config/app.yaml" };
    expect((await call("getFileContent", { params })).error?.code).toBe("bad-request");
  });
});

describe("POST /api/analyses/:id/retry", () => {
  it("re-runs a failed analysis", async () => {
    const { call } = await seeded(failed);
    const { body } = await call("retryAnalysis", { params: { id } });
    expect(body).toEqual({ analysisId: id });
  });

  it("reports each error", async () => {
    const { call, github } = await seeded(failed);
    expect((await call("retryAnalysis", { params: { id: "nope" } })).error?.code).toBe(
      "bad-request",
    );
    expect((await call("retryAnalysis", { params: { id: missingId } })).error?.code).toBe(
      "not-found",
    );
    github.failNext("getPullRequest", network);
    expect((await call("retryAnalysis", { params: { id } })).error?.code).toBe("host-error");

    const complete = await seeded();
    expect((await complete.call("retryAnalysis", { params: { id } })).error).toEqual({
      code: "bad-request",
      message: "Only a failed analysis can be retried",
    });
  });
});

describe("PUT /api/analyses/:id/points/:pointId", () => {
  it("records the point's state", async () => {
    const { call } = await seeded();
    const { body } = await call("putPointState", {
      params: { id, pointId: "f1" },
      body: { state: "raised" },
    });
    expect(body).toEqual({
      pointId: "f1",
      state: "raised",
      updatedAt: "2026-10-21T10:00:00.000Z",
    });
    const view = await call("getAnalysis", { params: { id } });
    expect(view.body?.pointReviews).toEqual([body]);
  });

  it("takes a risk's point ID, with its colon, through the path", async () => {
    const { call } = await seeded();
    const risk = smallFeatureAnalysis.risk.find((one) => one.reason === "Adds a public endpoint.");
    const pointId = `r:${risk?.hunkId}`;
    const { body } = await call("putPointState", {
      params: { id, pointId },
      body: { state: "dismissed" },
    });
    expect(body?.pointId).toBe(pointId);
  });

  it("validates params and body", async () => {
    const { call } = await seeded();
    const put = async (pointId: string, body: unknown) =>
      (await call("putPointState", { params: { id, pointId }, body })).error?.code;
    expect(await put("x1", { state: "raised" })).toBe("bad-request");
    expect(await put("d1", { state: "approved" })).toBe("bad-request");
    expect(await put("d1", {})).toBe("bad-request");
  });

  it("needs a point of a complete analysis", async () => {
    const complete = await seeded();
    const state = { state: "raised" };
    expect(
      (await complete.call("putPointState", { params: { id, pointId: "d99" }, body: state })).error
        ?.code,
    ).toBe("not-found");
    const notComplete = await seeded(running);
    expect(
      (await notComplete.call("putPointState", { params: { id, pointId: "d1" }, body: state }))
        .error?.code,
    ).toBe("analysis-not-complete");
  });
});

describe("POST /api/analyses/:id/publication/preview", () => {
  it("returns what publishing would post", async () => {
    const { call } = await seeded();
    const { body } = await call("previewPublication", {
      params: { id },
      body: { summary: "Looks good" },
    });
    // Every decision is still pending, so the review only comments.
    expect(body?.verdict).toBe("comment");
    expect(body?.summary).toContain("Looks good");
  });

  it("reports each error", async () => {
    const { call } = await seeded(running);
    expect((await call("previewPublication", { params: { id }, body: {} })).error?.code).toBe(
      "bad-request",
    );
    expect(
      (await call("previewPublication", { params: { id }, body: { summary: "" } })).error?.code,
    ).toBe("analysis-not-complete");
    expect(
      (await call("previewPublication", { params: { id: missingId }, body: { summary: "" } })).error
        ?.code,
    ).toBe("not-found");
  });
});

describe("POST /api/analyses/:id/publication", () => {
  const publish = { summary: "Ship it", allowStale: false };

  it("publishes once and returns the receipt", async () => {
    const { call, github } = await seeded();
    const first = await call("publish", { params: { id }, body: publish });
    const second = await call("publish", { params: { id }, body: publish });
    expect(first.body?.url).toMatch(/^https:\/\//);
    expect(second.body).toEqual(first.body);
    expect(github.publishAttempts).toHaveLength(1);
  });

  it("refuses a stale analysis unless allowed", async () => {
    const { call, github } = await seeded();
    github.setHeadSha(ref, "2".repeat(40));
    expect((await call("publish", { params: { id }, body: publish })).error?.code).toBe(
      "stale-analysis",
    );
    const allowed = await call("publish", {
      params: { id },
      body: { ...publish, allowStale: true },
    });
    expect(allowed.error).toBeNull();
  });

  it("reports each other error", async () => {
    const { call, github } = await seeded();
    expect((await call("publish", { params: { id }, body: { summary: "" } })).error?.code).toBe(
      "bad-request",
    );
    github.failNext("getPullRequest", network);
    expect((await call("publish", { params: { id }, body: publish })).error?.code).toBe(
      "host-error",
    );
    const notComplete = await seeded(running);
    expect((await notComplete.call("publish", { params: { id }, body: publish })).error?.code).toBe(
      "analysis-not-complete",
    );
  });

  it("needs the PR's host", async () => {
    const { call, store } = setupApp({ onlyGithub: true });
    const onBitbucket: Analysis = {
      ...smallFeatureAnalysis,
      key: {
        ...smallFeatureAnalysis.key,
        ref: { ...ref, repo: { ...ref.repo, host: "bitbucket" } },
      },
    };
    await store.saveAnalysis(onBitbucket);
    expect((await call("publish", { params: { id }, body: publish })).error?.code).toBe(
      "host-not-configured",
    );
  });
});

describe("errors outside the use cases", () => {
  it("answers an unknown API route with not-found", async () => {
    const { request } = setupApp();
    const response = await request("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not-found", message: "No route GET /api/nope" },
    });
  });

  it("hides an unexpected exception behind a generic 500 and logs its stack", async () => {
    class BrokenStore extends InMemoryAnalysisStore {
      override async getAnalysis(): Promise<Analysis | null> {
        throw new Error("disk on fire");
      }
    }
    const { call, logger } = setupApp({ store: new BrokenStore() });
    expect((await call("getAnalysis", { params: { id } })).error).toEqual({
      code: "internal",
      message: "Something went wrong on the server",
    });
    const logged = logger.entries.find((entry) => entry.message === "request failed");
    expect(logged?.level).toBe("error");
    expect(String(logged?.fields?.error)).toContain("disk on fire");
  });
});

describe("the session token", () => {
  it("is required on every API route", async () => {
    const { app } = await seeded();
    const missing = await app.request("/api/status", { headers: { host: HOST } });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: { code: "unauthorized", message: "Missing or wrong session token" },
    });

    for (const token of ["wrong", `${TOKEN}x`, TOKEN.slice(1)]) {
      const wrong = await app.request("/api/status", {
        headers: { host: HOST, [TOKEN_HEADER]: token },
      });
      expect(wrong.status).toBe(401);
    }

    const right = await app.request("/api/status", {
      headers: { host: HOST, [TOKEN_HEADER]: TOKEN },
    });
    expect(right.status).toBe(200);
  });

  it("is checked before routing, so unknown API routes don't leak", async () => {
    const { app } = setupApp();
    const response = await app.request("/api/nope", { headers: { host: HOST } });
    expect(response.status).toBe(401);
  });

  it("may be a query parameter on the events route only", async () => {
    const { app } = await seeded();
    const events = await app.request(`${eventsPath()}?token=${TOKEN}`, { headers: { host: HOST } });
    expect(events.status).toBe(200);
    expect(await events.text()).toBe("event: done\ndata: {}\n\n");

    const wrongQuery = await app.request(`${eventsPath()}?token=wrong`, {
      headers: { host: HOST },
    });
    expect(wrongQuery.status).toBe(401);
    const otherRoute = await app.request(`/api/analyses/${id}?token=${TOKEN}`, {
      headers: { host: HOST },
    });
    expect(otherRoute.status).toBe(401);
    const otherMethod = await app.request(`${eventsPath()}?token=${TOKEN}`, {
      method: "POST",
      headers: { host: HOST },
    });
    expect(otherMethod.status).toBe(401);
  });

  it("isn't needed for the UI's files", async () => {
    const { app } = setupApp({ staticDir });
    const response = await app.request("/review/a_1", { headers: { host: HOST } });
    expect(response.status).toBe(200);
  });
});

describe("the host check", () => {
  it("answers the allowed hosts, in any case", async () => {
    const { app } = setupApp();
    for (const host of [HOST, "localhost:4823", "LOCALHOST:4823"]) {
      const response = await app.request("/api/status", {
        headers: { host, [TOKEN_HEADER]: TOKEN },
      });
      expect(response.status).toBe(200);
    }
  });

  it("refuses a foreign or missing host, even with the token", async () => {
    const { app } = setupApp();
    for (const host of ["evil.example:4823", "127.0.0.1:4824", "localhost"]) {
      const response = await app.request("/api/status", {
        headers: { host, [TOKEN_HEADER]: TOKEN },
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Forbidden host");
      expectSecurityHeaders(response);
    }
    const missing = await app.request("/api/status", { headers: { [TOKEN_HEADER]: TOKEN } });
    expect(missing.status).toBe(403);
  });
});

describe("security headers", () => {
  it("are on API responses, errors and static files", async () => {
    const { app, request } = await seeded(smallFeatureAnalysis, { staticDir });

    expectSecurityHeaders(await request("/api/status"));
    expectSecurityHeaders(await request("/api/analyses/nope"));
    expectSecurityHeaders(await request("/api/nope"));
    expectSecurityHeaders(await app.request("/api/status", { headers: { host: HOST } }));
    expectSecurityHeaders(await request(eventsPath()));
    expectSecurityHeaders(await app.request("/", { headers: { host: HOST } }));
  });
});

describe("the request log", () => {
  it("records method, path, status and duration, never the token", async () => {
    const { app, logger } = await seeded();
    await app.request(`${eventsPath()}?token=${TOKEN}`, { headers: { host: HOST } });
    await app.request("/api/status", { headers: { host: HOST, [TOKEN_HEADER]: TOKEN } });
    await app.request("/api/status", { headers: { host: HOST, [TOKEN_HEADER]: "wrong" } });

    const requests = logger.entries.filter((entry) => entry.message === "request");
    expect(requests.map((entry) => entry.fields)).toEqual([
      { method: "GET", path: eventsPath(), status: 200, durationMs: expect.any(Number) },
      { method: "GET", path: "/api/status", status: 200, durationMs: expect.any(Number) },
      { method: "GET", path: "/api/status", status: 401, durationMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(TOKEN);
  });
});

describe("the pull request status route", () => {
  it("reads where the PR stands from its host", async () => {
    const { call } = await seeded();
    const status = await call("getPullRequestStatus", { params: { id } });
    expect(status.status).toBe(200);
    expect(status.body).toEqual(smallFeatureStatus);
  });
});

describe("the thread routes", () => {
  it("read, reply and resolve", async () => {
    const { call } = await seeded();
    const list = await call("getThreads", { params: { id } });
    expect(list.body?.threads).toHaveLength(smallFeatureThreadList.threads.length);
    const reply = await call("replyToThread", {
      params: { id, threadId: "PRRT_cache" },
      body: { body: "Capped." },
    });
    expect(reply.body?.body).toBe("Capped.");
    const resolved = await call("resolveThread", {
      params: { id, threadId: "PRRT_cache" },
      body: { resolved: true },
    });
    expect(resolved.body).toEqual({ resolved: true });
  });

  it("posts one comment on a line at once", async () => {
    const { call } = await seeded();
    const hunk = smallFeatureAnalysis.files
      .flatMap((file) => file.hunks)
      .find((one) => one.lines.some((line) => line.kind === "add"));
    const line = hunk?.lines.find((one) => one.kind === "add")?.newLine;
    if (hunk === undefined || line == null) throw new Error("small-feature has an added line");
    const posted = await call("postComment", {
      params: { id },
      body: { hunkId: hunk.id, side: "new", line, body: "Why 600?" },
    });
    expect(posted.body).toEqual({});
    const list = await call("getThreads", { params: { id } });
    expect(list.body?.threads.at(-1)?.comments[0]?.body).toBe("Why 600?");
  });

  it("rejects an empty reply and a malformed thread ID", async () => {
    const { call } = await seeded();
    const bad = [
      await call("replyToThread", { params: { id, threadId: "PRRT_cache" }, body: { body: "  " } }),
      await call("resolveThread", { params: { id, threadId: "a b" }, body: { resolved: true } }),
    ];
    expect(bad.map((one) => one.error?.code)).toEqual(["bad-request", "bad-request"]);
  });
});

describe("GET /api/analyses/:id/attachment", () => {
  const path = (url: string, token?: string) =>
    `/api/analyses/${id}/attachment?${new URLSearchParams({ url, ...(token === undefined ? {} : { token }) })}`;

  it("serves the host's attachment with its type, taking the token in the query", async () => {
    const { app } = await seeded();
    const response = await app.request(path(ATTACHMENT, TOKEN), { headers: { host: HOST } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80]);
  });

  it("serves a byte range, so a video can seek", async () => {
    const { app } = await seeded();
    const ranged = await app.request(path(ATTACHMENT, TOKEN), {
      headers: { host: HOST, range: "bytes=1-" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-1/2");
    expect(ranged.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([80]);
    const past = await app.request(path(ATTACHMENT, TOKEN), {
      headers: { host: HOST, range: "bytes=5-" },
    });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */2");
  });

  it("refuses a missing token, a URL that isn't the host's, and one that isn't https", async () => {
    const { app, request } = await seeded();
    expect((await app.request(path(ATTACHMENT), { headers: { host: HOST } })).status).toBe(401);
    expect((await request(path("https://evil.test/pixel.png"))).status).toBe(404);
    expect((await request(path("http://github.com/user-attachments/assets/1"))).status).toBe(400);
    expect((await request(`/api/analyses/${id}/attachment`)).status).toBe(400);
    expect((await request(path(ATTACHMENT).replace(id, "nope"))).status).toBe(400);
  });
});

describe("GET /api/analyses/:id/events", () => {
  it("forwards a running analysis's events in order, then done", async () => {
    const model = new GatedModel();
    const { call, request, events, complete } = setupApp({ model });
    const started = await call("startAnalysis", { body: { url: smallFeature.pullRequest.url } });
    const analysisId = started.body?.analysisId ?? "";
    await complete(AnalysisId.parse(analysisId));
    await call("runModel", { params: { id: analysisId } });
    await model.entered;

    const response = await request(eventsPath(analysisId));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const seen: AnalysisEvent[] = [];
    events.subscribe(AnalysisId.parse(analysisId), (event) => seen.push(event));
    model.release();

    const messages = parseSse(await response.text());
    expect(seen.length).toBeGreaterThan(2);
    expect(messages).toEqual(
      seen.map((event) =>
        event.type === "done"
          ? { event: "done", data: "{}", comment: null }
          : {
              event: "updated",
              data: JSON.stringify({ stage: event.stage, status: event.status }),
              comment: null,
            },
      ),
    );
    expect(messages.at(-1)?.event).toBe("done");
  });

  it("sends done right away for a complete or failed analysis", async () => {
    for (const analysis of [
      smallFeatureAnalysis,
      { ...smallFeatureAnalysis, status: "failed" as const },
      // As the pipeline leaves one whose code failed: the model's stages never left pending.
      {
        ...smallFeatureAnalysis,
        status: "failed" as const,
        stages: {
          ...smallFeatureAnalysis.stages,
          prep: "failed" as const,
          intent: "pending" as const,
          findings: "pending" as const,
          risk: "pending" as const,
          decisions: "pending" as const,
          tour: "pending" as const,
        },
      },
    ]) {
      const counting = countingEvents();
      const { request, store } = setupApp({ events: counting.events });
      await store.saveAnalysis(analysis);
      const response = await request(eventsPath(id));
      expect(await response.text()).toBe("event: done\ndata: {}\n\n");
      expect(counting.active()).toBe(0);
    }
  });

  it("rejects a malformed ID and reports an unknown one, without staying subscribed", async () => {
    const counting = countingEvents();
    const { request } = setupApp({ events: counting.events });
    const malformed = await request(eventsPath("nope"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "bad-request" } });
    const unknown = await request(eventsPath("a_0000000000000000"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({
      error: { code: "not-found", message: "No analysis a_0000000000000000" },
    });
    expect(counting.active()).toBe(0);
  });

  it("sends a heartbeat every 15 seconds and unsubscribes when the client goes away", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const counting = countingEvents();
    const { request, store, events } = setupApp({ events: counting.events });
    await store.saveAnalysis(running);
    const response = await request(eventsPath(id));
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    expect(counting.active()).toBe(1);

    vi.advanceTimersByTime(15_000);
    expect(await readChunk(reader)).toBe(": heartbeat\n\n");
    events.emit(id, { type: "updated", stage: "intent", status: "running" });
    expect(parseSse(await readChunk(reader))).toEqual([
      { event: "updated", data: '{"stage":"intent","status":"running"}', comment: null },
    ]);

    await reader.cancel();
    await vi.waitFor(() => expect(counting.active()).toBe(0));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the built UI", () => {
  it("serves index.html at the root without caching", async () => {
    for (const path of ["/", "/index.html"]) {
      const response = await getUi(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe(INDEX);
    }
  });

  it("caches hashed assets forever", async () => {
    const response = await getUi("/assets/index-abc123.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe(SCRIPT);
  });

  it("serves other files without a cache policy", async () => {
    const response = await getUi("/favicon.svg");
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("falls back to index.html for client-side routes and folders", async () => {
    for (const path of ["/review/a_0123456789abcdef", "/assets", "/missing.js"]) {
      const response = await getUi(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe(INDEX);
    }
  });

  it("rejects path traversal, encoded or not", async () => {
    for (const path of [
      "/..%2fsecret.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
      "/..%5csecret.txt",
      "/%00",
      "/%E0%A4%A",
    ]) {
      const response = await getUi(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain("secret");
    }
    // The URL parser resolves these before routing, so they stay inside the folder.
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]) {
      expect(await (await getUi(path)).text(), path).toBe(INDEX);
    }
  });

  it("leaves API paths and other methods to the API", async () => {
    const { app } = setupApp({ staticDir });
    const api = await app.request("/api/nope", { headers: { host: HOST } });
    expect(api.status).toBe(401);
    expect((await getUi("/", { method: "POST" })).status).toBe(404);
  });

  it("answers 404 when the folder has no index.html", async () => {
    const { app } = setupApp({ staticDir: join(root, "missing") });
    const response = await app.request("/", { headers: { host: HOST } });
    expect(response.status).toBe(404);
  });

  it("isn't served without a folder", async () => {
    const { app } = setupApp();
    const response = await app.request("/", { headers: { host: HOST } });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
