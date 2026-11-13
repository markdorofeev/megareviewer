import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_HEADER } from "../../../contracts/index.ts";
import { fixtureAnalysisView, fixtureStatus } from "../../dev/fixtures/index.ts";
import { mockFetch } from "../../dev/mock-fetch.ts";
import { createMockApi, MOCK_STAGE_MS, MOCK_TOKEN, type MockApi } from "../../dev/mock-routes.ts";
import { testApi } from "../testing/api.tsx";
import { fakeFetch, jsonResponse } from "../testing/fetch.ts";
import {
  REFETCH_DEBOUNCE_MS,
  useAnalysisView,
  useMutation,
  usePullRequests,
  useStatus,
} from "./hooks.ts";

const id = fixtureAnalysisView.analysis.id;

/** Counts analysis view requests to the mock API. */
const countingMock = () => {
  const mock = createMockApi();
  const fetch = mockFetch(mock);
  let viewRequests = 0;
  const counted: typeof globalThis.fetch = (input, init) => {
    if (String(input) === `/api/analyses/${id}`) viewRequests += 1;
    return fetch(input, init);
  };
  return { ...testApi({ mock, fetch: counted }), viewRequests: () => viewRequests };
};

const startAnalysis = (mock: MockApi) =>
  mock.handle({
    method: "POST",
    path: "/api/analyses",
    query: new URLSearchParams(),
    headers: { [TOKEN_HEADER]: MOCK_TOKEN },
    body: { url: "https://github.com/acme/shop/pull/128" },
  });

const flush = () => act(async () => {});

afterEach(() => {
  vi.useRealTimers();
});

describe("useStatus and usePullRequests", () => {
  it("load, and load again on refresh", async () => {
    const { wrapper } = testApi();
    const { result } = renderHook(() => ({ status: useStatus(), list: usePullRequests() }), {
      wrapper,
    });
    expect(result.current.status.loading).toBe(true);
    await waitFor(() => expect(result.current.status.status).toEqual(fixtureStatus));
    expect(result.current.list.pullRequests?.items).toHaveLength(6);
    act(() => result.current.list.refresh());
    expect(result.current.list.loading).toBe(true);
    await waitFor(() => expect(result.current.list.loading).toBe(false));
  });

  it("keep the last data when a refresh fails", async () => {
    let fail = false;
    const { fetch } = fakeFetch(() =>
      fail
        ? jsonResponse(502, { error: { code: "host-error", message: "down" } })
        : jsonResponse(200, fixtureStatus),
    );
    const { wrapper } = testApi({ fetch });
    const { result } = renderHook(() => useStatus(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(fixtureStatus));
    fail = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error?.code).toBe("host-error"));
    expect(result.current.status).toEqual(fixtureStatus);
  });
});

describe("useAnalysisView", () => {
  it("fetches the view", async () => {
    const { wrapper } = testApi();
    const { result } = renderHook(() => useAnalysisView(id), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.view).toEqual(fixtureAnalysisView));
    expect(result.current.loading).toBe(false);
  });

  it("refetches once per burst of events", async () => {
    vi.useFakeTimers();
    const { wrapper, mock, emit, viewRequests } = countingMock();
    startAnalysis(mock);
    const { result } = renderHook(() => useAnalysisView(id), { wrapper });
    await flush();
    expect(viewRequests()).toBe(1);
    expect(result.current.view?.analysis.stages.collect).toBe("running");

    vi.advanceTimersByTime(MOCK_STAGE_MS);
    emit(id, { type: "changed" });
    emit(id, { type: "changed" });
    expect(viewRequests()).toBe(1);
    await act(async () => vi.advanceTimersByTime(REFETCH_DEBOUNCE_MS));
    expect(viewRequests()).toBe(2);
    expect(result.current.view?.analysis.stages.collect).toBe("done");
    mock.close();
  });

  it("refetches on done and stops listening", async () => {
    vi.useFakeTimers();
    const { wrapper, mock, emit, subscribers, viewRequests } = countingMock();
    startAnalysis(mock);
    const { result, unmount } = renderHook(() => useAnalysisView(id), { wrapper });
    await flush();
    expect(result.current.view?.analysis.status).toBe("running");

    vi.advanceTimersByTime(MOCK_STAGE_MS * 6);
    emit(id, { type: "changed" });
    emit(id, { type: "done" });
    await flush();
    expect(viewRequests()).toBe(2);
    expect(result.current.view?.analysis.status).toBe("complete");
    // The debounced refetch from the last change was dropped.
    await act(async () => vi.advanceTimersByTime(REFETCH_DEBOUNCE_MS));
    expect(viewRequests()).toBe(2);

    unmount();
    expect(subscribers(id)).toBe(0);
  });

  it("doesn't refetch on done when the view already shows the end", async () => {
    const { wrapper, emit, viewRequests } = countingMock();
    const { result } = renderHook(() => useAnalysisView(id), { wrapper });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    emit(id, { type: "done" });
    await flush();
    expect(viewRequests()).toBe(1);
  });

  it("refetches when the stream is refused while the analysis runs", async () => {
    const { wrapper, mock, emit, viewRequests } = countingMock();
    startAnalysis(mock);
    const { result } = renderHook(() => useAnalysisView(id), { wrapper });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    emit(id, { type: "closed" });
    await flush();
    expect(viewRequests()).toBe(2);
    mock.close();
  });

  it("shows the error, keeping the last view", async () => {
    let fail = false;
    const { fetch } = fakeFetch(() =>
      fail
        ? Promise.reject(new TypeError("Failed to fetch"))
        : jsonResponse(200, fixtureAnalysisView),
    );
    const { wrapper } = testApi({ fetch });
    const { result } = renderHook(() => useAnalysisView(id), { wrapper });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    fail = true;
    await act(() => result.current.refetch());
    expect(result.current.error?.code).toBe("unreachable");
    expect(result.current.view).toEqual(fixtureAnalysisView);
  });
});

describe("useMutation", () => {
  it("tracks pending and the last error", async () => {
    let finish: (failed: boolean) => void = () => {};
    const call = () =>
      new Promise<
        | { readonly ok: true; readonly value: number }
        | { readonly ok: false; readonly error: { code: "host-error"; message: string } }
      >((resolve) => {
        finish = (failed) =>
          resolve(
            failed
              ? { ok: false, error: { code: "host-error", message: "x" } }
              : { ok: true, value: 1 },
          );
      });
    const { result } = renderHook(() => useMutation(call));
    let running: Promise<unknown> = Promise.resolve();
    act(() => {
      running = result.current.run();
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      finish(true);
      await running;
    });
    expect(result.current).toMatchObject({ pending: false, error: { code: "host-error" } });
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});
