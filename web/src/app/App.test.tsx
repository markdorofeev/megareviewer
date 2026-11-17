import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_HEADER } from "../../../contracts/index.ts";
import { fixtureAnalysisView } from "../../dev/fixtures/index.ts";
import { mockFetch } from "../../dev/mock-fetch.ts";
import { createMockApi, MOCK_TOKEN } from "../../dev/mock-routes.ts";
import { fakeFetch, jsonResponse } from "../testing/fetch.ts";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import type { SessionToken } from "./token.ts";

/** A token whose storage holds `stored` once the first is rejected: another tab's, or none. */
const tokenOf = (initial: string | null, stored: string | null = null) => {
  let value = initial;
  const rejected: string[] = [];
  const token: SessionToken & { readonly rejected: readonly string[] } = {
    get value() {
      return value;
    },
    rejected,
    reject(old) {
      rejected.push(old);
      value = stored !== old ? stored : null;
      return value;
    },
  };
  return token;
};

const renderApp = (
  path: string,
  options: { fetch?: typeof fetch; token?: string | null; stored?: string } = {},
) => {
  window.history.replaceState(null, "", path);
  const token = tokenOf(options.token === undefined ? MOCK_TOKEN : options.token, options.stored);
  const noStream = () => ({ readyState: 0, addEventListener: () => {}, close: () => {} });
  render(
    <App
      token={token}
      fetch={options.fetch ?? mockFetch(createMockApi())}
      openEventStream={noStream}
    />,
  );
  return token;
};

afterEach(() => window.history.replaceState(null, "", "/"));

describe("App", () => {
  it("shows the token screen without calling the API when there's no token", () => {
    const { fetch, requests } = fakeFetch(() => jsonResponse(500, {}));
    renderApp("/", { token: null, fetch });
    expect(
      screen.getByRole("heading", { name: "Open megareviewer from your terminal" }),
    ).toBeTruthy();
    expect(screen.getByText(/needs the link megareviewer printed/)).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("shows the token screen and forgets the token when the server rejects it", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(401, {
        error: { code: "unauthorized", message: "Missing or wrong session token" },
      }),
    );
    const token = renderApp("/", { fetch });
    expect(await screen.findByText(/session has ended/)).toBeTruthy();
    expect(token.value).toBeNull();
  });

  it("goes on with the token a restarted server gave another tab", async () => {
    const api = mockFetch(createMockApi());
    const fetch: typeof globalThis.fetch = (input, init) =>
      new Headers(init?.headers).get(TOKEN_HEADER) === "stale"
        ? Promise.resolve(
            jsonResponse(401, {
              error: { code: "unauthorized", message: "Missing or wrong session token" },
            }),
          )
        : api(input, init);
    const token = renderApp("/", { fetch, token: "stale", stored: MOCK_TOKEN });
    expect(await screen.findByText("3 of 6 connected")).toBeTruthy();
    expect(token.rejected).toContain("stale");
    expect(screen.queryByText(/session has ended/)).toBeNull();
  });

  it("shows the picker and the server's status", async () => {
    renderApp("/");
    expect(screen.getByRole("heading", { name: "Pull requests" })).toBeTruthy();
    expect(await screen.findByText("3 of 6 connected")).toBeTruthy();
  });

  it("shows the review page for an analysis, with Connections in its header", async () => {
    renderApp(`/review/${fixtureAnalysisView.analysis.id}`);
    expect(
      await screen.findByRole("heading", { name: "Add order receipts endpoint" }),
    ).toBeTruthy();
    expect(await screen.findByText("3 of 6 connected")).toBeTruthy();
  });

  it("links to the preferences from every page's header, and shows them", async () => {
    renderApp(`/review/${fixtureAnalysisView.analysis.id}`);
    const link = screen.getByRole("link", { name: "Preferences" });
    expect(link.getAttribute("href")).toBe("/preferences");
    expect(link.getAttribute("aria-current")).toBeNull();
    await userEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Preferences" })).toBeTruthy();
    expect(window.location.pathname).toBe("/preferences");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("region", { name: "Everywhere" })).toBeTruthy();
    expect(screen.getByText("3 of 6 connected")).toBeTruthy();
  });

  it("shows not-found with a link home for unknown paths", () => {
    renderApp("/somewhere");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Go to your pull requests" }).getAttribute("href"),
    ).toBe("/");
  });
});

describe("ErrorBoundary", () => {
  it("shows the error and a reload button", () => {
    const Broken = () => {
      throw new Error("boom");
    };
    let reloaded = false;
    // React logs caught errors; keep the test output clean.
    const logged = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary onReload={() => (reloaded = true)}>
        <Broken />
      </ErrorBoundary>,
    );
    logged.mockRestore();
    expect(screen.getByText("Error: boom")).toBeTruthy();
    screen.getByRole("button", { name: "Reload" }).click();
    expect(reloaded).toBe(true);
  });
});
