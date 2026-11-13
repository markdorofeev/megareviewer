import { describe, expect, it, vi } from "vitest";
import { TOKEN_HEADER } from "../../../contracts/index.ts";
import { PointId } from "../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureStatus } from "../../dev/fixtures/index.ts";
import { mockFetch } from "../../dev/mock-fetch.ts";
import { createMockApi, MOCK_TOKEN } from "../../dev/mock-routes.ts";
import { fakeFetch, jsonResponse } from "../testing/fetch.ts";
import { createApiClient } from "./client.ts";

const client = (fetch: typeof globalThis.fetch, onUnauthorized = () => {}) =>
  createApiClient({ fetch, token: "secret", onUnauthorized });

const id = fixtureAnalysisView.analysis.id;

describe("createApiClient", () => {
  it("sends the session token, the method, the path and a JSON body", async () => {
    const { fetch, requests } = fakeFetch(() =>
      jsonResponse(200, { pointId: "f1", state: "raised", updatedAt: "2026-10-22T10:00:00Z" }),
    );
    const result = await client(fetch).putPointState(id, PointId.parse("f1"), {
      state: "raised",
    });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(`/api/analyses/${id}/points/f1`);
    expect(request?.method).toBe("PUT");
    expect(request?.headers.get(TOKEN_HEADER)).toBe("secret");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.body).toEqual({ state: "raised" });
  });

  it("sends no body or content type on a GET", async () => {
    const { fetch, requests } = fakeFetch(() => jsonResponse(200, fixtureStatus));
    await client(fetch).getStatus();
    expect(requests[0]?.headers.get("content-type")).toBeNull();
    expect(requests[0]?.body).toBeUndefined();
  });

  it("parses responses with the contract's schemas", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, fixtureStatus));
    expect(await client(fetch).getStatus()).toEqual({ ok: true, value: fixtureStatus });
  });

  it("calls every route of the mock API", async () => {
    const api = createMockApi();
    const mock = createApiClient({
      fetch: mockFetch(api),
      token: MOCK_TOKEN,
      onUnauthorized: () => {},
    });
    expect((await mock.listPullRequests()).ok).toBe(true);
    expect((await mock.getAnalysis(id)).ok).toBe(true);
    expect((await mock.previewPublication(id, { summary: "" })).ok).toBe(true);
    expect((await mock.publish(id, { summary: "", allowStale: false })).ok).toBe(true);
    expect(await mock.retryAnalysis(id)).toMatchObject({
      ok: false,
      error: { code: "bad-request" },
    });
    expect((await mock.startAnalysis({ url: "https://github.com/acme/shop/pull/128" })).ok).toBe(
      true,
    );
    api.close();
  });

  it("reports a response that doesn't match the contract as a version mismatch", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, { version: 1 }));
    const result = await client(fetch).getStatus();
    expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(!result.ok && result.error.message).toMatch(/different versions/);
  });

  it("passes the server's error code and message through", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(400, { error: { code: "unsupported-url", message: "Not a PR URL" } }),
    );
    expect(await client(fetch).startAnalysis({ url: "x" })).toEqual({
      ok: false,
      error: { code: "unsupported-url", message: "Not a PR URL" },
    });
  });

  it("tells the app when the token is rejected", async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeFetch(() =>
      jsonResponse(401, {
        error: { code: "unauthorized", message: "Missing or wrong session token" },
      }),
    );
    const result = await client(fetch, onUnauthorized).getStatus();
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("reports a failed request as unreachable", async () => {
    const fetch: typeof globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await client(fetch).getStatus()).toMatchObject({
      ok: false,
      error: { code: "unreachable" },
    });
  });

  it("reports an error page from something other than the server", async () => {
    const proxy = fakeFetch(() => new Response("Bad gateway", { status: 502 }));
    expect(await client(proxy.fetch).getStatus()).toMatchObject({
      ok: false,
      error: { code: "unreachable" },
    });
    const stray = fakeFetch(() => new Response("Forbidden host", { status: 403 }));
    expect(await client(stray.fetch).getStatus()).toMatchObject({
      ok: false,
      error: { code: "internal" },
    });
  });
});
