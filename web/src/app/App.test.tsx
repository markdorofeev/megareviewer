import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureAnalysisView } from "../../dev/fixtures/index.ts";
import { mockFetch } from "../../dev/mock-fetch.ts";
import { createMockApi, MOCK_TOKEN } from "../../dev/mock-routes.ts";
import { fakeFetch, jsonResponse } from "../testing/fetch.ts";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import type { SessionToken } from "./token.ts";

const tokenOf = (initial: string | null) => {
  let value = initial;
  const token: SessionToken = {
    get value() {
      return value;
    },
    clear() {
      value = null;
    },
  };
  return token;
};

const renderApp = (path: string, options: { fetch?: typeof fetch; token?: string | null } = {}) => {
  window.history.replaceState(null, "", path);
  const token = tokenOf(options.token === undefined ? MOCK_TOKEN : options.token);
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

  it("shows the picker and the server's status", async () => {
    renderApp("/");
    expect(screen.getByRole("heading", { name: "Pull requests" })).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: /Signed in as Lee Park on GitHub\.$/ }),
    ).toBeTruthy();
  });

  it("shows the review page for an analysis, with the account and connections in its header", async () => {
    renderApp(`/review/${fixtureAnalysisView.analysis.id}`);
    expect(
      await screen.findByRole("heading", { name: "Add order receipts endpoint" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: /Signed in as Lee Park on GitHub\.$/ }),
    ).toBeTruthy();
  });

  it("closes the account popover when a layout is picked, and leaves the focus where it went", async () => {
    renderApp(`/review/${fixtureAnalysisView.analysis.id}`);
    await screen.findByRole("heading", { name: "Add order receipts endpoint" });
    const account = await screen.findByRole("button", {
      name: /Signed in as Lee Park on GitHub\.$/,
    });
    await userEvent.click(account);
    const popover = await screen.findByRole("dialog");
    const layout = await within(popover).findByRole("group", { name: "Layout" });
    await userEvent.click(within(layout).getByRole("button", { name: "Overview" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Check again" })).toBeNull());
    // The overview took the focus to the file in view; closing doesn't hand it back.
    expect(document.activeElement).not.toBe(account);
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
