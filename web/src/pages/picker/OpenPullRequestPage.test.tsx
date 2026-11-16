import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestRef } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { mockFetch } from "../../../dev/mock-fetch.ts";
import { createMockApi } from "../../../dev/mock-routes.ts";
import { ConnectionsProvider } from "../../app/connections-context.tsx";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse } from "../../testing/fetch.ts";
import { OpenPullRequestPage } from "./OpenPullRequestPage.tsx";

const github: PullRequestRef = {
  repo: { host: "github", owner: "acme", repo: "shop" },
  number: 128,
};
const bitbucket: PullRequestRef = {
  repo: { host: "bitbucket", owner: "acme-team", repo: "billing" },
  number: 57,
};

const renderPage = (pullRequest: PullRequestRef, fetch = mockFetch(createMockApi())) => {
  const { wrapper: Api } = testApi({ fetch });
  render(
    <Api>
      <ConnectionsProvider>
        <OpenPullRequestPage pullRequest={pullRequest} />
      </ConnectionsProvider>
    </Api>,
  );
};

afterEach(() => window.history.replaceState(null, "", "/"));

describe("OpenPullRequestPage", () => {
  it("starts the PR's analysis and goes on to its review in place of itself", async () => {
    window.history.replaceState(null, "", "/");
    window.history.pushState(null, "", "/pr/github/acme/shop/128");
    const before = window.history.length;
    const { fetch, requests } = fakeFetch((request) =>
      mockFetch(createMockApi())(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      }),
    );
    renderPage(github, fetch);
    expect(screen.getByRole("heading", { name: "acme/shop #128" })).toBeTruthy();
    expect(screen.getByText("Fetching acme/shop #128 from GitHub…")).toBeTruthy();
    await vi.waitFor(() =>
      expect(window.location.pathname).toBe(`/review/${fixtureAnalysisView.analysis.id}`),
    );
    expect(window.history.length).toBe(before);
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({
      url: "https://github.com/acme/shop/pull/128",
    });
  });

  it("says why it couldn't open, and tries again", async () => {
    renderPage(bitbucket);
    expect(
      await screen.findByText(
        /^Couldn't open acme-team\/billing #57: Bitbucket isn't configured\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Connections" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Go to your pull requests" }).getAttribute("href"),
    ).toBe("/");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Couldn't open acme-team\/billing #57/)).toBeTruthy();
  });

  it("goes to the pull requests on Cancel, and doesn't open the review after", async () => {
    let release: (response: Response) => void = () => {};
    const mock = mockFetch(createMockApi());
    const { fetch } = fakeFetch((request) =>
      request.method === "POST"
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : mock(request.url, { method: request.method, headers: request.headers }),
    );
    window.history.replaceState(null, "", "/pr/github/acme/shop/128");
    renderPage(github, fetch);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(window.location.pathname).toBe("/");
    release(jsonResponse(200, { analysisId: fixtureAnalysisView.analysis.id }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.pathname).toBe("/");
  });
});
