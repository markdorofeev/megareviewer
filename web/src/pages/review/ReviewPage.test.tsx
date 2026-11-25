import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AnalysisView } from "../../../../contracts/index.ts";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import {
  AnalysisId,
  type IntentMismatch,
  PointId,
  type PublicationReceipt,
  type PullRequestStatus,
} from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixtureHunks,
  fixtureParts,
  fixturePullRequestStatus,
  fixtureStatus,
  largeAnalysisView,
  lockedModelOptions,
  NO_API_CREDENTIALS,
  tourAnalysisView,
} from "../../../dev/fixtures/index.ts";
import { mockFetch } from "../../../dev/mock-fetch.ts";
import { createMockApi } from "../../../dev/mock-routes.ts";
import { analysisFailed, analysisInProgress } from "../../../dev/progress.ts";
import { DisplayMenu } from "../../app/Header.tsx";
import { PageDisplayProvider } from "../../lib/page-display.tsx";
import { type Highlighter, HighlighterContext } from "../../review/index.ts";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse, type RecordedRequest } from "../../testing/fetch.ts";
import { firstSentence } from "./IntentLine.tsx";
import { ReviewPage } from "./ReviewPage.tsx";

const fixture = fixtureAnalysisView;
const analysis = fixture.analysis;
const id = analysis.id;
const h = fixtureHunks;
const p = fixtureParts;
/** The analysis with the retry and cache hunk whole, for tours that place hunks. */
const otherId = AnalysisId.parse("a_00000000000000ff");
const viewPath = `/api/analyses/${id}`;
const statusPath = `/api/analyses/${id}/pull-request-status`;

/** Never finishes, so cards stay plain text and Shiki never loads. */
const pendingHighlighter: Highlighter = { highlight: () => new Promise(() => {}) };

const failure = (status: number, code: string, message: string) =>
  jsonResponse(status, { error: { code, message } });

/**
 * The review page over the mock API. `respond` answers requests first; `view` replaces the
 * analysis view the mock would serve, and `setView` changes it later.
 */
const renderReview = (
  options: {
    readonly view?: AnalysisView;
    readonly respond?: (request: RecordedRequest) => Response | Promise<Response> | undefined;
  } = {},
) => {
  const mock = createMockApi();
  const forward = mockFetch(mock);
  let view = options.view;
  const { fetch, requests } = fakeFetch((request) => {
    const answer = options.respond?.(request);
    if (answer !== undefined) return answer;
    if (view !== undefined && request.method === "GET" && request.url === viewPath) {
      return jsonResponse(200, view);
    }
    return forward(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
  });
  const api = testApi({ fetch, mock });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <api.wrapper>
      <HighlighterContext.Provider value={pendingHighlighter}>
        <PageDisplayProvider>
          <DisplayMenu />
          {children}
        </PageDisplayProvider>
      </HighlighterContext.Provider>
    </api.wrapper>
  );
  const result = render(<ReviewPage analysisId={id} />, { wrapper });
  const setView = (next: AnalysisView) => {
    view = next;
    api.emit(id, { type: "changed" });
  };
  return { ...result, ...api, requests, setView };
};

/** The code's analysis, before anyone asked for the model. */
const codeOnly: AnalysisView = {
  ...fixture,
  analysis: {
    ...analysisFailed(analysis, "intent", "unused"),
    stages: {
      ...analysis.stages,
      intent: "skipped",
      steps: "skipped",
    },
    modelError: null,
    modelOption: null,
  },
};

/** The text an element's aria-describedby points to. */
const description = (element: Element): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();

const loaded = () =>
  screen.findByRole("heading", { level: 1, name: "Add order receipts endpoint" });
const mainArea = () => {
  const main = document.querySelector<HTMLElement>('[aria-label="Changes"]');
  if (main === null) throw new Error("no main area");
  return main;
};
/** The step headings in the map, in order. */
/** The map's file cards, by path, in page order. */
const fileCards = () =>
  [...mainArea().querySelectorAll("[data-slot=file-card]")].map((card) =>
    card.getAttribute("aria-label"),
  );
/** A hunk's place in the map: its card, or its collapsed row. */
const placeOf = (hunkId: PartId) => {
  const place = document.getElementById(`hunk-${hunkId}`);
  if (place === null) throw new Error(`no hunk ${hunkId} in the map`);
  return place;
};
/** The card of a step's parts from one file, named by its path. */
const fileCardOf = (path: string) => screen.getByRole("region", { name: path });
const cardOf = (hunkId: PartId) => {
  const card = placeOf(hunkId).querySelector<HTMLElement>("[data-slot=hunk-card]");
  if (card === null) throw new Error(`no card for ${hunkId}`);
  return card;
};
/** The rail's bar for a part, which says whether it's reviewed. */
const railBar = (lines: string) =>
  within(rail()).getByRole("button", { name: new RegExp(`, lines ${lines}, `), hidden: true });
const _isReviewed = (lines: string) =>
  railBar(lines).getAttribute("aria-label")?.endsWith(", reviewed") === true;
const focusedLabel = () => document.activeElement?.getAttribute("aria-label");
const _storedReviewed = (): unknown =>
  JSON.parse(window.localStorage.getItem("megareviewer:reviewed-hunks") ?? "[]");
const rail = () => screen.getByRole("complementary", { name: "Files" });
/** The row under the header that stays at the top of the window. */
const reviewBar = () => {
  const bar = document.querySelector<HTMLElement>("[data-slot=review-bar]");
  if (bar === null) throw new Error("no review bar");
  return bar;
};
const overviewBox = () => screen.getByRole("region", { name: "Overview of the changed files" });
const pointCard = (title: RegExp) => screen.getByRole("article", { name: title });
const pointButton = (action: string, title: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`^${action}: ${title.source}`) });
const addToReview = (title: RegExp) => pointButton("Add to review", title);
/** A part's row for a line, by its number on the new side, or the old for a removed line. */
const lineRow = (card: HTMLElement, label: string) => {
  const row = [...card.querySelectorAll<HTMLElement>("[data-line]")].find((one) =>
    one.textContent?.includes(`${label}: `),
  );
  if (row === undefined) throw new Error(`no row for ${label}`);
  return row;
};
const comesBefore = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const RETRIES = /Retries the tax service back to back/;
const FINDING = /Any signed-in user can read/;
const putRequests = (requests: readonly RecordedRequest[]) =>
  requests.filter((request) => request.method === "PUT");
const scrolledTo = () =>
  vi
    .mocked(Element.prototype.scrollIntoView)
    .mock.contexts.map((element) => (element as Element).id);

const IMPORTS = /^src\/routes\/orders\.ts, lines 1–8$/;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ReviewPage states", () => {
  it("shows a skeleton while loading, then the review", async () => {
    renderReview();
    expect(screen.getByLabelText("Loading the analysis")).toBeTruthy();
    await loaded();
    expect(screen.queryByLabelText("Loading the analysis")).toBeNull();
    expect(fileCards()[0]).toBe("src/routes/orders.ts");
  });

  it("says how many files Collect has while it runs", async () => {
    const { setView } = renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysisInProgress(analysis, 0),
          pullRequest: analysis.pullRequest,
          filesFetched: { done: 12, total: 42 },
        },
      },
    });
    await loaded();
    const progress = screen.getByRole("list", { name: "Analysis progress" });
    expect(progress.textContent).toContain("Collect: running · 12 of 42 files");

    setView({ ...fixture, analysis: analysisInProgress(analysis, 1) });
    await waitFor(() => expect(progress.textContent).toContain("Collect: done"));
    expect(progress.textContent).not.toContain("files");
  });

  it("follows Claude's run in the header, and changes the code only once it ends", async () => {
    const { setView } = renderReview({
      view: { ...fixture, analysis: analysisInProgress(analysis, 2) },
    });
    await loaded();
    // The code's stages are done, so the strip is gone; Claude's run says so in the header.
    expect(screen.queryByRole("list", { name: "Analysis progress" })).toBeNull();
    // The AI split is busy, says how far the run got, and the brief's status line says so too.
    const reviewing = within(reviewBar()).getByRole("button", { name: /^Reviewing · \d of 2$/ });
    expect(reviewing.getAttribute("aria-disabled")).toBe("true");
    expect(within(reviewBar()).getByRole("status").textContent).toMatch(
      /^Claude is reading this PR, \d of 2 passes done$/,
    );
    expect(document.querySelector("[data-slot=ai-status]")?.textContent).toMatch(
      /^AI review running.*\d of 2 passes$/,
    );
    expect(
      reviewBar().querySelector("[data-slot=model-hairline]")?.getAttribute("data-state"),
    ).toBe("running");
    // The description stays until the intent arrives.
    const description = firstSentence(analysis.pullRequest?.description ?? "");
    expect(screen.getByText(description)).toBeTruthy();
    expect(fileCards()).toContain("src/routes/orders.ts");
    expect(within(mainArea()).getAllByRole("region", { name: /, lines / })).toHaveLength(6);
    expect(within(mainArea()).getByRole("heading", { name: "Mechanical changes 5" })).toBeTruthy();

    // The intent is the first result: Claude's sentence swaps in where the description was,
    // which keeps its room, hidden from readers, until the run ends.
    setView({ ...fixture, analysis: analysisInProgress(analysis, 3) });
    expect(await screen.findByText(analysis.intent?.inferred.summary ?? "")).toBeTruthy();
    const swap = document.querySelector("[data-slot=intent-swap]");
    expect(swap?.querySelector("[data-leaving]")?.getAttribute("aria-hidden")).toBe("true");
    // The code doesn't change until everything has arrived.
    expect(document.querySelector("[data-slot=point]")).toBeNull();
    expect(document.querySelector("[data-slot=point-chip]")).toBeNull();

    setView(fixture);
    await waitFor(() => expect(addToReview(FINDING).hasAttribute("disabled")).toBe(false));
    expect(document.querySelector("[data-slot=intent-swap]")).toBeNull();
    expect(screen.queryByText(description)).toBeNull();
  });

  it("shows where a failed analysis stopped, what it has, and retries it", async () => {
    const { requests } = renderReview({
      view: { ...fixture, analysis: analysisFailed(analysis, "prep", "The parser crashed") },
      respond: (request) =>
        request.url === `${viewPath}/retry`
          ? jsonResponse(200, { analysisId: otherId })
          : undefined,
    });
    await loaded();
    expect(screen.getByRole("alert").textContent).toContain(
      "The analysis failed at the prepare stage: The parser crashed",
    );
    expect(
      screen.getByText("The diff couldn't be read, so there are no changes to show."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Request AI review/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(requests.some((request) => request.url === `${viewPath}/retry`)).toBe(true);
    expect(window.location.pathname).toBe(`/review/${otherId}`);
  });

  it("starts afresh when a retry runs again under the same ID", async () => {
    let view: AnalysisView = {
      ...fixture,
      analysis: analysisFailed(analysis, "prep", "The parser crashed"),
    };
    const { subscribers } = renderReview({
      respond: (request) => {
        if (request.url === `${viewPath}/retry`) {
          view = { ...fixture, analysis: analysisInProgress(analysis, 0) };
          return jsonResponse(200, { analysisId: id });
        }
        return request.url === viewPath ? jsonResponse(200, view) : undefined;
      },
    });
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Collecting the pull request…")).toBeTruthy();
    expect(subscribers(id)).toBe(1);
  });

  it("asks Claude on the open analysis, and follows its run", async () => {
    const { requests, setView } = renderReview({
      view: codeOnly,
      respond: (request) =>
        request.url === `${viewPath}/model` ? jsonResponse(200, { analysisId: id }) : undefined,
    });
    await loaded();
    const button = within(reviewBar()).getByRole("button", { name: "Request AI review" });
    // The model and who pays, once the status has loaded.
    await waitFor(() =>
      expect(description(button)).toBe("Runs Sonnet 5.5 through Claude Code, on your Pro plan"),
    );
    expect(button.getAttribute("data-slot")).toBe("request-review");
    expect(button.className).not.toContain("border-border");
    const loads = () => requests.filter((request) => request.url === viewPath).length;
    const before = loads();

    await userEvent.click(button);
    expect(requests.find((request) => request.url === `${viewPath}/model`)?.body).toEqual({
      optionId: "claude-code/claude-sonnet-5-5",
      tour: true,
    });
    // Following the analysis again loads it again, without leaving the page.
    await waitFor(() => expect(loads()).toBe(before + 1));
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();

    setView({ ...fixture, analysis: analysisInProgress(analysis, 2) });
    expect(await screen.findByRole("button", { name: /^Reviewing · / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request AI review" })).toBeNull();
  });

  it("takes Claude's run off from what the removal answers, without loading the page again", async () => {
    const { requests } = renderReview();
    await loaded();
    const loads = () => requests.filter((request) => request.url === viewPath).length;
    const before = loads();

    await userEvent.click(await screen.findByRole("button", { name: "Remove AI review…" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    expect(
      await within(reviewBar()).findByRole("button", { name: "Request AI review" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove AI review…" })).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading the analysis" })).toBeNull();
    expect(loads()).toBe(before);
    expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  it("disables the button when no model can run, and says why for each provider", async () => {
    const { requests } = renderReview({
      view: codeOnly,
      respond: (request) =>
        request.url === "/api/status"
          ? jsonResponse(200, { ...fixtureStatus, model: lockedModelOptions })
          : undefined,
    });
    await loaded();
    const button = within(reviewBar()).getByRole("button", { name: "Request AI review" });
    // Disabled before the status is read too, so the reason is what's waited for.
    await waitFor(() =>
      expect(description(button)).toBe(
        "Claude Code isn't signed in: run `claude` and sign in; or No Anthropic API credentials: set ANTHROPIC_API_KEY or run `ant auth login` to use the Anthropic API",
      ),
    );
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // Still focusable, so the keyboard reaches the reason too.
    expect(button.hasAttribute("disabled")).toBe(false);

    await userEvent.click(button);
    expect(requests.some((request) => request.url === `${viewPath}/model`)).toBe(false);
  });

  it("lists every model by provider, a disabled one with why, and keeps the choice", async () => {
    const first = renderReview({
      view: codeOnly,
      respond: (request) =>
        request.url === `${viewPath}/model` ? jsonResponse(200, { analysisId: id }) : undefined,
    });
    await loaded();
    const arrow = await within(reviewBar()).findByRole("button", { name: "Model: Sonnet 5.5" });
    await userEvent.click(arrow);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Claude Code, on your Pro plan")).toBeTruthy();
    expect(within(menu).getByText(NO_API_CREDENTIALS)).toBeTruthy();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Haiku 5.5",
      "Sonnet 5.5",
      "Opus 5.5",
      "Haiku 5.5",
      "Sonnet 5.5",
      "Opus 5.5",
    ]);
    const apiOpus = items[5];
    if (apiOpus === undefined) throw new Error("no API option");
    expect(apiOpus.getAttribute("aria-disabled")).toBe("true");
    expect(description(apiOpus)).toBe(NO_API_CREDENTIALS);

    await userEvent.click(
      within(menu).getAllByRole("menuitemradio", { name: "Opus 5.5" })[0] as HTMLElement,
    );
    const button = within(reviewBar()).getByRole("button", { name: "Request AI review" });
    await waitFor(() =>
      expect(description(button)).toBe("Runs Opus 5.5 through Claude Code, on your Pro plan"),
    );
    await userEvent.click(button);
    expect(first.requests.find((request) => request.url === `${viewPath}/model`)?.body).toEqual({
      optionId: "claude-code/claude-opus-5-5",
      tour: true,
    });
    first.unmount();

    // Kept per browser, so a reload runs it again.
    renderReview({ view: codeOnly });
    await loaded();
    expect(
      await within(reviewBar()).findByRole("button", { name: "Model: Opus 5.5" }),
    ).toBeTruthy();
  });

  it("falls back to the default when the stored choice can no longer run", async () => {
    window.localStorage.setItem(
      "megareviewer:model-option",
      JSON.stringify("anthropic-api/claude-opus-5-5"),
    );
    renderReview({ view: codeOnly });
    await loaded();
    expect(
      await within(reviewBar()).findByRole("button", { name: "Model: Sonnet 5.5" }),
    ).toBeTruthy();
  });

  it("offers Try again in outline when Claude found nothing before failing", async () => {
    renderReview({
      view: { ...fixture, analysis: analysisFailed(analysis, "intent", "Overloaded") },
    });
    await loaded();
    // Quiet, in the AI's outline rather than its tint: the run has had its go.
    const again = within(reviewBar()).getByRole("button", { name: "Try again" });
    expect(again.getAttribute("data-slot")).toBe("request-review");
    expect(again.className).toContain("border-ai-soft-bd");
    expect(within(reviewBar()).getByRole("alert").textContent).toBe(
      "Claude couldn't finish: Overloaded",
    );
  });

  it("says the intent is missing when only its pass failed, the others side by side", async () => {
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          intent: null,
          stages: { ...analysis.stages, intent: "failed" },
          modelError: { stage: "intent", code: "model-error", message: "Overloaded" },
        },
      },
    });
    await loaded();
    expect(within(reviewBar()).getByRole("alert").textContent).toBe("intent missing: Overloaded");
  });

  it("says why Claude couldn't finish, and tries again", async () => {
    const { requests } = renderReview({
      view: { ...fixture, analysis: analysisFailed(analysis, "findings", "Overloaded") },
      respond: (request) =>
        request.url === `${viewPath}/model`
          ? failure(
              503,
              "model-unavailable",
              "Sonnet 5.5 through Claude Code can't run: Claude Code isn't signed in",
            )
          : undefined,
    });
    await loaded();
    // What landed stays; the receipt says what's missing and why.
    expect(within(reviewBar()).getByRole("alert").textContent).toBe("findings missing: Overloaded");
    // The code's review is all there.
    expect(fileCards()).toContain("src/routes/orders.ts");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(requests.some((request) => request.url === `${viewPath}/model`)).toBe(true);
    expect(
      await screen.findByText(
        "Sonnet 5.5 through Claude Code can't run: Claude Code isn't signed in.",
      ),
    ).toBeTruthy();
  });

  it("says when the analysis doesn't exist, with a way back to the picker", async () => {
    renderReview({
      respond: (request) =>
        request.url === viewPath ? failure(404, "not-found", `No analysis ${id}`) : undefined,
    });
    expect(await screen.findByRole("heading", { name: "Analysis not found" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Pick a pull request to review" }).getAttribute("href"),
    ).toBe("/");
  });

  it("offers to try again when the analysis can't be loaded", async () => {
    let calls = 0;
    renderReview({
      respond: (request) => {
        if (request.url !== viewPath) return undefined;
        calls += 1;
        return calls === 1 ? failure(500, "internal", "Database locked") : undefined;
      },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Database locked.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await loaded();
  });
});

describe("the PR's standing in the header", () => {
  /** The page with the status the host answers with, read anew on every request. */
  const withStatus = (status: () => PullRequestStatus | Response) =>
    renderReview({
      respond: (request) => {
        if (request.method !== "GET" || request.url !== statusPath) return undefined;
        const answer = status();
        return answer instanceof Response ? answer : jsonResponse(200, answer);
      },
    });
  const statusReads = (requests: readonly RecordedRequest[]) =>
    requests.filter((request) => request.url === statusPath).length;
  const standing = () => document.querySelector<HTMLElement>("[data-slot=pr-standing]");

  it("shows the state and review status after the title, and CI and reviewers at the row's end", async () => {
    renderReview();
    await loaded();
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(document.querySelector("[data-slot=review-status]")?.textContent).toBe(
      "✕Changes requested",
    );
    const ci = await screen.findByRole("button", {
      name: "CI: 12 of 12 checks passed, show checks",
    });
    expect(ci.textContent).toBe("✓CI 12/12 passed");
    expect(
      screen.getByRole("button", {
        name: "3 reviewers: 1 requested changes, 1 approved, 1 not reviewed yet, show reviewers",
      }),
    ).toBeTruthy();
    // The threads are counted in the bar, not here.
    expect(standing()?.textContent).not.toContain("threads");
  });

  it("always shows the state, Open included, and the review status only when it says something", async () => {
    let status: PullRequestStatus = { ...fixturePullRequestStatus, reviewStatus: null };
    withStatus(() => status);
    await loaded();
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(document.querySelector("[data-slot=review-status]")).toBeNull();

    status = { ...status, state: "merged", reviewStatus: "approved" };
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Merged")).toBeTruthy();
    expect(document.querySelector("[data-slot=review-status]")?.textContent).toBe("✓Approved");
  });

  it("lists the checks in order, failed first, with links to their details", async () => {
    withStatus(() => ({
      ...fixturePullRequestStatus,
      checks: [
        { name: "lint", state: "passed", url: "https://ci.example.com/lint" },
        { name: "unit", state: "failed", url: "https://ci.example.com/unit" },
        { name: "deploy", state: "skipped", url: null },
      ],
    }));
    await loaded();
    await userEvent.click(
      await screen.findByRole("button", { name: "CI: 1 of 2 checks failed, show checks" }),
    );
    const list = await screen.findByRole("list", { name: "Checks" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "✕unitFailedDetails",
      "✓lintPassedDetails",
      "–deploySkipped",
    ]);
    const details = within(list).getByRole("link", { name: "Details of unit" });
    expect(details.getAttribute("href")).toBe("https://ci.example.com/unit");
    expect(details.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("shows nothing for CI on a commit without checks, and says when it can't read them", async () => {
    let status: PullRequestStatus = { ...fixturePullRequestStatus, checks: [] };
    withStatus(() => status);
    await loaded();
    await screen.findByRole("button", { name: /^3 reviewers/ });
    expect(document.querySelector("[data-slot=ci-summary]")).toBeNull();

    status = { ...status, checks: null, checksUnreadable: "Add read access to Checks." };
    act(() => window.dispatchEvent(new Event("focus")));
    await userEvent.click(await screen.findByRole("button", { name: "CI not readable" }));
    expect(await screen.findByText("Add read access to Checks.")).toBeTruthy();
  });

  it("says the status is unavailable when it can't be read, and tries again", async () => {
    let fail = true;
    withStatus(() =>
      fail ? failure(502, "host-error", "GitHub is down") : fixturePullRequestStatus,
    );
    await loaded();
    await userEvent.click(await screen.findByRole("button", { name: "Status unavailable" }));
    expect(await screen.findByText(/GitHub is down/)).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^CI: 12 of 12/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Status unavailable" })).toBeNull();
  });

  it("reads the status again every minute only while a check is running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let status: PullRequestStatus = {
        ...fixturePullRequestStatus,
        checks: [{ name: "unit", state: "running", url: null }],
      };
      const { requests } = withStatus(() => status);
      await loaded();
      await screen.findByRole("button", { name: "CI: 1 of 1 check running, show checks" });
      const before = statusReads(requests);
      status = { ...status, checks: [{ name: "unit", state: "failed", url: null }] };
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      await screen.findByRole("button", { name: "CI: 1 of 1 check failed, show checks" });
      expect(statusReads(requests)).toBe(before + 1);
      // The change is announced; the first read wasn't.
      expect(
        within(standing() ?? document.body)
          .getAllByRole("status")
          .map((one) => one.textContent),
      ).toContain("CI: 1 of 1 check failed");

      await act(() => vi.advanceTimersByTimeAsync(120_000));
      expect(statusReads(requests)).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a reviewer past three as +N, and lists them all in order", async () => {
    withStatus(() => ({
      ...fixturePullRequestStatus,
      reviewers: [
        { id: "a", name: "Ada Byron", team: false, verdict: null },
        { id: "b", name: "Bo Chen", team: false, verdict: "approved" },
        { id: "c", name: "Cy Dee", team: false, verdict: "commented" },
        { id: "d", name: "Platform", team: true, verdict: null },
        { id: "e", name: "Eve Fox", team: false, verdict: "changes-requested" },
      ],
    }));
    await loaded();
    const button = await screen.findByRole("button", { name: /^5 reviewers/ });
    // The verdicts' marks are icons, named in the button's label.
    expect(button.textContent).toBe("EFBC+3");
    await userEvent.click(button);
    const list = await screen.findByRole("list", { name: "Reviewers" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "EFEve FoxRequested changes",
      "BCBo ChenApproved",
      "CDCy DeeCommented",
      "ABAda ByronNot reviewed yet",
      "PLPlatform (team)Not reviewed yet",
    ]);
  });

  it("reads the status again once the review is published", async () => {
    const { requests } = renderReview();
    await loaded();
    await screen.findByRole("button", { name: /^CI: 12 of 12/ });
    const before = statusReads(requests);
    await userEvent.click(screen.getByRole("button", { name: /^Publish review/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish and approve" }));
    await waitFor(() => expect(statusReads(requests)).toBe(before + 1));
  });
});

describe("header", () => {
  it("names the PR once: its number linked after the title, where it is, who wants to merge what and how much it changes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T10:21:00Z"));
    renderReview();
    await loaded();
    const link = screen.getByRole("link", { name: "#128" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/shop/pull/128");
    expect(link.getAttribute("title")).toBe("Open on GitHub");
    const byline = document.querySelector<HTMLElement>("[data-slot=pr-byline]");
    // No count of files, which the tree has, nor of threads, which the bar has.
    expect(byline?.textContent?.replace(/\s+/g, " ")).toBe(
      "shop · Sam Rivera wants to merge shop-142-order-receipts → into main · updated 40m ago · +58 −1358 lines added, 13 removed",
    );
    expect(screen.queryByText(/\d threads/)).toBeNull();
  });

  it("leaves out who, what and how much while the pull request is being collected", async () => {
    const { setView } = renderReview({
      view: { ...fixture, analysis: analysisInProgress(analysis, 0) },
    });
    await screen.findByRole("heading", { level: 1, name: "Collecting the pull request…" });
    expect(document.querySelector("[data-slot=pr-byline]")?.textContent).toBe("shop");

    // Collected, but the diff isn't read yet: who and what, but no count of lines.
    setView({ ...fixture, analysis: analysisInProgress(analysis, 1) });
    await loaded();
    const byline = document.querySelector("[data-slot=pr-byline]");
    expect(byline?.textContent).toContain("Sam Rivera wants to merge");
    expect(byline?.textContent).not.toContain("lines added");
  });

  it("shows up to two warnings in full and collapses more to a count", async () => {
    const { setView } = renderReview();
    await loaded();
    expect(screen.getByRole("list", { name: "Warnings" }).children).toHaveLength(2);
    setView({
      ...fixture,
      analysis: { ...analysis, warnings: [...analysis.warnings, "A third warning"] },
    });
    expect(await screen.findByText("3 warnings")).toBeTruthy();
  });

  it("re-analyzes the PR from the bar when it has new commits", async () => {
    const { requests } = renderReview({
      view: { ...fixture, stale: true },
      respond: (request) =>
        request.method === "POST" && request.url === "/api/analyses"
          ? jsonResponse(200, { analysisId: otherId })
          : undefined,
    });
    await loaded();
    expect(document.querySelector("[data-slot=ai-status]")?.textContent).toContain(
      "new commits since",
    );
    await userEvent.click(
      within(reviewBar()).getByRole("button", { name: "Re-analyze · new commits" }),
    );
    expect(requests.find((request) => request.url === "/api/analyses")?.body).toEqual({
      url: "https://github.com/acme/shop/pull/128",
    });
    expect(window.location.pathname).toBe(`/review/${otherId}`);
  });

  it("shows the usage totals with a breakdown by pass", async () => {
    renderReview();
    await loaded();
    const usage = screen.getByRole("button", { name: /Usage:/ });
    expect(usage.textContent).toBe(
      "Sonnet 5.5 through Claude Code · Usage: 84k tokens in · 38k cache read · 6k out · $0.57",
    );
    const breakdown = document.getElementById(usage.getAttribute("aria-describedby") ?? "");
    if (breakdown === null) throw new Error("no breakdown");
    expect(within(breakdown).getAllByRole("row")).toHaveLength(3);
    expect(within(breakdown).getByRole("row", { name: /Intent/ }).textContent).toBe(
      "Intent80k01k$0.36",
    );
  });
});

const withIntent = (change: Partial<NonNullable<typeof analysis.intent>>): AnalysisView => {
  if (analysis.intent === null) throw new Error("the fixture has no intent");
  return { ...fixture, analysis: { ...analysis, intent: { ...analysis.intent, ...change } } };
};
const firstMismatch = analysis.intent?.mismatches[0];
if (firstMismatch === undefined) throw new Error("the fixture has no mismatch");
const openDetails = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Details" }));
  return screen.getByRole("dialog", { name: "Intent" });
};

describe("intent", () => {
  it("is one line in the header, with the first mismatch named in a chip", async () => {
    renderReview();
    await loaded();
    expect(screen.getByText("From the code:")).toBeTruthy();
    expect(screen.getByText(analysis.intent?.inferred.summary ?? "")).toBeTruthy();
    // A mismatch is one of Claude's points on the code, not a chip in the header.
    expect(document.querySelector("[data-slot=mismatch-chip]")).toBeNull();

    expect(screen.queryByRole("heading", { name: "Inferred from the code" })).toBeNull();
  });

  it("goes from the details to a mismatch's card on the code", async () => {
    const second = {
      ...firstMismatch,
      description: "Caches receipts forever.",
      hunkIds: [h.retryAndCache],
    };
    renderReview({ view: withIntent({ mismatches: [firstMismatch, second] }) });
    await loaded();
    const intent = await openDetails();
    await userEvent.click(
      within(intent).getByRole("button", { name: /Caches receipts forever\./ }),
    );
    expect(scrolledTo().at(-1)).toBe("point-m2");
    expect(cardOf(p.retry).dataset.highlighted === "true").toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(cardOf(p.retry).dataset.highlighted === "true").toBe(false);
  });

  it("shows stated and inferred intent side by side in the details when they disagree", async () => {
    renderReview();
    await loaded();
    const intent = await openDetails();
    const sources = within(intent).getByRole("list", { name: "Sources" });
    expect(
      within(sources)
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
    ).toEqual(["Description", "SHOP-142 · In Review"]);
    expect(within(sources).getByRole("link").getAttribute("href")).toBe(
      "https://acme.atlassian.net/browse/SHOP-142",
    );
    expect(
      within(intent).getByRole("list", { name: "Tickets mentioned but not fetched" }).textContent,
    ).toBe("SHOP-139 · not fetched");
    expect(within(intent).getByRole("heading", { name: "Inferred from the code" })).toBeTruthy();
    expect(within(intent).getByText(/^Details/).textContent).toBe(
      `Details (${analysis.intent?.inferred.behaviorChanges.length})`,
    );

    await userEvent.click(within(intent).getByRole("button", { name: /Contradicts/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The finding that shows the mismatch holds it.
    expect(scrolledTo().at(-1)).toBe("point-f1");
  });

  it("says the code does what was asked when they agree, with what was asked in the details", async () => {
    renderReview({ view: withIntent({ mismatches: [] }) });
    await loaded();
    expect(screen.getByText("Does what was asked:")).toBeTruthy();
    expect(document.querySelector("[data-slot=mismatch-chip]")).toBeNull();
    const intent = await openDetails();
    expect(within(intent).queryByRole("heading", { name: "Inferred from the code" })).toBeNull();
    await userEvent.click(within(intent).getByText(/^Details/));
    expect(within(intent).getByRole("heading", { name: "Asked" })).toBeTruthy();
    expect(within(intent).getByText(analysis.intent?.stated?.summary ?? "")).toBeTruthy();
  });

  it("is from the code when nothing was stated, and the details say so", async () => {
    renderReview({ view: withIntent({ stated: null, mismatches: [] }) });
    await loaded();
    expect(screen.getByText("From the code:")).toBeTruthy();
    const intent = await openDetails();
    expect(
      within(intent).getByText("No stated intent: the PR has no description or linked tickets."),
    ).toBeTruthy();
    expect(within(intent).queryByRole("heading", { name: "Asked" })).toBeNull();
  });

  const brief = () => {
    const found = document.querySelector<HTMLElement>("[data-slot=intent-brief]");
    if (found === null) throw new Error("no brief");
    return found;
  };
  const lines = () => [...brief().querySelectorAll("p")].map((line) => line.textContent);

  it("reads in three lines: what the change does, how it runs through the system, what to watch", async () => {
    renderReview();
    await loaded();
    const { inferred } = analysis.intent ?? {};
    expect(lines()).toEqual([
      `From the code: ${inferred?.summary}`,
      "Through: GET /orders/:id/receipt calls renderReceipt, which fetches tax lines from the tax service and keeps the result in an in-memory cache.",
      "Watch: Any signed-in user can download any order's receipt · Rendered receipts stay in memory for the life of the process",
    ]);
    // Code names are set as code, from the model's backticks, never as HTML.
    expect([...brief().querySelectorAll("code")].map((code) => code.textContent)).toEqual([
      "GET /orders/:id/receipt",
      "renderReceipt",
    ]);
  });

  it("takes the code's lines where Claude left them empty", async () => {
    if (analysis.intent === null) throw new Error("the fixture has no intent");
    renderReview({
      view: withIntent({ inferred: { ...analysis.intent.inferred, shape: "", watch: [] } }),
    });
    await loaded();
    expect(lines().slice(1)).toEqual([
      "Through: routes (GET /orders/:id/receipt) → services · 1 more directory",
      "Watch: Changes renderReceipt, used in 1 place the PR doesn't change.",
    ]);
  });

  it("before Claude, is the description, the directories in call order and what the change reaches", async () => {
    renderReview({ view: { ...fixture, analysis: { ...analysis, intent: null } } });
    await loaded();
    expect(lines()).toEqual([
      firstSentence(analysis.pullRequest?.description ?? ""),
      "Through: routes (GET /orders/:id/receipt) → services · 1 more directory",
      "Watch: Changes renderReceipt, used in 1 place the PR doesn't change.",
    ]);
  });

  it("leaves the details' toggle out when there's nothing behind it", async () => {
    renderReview({
      view: withIntent({
        stated: null,
        mismatches: [],
        inferred: { summary: "Renames a variable.", shape: "", behaviorChanges: [], watch: [] },
      }),
    });
    await loaded();
    expect((await openDetails()).querySelector("details")).toBeNull();
  });
});

describe("map", () => {
  it("shows each file once, in path order, then the mechanical changes", async () => {
    renderReview();
    await loaded();
    // Directories come before files, so package.json is last.
    expect(fileCards()).toEqual([
      "src/routes/orders.ts",
      "src/services/receipts.ts",
      "package.json",
    ]);
    // Beside the code, only the tree of its files, in the same order; nothing above it.
    const rail = screen.getByRole("navigation", { name: "Changed files" });
    expect(
      within(rail)
        .getAllByRole("treeitem")
        .flatMap((row) => (row.hasAttribute("aria-selected") ? [row.dataset.key] : [])),
    ).toEqual(["src/routes/orders.ts", "src/services/receipts.ts", "package.json"]);
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.querySelector("[data-layout=map] > div:last-of-type")?.children).toHaveLength(
      2,
    );
    expect(within(mainArea()).getByRole("heading", { name: "Mechanical changes 5" })).toBeTruthy();
    expect(
      within(mainArea())
        .getAllByRole("region", { name: /, lines / })
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual([
      // A file's parts are together, in the file's order.
      "src/routes/orders.ts, lines 1–8",
      "src/routes/orders.ts, lines 10–24",
      expect.stringMatching(/^src\/services\/receipts\.ts, lines 1–/),
      "src/services/receipts.ts, lines 26–39",
      "src/services/receipts.ts, lines 40–50",
      expect.stringMatching(/^package\.json/),
    ]);
  });

  it("shows a mechanical hunk collapsed in its file, expanding to its card", async () => {
    renderReview();
    await loaded();
    const row = within(placeOf(h.formatMoneyRemoved)).getByRole("button", { name: /moved/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(within(placeOf(h.formatMoneyRemoved)).getByRole("region")).toBeTruthy();
  });

  it("marks the calls into code the PR changes, on their parts' lines", async () => {
    renderReview();
    await loaded();
    const calls = (id: PartId) =>
      [...placeOf(id).querySelectorAll("[data-slot=call]")].map((call) => call.textContent);
    expect(calls(h.receiptRoute)).toEqual(["cachedReceipt"]);
    expect(calls(h.receiptFormatting)).toEqual(["formatMoney"]);
  });

  it("opens the code of the call on the focused line with o", async () => {
    renderReview();
    await loaded();
    const call = placeOf(h.receiptRoute).querySelector("[data-slot=call]");
    const number = call?.closest("[role=row]")?.querySelector("button");
    if (!(number instanceof HTMLElement)) throw new Error("no line number beside the call");
    number.focus();
    await userEvent.keyboard("o");
    const peek = await screen.findByLabelText("Code cachedReceipt runs");
    expect(within(peek).getByRole("table", { name: "Lines of cachedReceipt" })).toBeTruthy();
    expect(document.activeElement).toBe(number);
  });

  it("still works when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderReview();
    await loaded();
    await userEvent.keyboard("v");
    expect(layoutIs("overview")).toBe(true);
    await userEvent.keyboard("v");
    expect(fileCards()).toHaveLength(3);
  });
});

describe("points", () => {
  const position = () => within(reviewBar()).getByRole("button", { name: /, show all$/ });
  const step = (name: "Next point" | "Previous point") =>
    userEvent.click(within(reviewBar()).getByRole("button", { name }));

  it("sit under the last of their lines, with a bug on it and the mismatch they show", async () => {
    renderReview();
    await loaded();
    const card = cardOf(h.receiptRoute);
    const finding = within(card).getByRole("article", { name: FINDING });
    expect(comesBefore(lineRow(card, "added line 15"), finding)).toBe(true);
    expect(comesBefore(finding, lineRow(card, "added line 16"))).toBe(true);
    expect(lineRow(card, "added line 15").querySelector("[data-slot=finding-flag]")).not.toBeNull();
    expect(lineRow(card, "added line 21").querySelector("[data-slot=finding-flag]")).toBeNull();
    // The SHOP-142 mismatch is a line of the finding that shows it, not a card of its own.
    expect(finding.textContent).toContain("Contradicts what was asked:");
    expect(screen.queryByRole("article", { name: /^SHOP-142 says/ })).toBeNull();
    expect(finding.querySelector("[data-slot=severity]")?.textContent).toBe("■blocking");
    expect(within(finding).getByText("Suggested change")).toBeTruthy();
  });

  it("link a mismatch's other hunk back to its card", async () => {
    const mismatch: IntentMismatch = {
      kind: "unrequested",
      description: "Adds dayjs, which nobody asked for.",
      hunkIds: [h.receiptFormatting, h.dependency],
    };
    const intent = analysis.intent;
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          intent: intent && { ...intent, mismatches: [...intent.mismatches, mismatch] },
        },
      },
    });
    await loaded();
    const back = within(cardOf(h.dependency)).getByRole("button", { name: mismatch.description });
    await userEvent.click(back);
    expect(scrolledTo().at(-1)).toBe("point-m2");
    expect(pointCard(/Adds dayjs/).dataset.current).toBe("true");
    expect(cardOf(h.dependency).dataset.highlighted === "true").toBe(true);
  });

  it("mark a finding's lines on their numbers", async () => {
    renderReview();
    await loaded();
    const card = cardOf(h.receiptRoute);
    const marked = [...card.querySelectorAll("[data-point-mark]")];
    expect(marked.map((cell) => cell.getAttribute("data-point-mark"))).toEqual(["finding"]);
    // The mark is on the number beside the code, not on the row's edge.
    expect(lineRow(card, "added line 15").getAttribute("data-point")).toBe("finding");
    expect(lineRow(card, "added line 15").className).not.toMatch(/after:/);
  });

  it("add a finding to the review as a draft with its suggestion", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(addToReview(FINDING));
    await waitFor(() => expect(putRequests(requests)).toHaveLength(1));
    expect(putRequests(requests)[0]).toMatchObject({
      url: `${viewPath}/points/f1`,
      body: { state: "raised" },
    });
    expect(within(mainArea()).queryByRole("textbox", { name: /^Comment on/ })).toBeNull();
    const [draft] = JSON.parse(
      window.localStorage.getItem(`megareviewer:hunk-comments:${id}`) ?? "[]",
    );
    expect(draft).toMatchObject({
      hunkId: h.receiptRoute,
      side: "new",
      line: 15,
      suggestion: ["  const order = await findOrder(req.user.id, req.params.id);"],
    });
    expect(draft.body).toMatch(/^Any signed-in user can read every customer's receipt\n\n/);
    // The severity was Claude's: the reviewer's comment carries none.
    expect(draft.severity).toBeUndefined();
    // The card folds above the draft that holds it now.
    expect(pointCard(FINDING).textContent).toContain("In your review, below");
    expect(within(mainArea()).getByText("Draft · posts with your review")).toBeTruthy();
  });

  it("come back as a card when the draft that held them is discarded", async () => {
    renderReview();
    await loaded();
    await userEvent.click(addToReview(FINDING));
    await userEvent.click(within(mainArea()).getByRole("button", { name: "Discard" }));
    expect(addToReview(FINDING)).toBeTruthy();
  });

  it("edit in the comment box first, after what the reviewer already wrote there", async () => {
    window.localStorage.setItem(
      `megareviewer:hunk-comments:${id}`,
      JSON.stringify([{ hunkId: h.receiptRoute, side: "new", line: 15, body: "My words." }]),
    );
    renderReview();
    await loaded();
    await userEvent.click(pointButton("Edit", FINDING));
    const field = within(mainArea()).getByRole("textbox", { name: /^Comment on line 15/ });
    expect((field as HTMLTextAreaElement).value).toMatch(
      /^My words\.\n\nAny signed-in user can read every customer's receipt/,
    );
  });

  it("leave no draft and go back to open when the comment box is cancelled", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(pointButton("Edit", RETRIES));
    await userEvent.click(within(mainArea()).getByRole("button", { name: "Cancel" }));
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
    expect(within(mainArea()).queryByText("Draft · posts with your review")).toBeNull();
    expect(addToReview(RETRIES)).toBeTruthy();
    await waitFor(() =>
      expect(putRequests(requests).at(-1)).toMatchObject({
        url: `${viewPath}/points/f3`,
        body: { state: "open" },
      }),
    );
  });

  it("put back what the reviewer wrote when the box a finding opened is cancelled", async () => {
    window.localStorage.setItem(
      `megareviewer:hunk-comments:${id}`,
      JSON.stringify([{ hunkId: h.receiptRoute, side: "new", line: 15, body: "My words." }]),
    );
    renderReview();
    await loaded();
    await userEvent.click(pointButton("Edit", FINDING));
    await userEvent.click(within(mainArea()).getByRole("button", { name: "Cancel" }));
    const [draft] = JSON.parse(
      window.localStorage.getItem(`megareviewer:hunk-comments:${id}`) ?? "[]",
    );
    expect(draft).toMatchObject({ body: "My words." });
    expect(addToReview(FINDING)).toBeTruthy();
  });

  it("fold to one line when dismissed, and come back", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(pointButton("Dismiss", RETRIES));
    await waitFor(() =>
      expect(putRequests(requests).at(-1)).toMatchObject({
        url: `${viewPath}/points/f3`,
        body: { state: "dismissed" },
      }),
    );
    const folded = screen.getByText("Dismissed").closest("[data-slot=point]");
    expect(folded?.getAttribute("data-state")).toBe("dismissed");
    await userEvent.click(within(folded as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(putRequests(requests).at(-1)?.body).toMatchObject({ state: "open" }),
    );
  });

  it("roll a state back and say why when saving fails", async () => {
    let fail = () => {};
    renderReview({
      respond: (request) =>
        request.method === "PUT"
          ? new Promise((resolve) => {
              fail = () => resolve(failure(500, "internal", "Database locked"));
            })
          : undefined,
    });
    await loaded();
    await userEvent.click(pointButton("Dismiss", RETRIES));
    expect(screen.getByText("Dismissed")).toBeTruthy();
    fail();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Couldn't save what you did with “Retries the tax service back to back”. Database locked.",
    );
    expect(screen.queryByText("Dismissed")).toBeNull();
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("are counted in the bar, and stepped through both ways, round", async () => {
    renderReview();
    await loaded();
    await waitFor(() =>
      expect(
        [...reviewBar().querySelectorAll("[data-slot=point-chip]")].map((chip) =>
          chip.textContent?.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(["3 findings"]),
    );
    // Before the first step, the count; Next goes to the first.
    expect(position().textContent).toBe("3 points");
    expect(position().getAttribute("aria-label")).toBe("3 points, show all");
    await step("Next point");
    expect(scrolledTo().at(-1)).toBe("point-f1");
    expect(position().getAttribute("aria-label")).toBe("Point 1 of 3, show all");
    expect(within(reviewBar()).getByRole("status").textContent).toMatch(
      /^Finding 1 of 3: Any signed-in user can read/,
    );
    expect(
      within(reviewBar()).getByRole("button", { name: /^Go to finding: Any signed-in user/ }),
    ).toBeTruthy();

    await step("Previous point");
    expect(position().textContent).toBe("3 of 3");
    expect(scrolledTo().at(-1)).toBe("point-f3");
    await step("Next point");
    expect(position().textContent).toBe("1 of 3");
    await step("Next point");
    expect(scrolledTo().at(-1)).toBe("point-f2");

    // The title goes back to the point's card.
    await userEvent.click(within(reviewBar()).getByRole("button", { name: /^Go to finding/ }));
    expect(scrolledTo().slice(-2)).toEqual(["point-f2", "point-f2"]);
  });

  it("go to the first with their chip, unless the stepper is on one", async () => {
    renderReview();
    await loaded();
    const chip = await within(reviewBar()).findByRole("button", { name: "3 findings" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(scrolledTo().at(-1)).toBe("point-f1");
    await step("Next point");
    await userEvent.click(chip);
    await userEvent.click(chip);
    expect(position().textContent).toBe("2 of 3");
  });

  it("are listed in full from the position, and a row there is where the stepper goes on", async () => {
    renderReview();
    await loaded();
    await userEvent.click(position());
    const list = screen.getByRole("list", { name: "Points" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);
    await userEvent.click(within(list).getAllByRole("button")[1] as HTMLElement);
    expect(scrolledTo().at(-1)).toBe("point-f2");
    expect(position().textContent).toBe("2 of 3");
    // The card has the focus; closing the list doesn't take it back to the stepper.
    await waitFor(() => expect(document.activeElement?.id).toBe("point-f2"));

    await step("Next point");
    expect(scrolledTo().at(-1)).toBe("point-f3");
  });

  it("keep a dismissed point as a step, struck through", async () => {
    renderReview();
    await loaded();
    await userEvent.click(pointButton("Dismiss", RETRIES));
    await userEvent.click(position());
    const list = screen.getByRole("list", { name: "Points" });
    await userEvent.click(within(list).getByRole("button", { name: RETRIES }));
    const title = within(reviewBar()).getByRole("button", { name: /^Go to finding:/ });
    expect(title.querySelector(".line-through")?.textContent).toMatch(RETRIES);
    expect(within(reviewBar()).getByRole("status").textContent).toMatch(/\(dismissed\)$/);
    await step("Next point");
    await step("Previous point");
    expect(scrolledTo().at(-1)).toBe("point-f3");
  });

  it("keep a finding's lines in view when going to its card, at rest once landed", async () => {
    renderReview();
    await loaded();
    const card = await screen.findByRole("article", { name: FINDING });
    const fold = card.closest("[data-slot=point-fold]");
    // The row before the card's is the last line it rests on, marked.
    expect(fold?.previousElementSibling?.getAttribute("data-point")).toBe("finding");
    expect(Number(card.style.getPropertyValue("--lines-above"))).toBeGreaterThan(0);
    // Opened with its results, the page is at rest: nothing lands.
    expect(document.querySelector("[data-landing]")?.getAttribute("data-landing")).toBe("done");
    expect(fold?.hasAttribute("data-fresh")).toBe(false);
  });

  it("count each file's findings in the tree", async () => {
    renderReview();
    await loaded();
    const row = within(rail())
      .getAllByRole("treeitem")
      .find((item) => item.dataset.key === "src/routes/orders.ts");
    expect(row?.querySelector("[data-slot=finding-count]")).not.toBeNull();
    expect(row?.getAttribute("aria-label")).toContain("1 finding, in src/routes");
  });

  it("can't be acted on once a review is published, which can be followed by another", async () => {
    const receipt: PublicationReceipt = {
      url: "https://github.com/acme/shop/pull/128#pullrequestreview-9",
      publishedAt: "2026-10-22T10:00:00Z",
      postedCommentIds: {},
    };
    renderReview({
      view: {
        ...fixture,
        publication: receipt,
        pointReviews: [
          { pointId: PointId.parse("f1"), state: "raised", updatedAt: "2026-10-22T09:59:00Z" },
        ],
      },
    });
    await loaded();
    expect(screen.getByRole("link", { name: "Published" }).getAttribute("href")).toBe(receipt.url);
    expect(screen.getByRole("button", { name: /^Publish review…/ })).toBeTruthy();
    expect(pointCard(FINDING).dataset.state).toBe("raised");
    expect(addToReview(FINDING).hasAttribute("disabled")).toBe(true);
  });

  it("keeps line comments open after publishing: for the next review, or now", async () => {
    const published: PublicationReceipt = {
      url: "https://github.com/acme/shop/pull/128#pullrequestreview-9",
      publishedAt: "2026-10-22T10:00:00Z",
      postedCommentIds: {},
    };
    const { requests } = renderReview({ view: { ...fixture, publication: published } });
    await loaded();
    const [number] = within(mainArea()).getAllByRole("button", { name: /^Comment on line \d+$/ });
    if (number === undefined) throw new Error("no commentable line");
    const line = Number(number.textContent);
    await userEvent.click(number);
    const box = within(mainArea());
    await userEvent.type(
      box.getByRole("textbox", { name: `Comment on line ${line}` }),
      "Also this.",
    );
    expect(box.getByRole("button", { name: "Add to review" })).toBeTruthy();
    await userEvent.click(box.getByRole("button", { name: "Comment now" }));
    await vi.waitFor(() =>
      expect(
        requests.find((request) => request.url === `${viewPath}/comments`)?.body,
      ).toMatchObject({ line, body: "Also this." }),
    );
  });
});

const openOverview = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Display" }));
  await userEvent.click(await screen.findByRole("menuitemradio", { name: "Understand" }));
  return overviewBox();
};
/** The diagram's file nodes by row, as their labels. */
const overviewRows = () => {
  const rows = new Map<string, string[]>();
  for (const box of overviewBox().querySelectorAll<HTMLElement>(
    "[data-slot=overview-diagram] [data-slot=overview-node-box]",
  )) {
    const label = box.querySelector("[data-slot=overview-label]")?.textContent ?? "";
    rows.set(box.style.top, [...(rows.get(box.style.top) ?? []), label]);
  }
  return [...rows.values()];
};
const nodeOf = (path: string) => {
  const node = overviewBox().querySelector<HTMLElement>(`[data-key="${path}"]`);
  if (node === null) throw new Error(`no node for ${path}`);
  return node;
};
const focusedKey = () => (document.activeElement as HTMLElement | null)?.dataset.key;
const layoutIs = (layout: "map" | "overview") =>
  document.querySelector("[data-slot=review-page]")?.getAttribute("data-layout") === layout;

describe("overview", () => {
  it("draws the changed directories from the entry down, with unlinked ones in the strip", async () => {
    renderReview();
    await loaded();
    await openOverview();
    expect(overviewRows()).toEqual([
      ["src/routes/"],
      ["src/services/"],
      ["email-receipts.ts", "email-receipts.test.ts"],
    ]);
    expect(nodeOf("group:src/routes").getAttribute("aria-label")).toMatch(
      /^src\/routes\/, 1 file, /,
    );
    const strip = within(overviewBox()).getByRole("region", { name: "Not linked" });
    expect(within(strip).getByRole("button", { name: "./, 1 file, logic" })).toBeTruthy();
    // Proved-mechanical files aren't in it: the map lists them with their proofs.
    expect(overviewBox().querySelector('[data-key="pnpm-lock.yaml"]')).toBeNull();
  });

  it("opens a directory's first file in the map on a click, and Esc goes back to it", async () => {
    renderReview();
    await loaded();
    await openOverview();
    await userEvent.click(nodeOf("group:src/services"));
    expect(layoutIs("map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe("file-src/services/receipts.ts");
    await userEvent.keyboard("{Escape}");
    expect(layoutIs("overview")).toBe(true);
    expect(focusedKey()).toBe("group:src/services");
  });

  it("moves between files with the arrows, and Enter opens one", async () => {
    renderReview();
    await loaded();
    await openOverview();
    nodeOf("group:src/routes").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedKey()).toBe("group:src/services");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedKey()).toBe("outside:src/jobs/email-receipts.ts");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedKey()).toBe("group:");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(focusedKey()).toBe("group:src/routes");
    // A focused directory names its files, flows and what it reaches, for the keyboard.
    expect(
      screen.getByText(
        "src/routes/: orders.ts · read in The receipt endpoint · reaches src/services/ (cachedReceipt).",
      ),
    ).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(layoutIs("map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe("file-src/routes/orders.ts");
  });

  it("names what an edge carries", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const edge = overviewBox().querySelector("[data-slot=overview-edge]");
    expect(edge?.getAttribute("data-style") === "call").toBe(true);
    expect(edge?.querySelector("title")?.textContent).toBe(
      "src/routes/ imports, calls src/services/: cachedReceipt",
    );
  });
  it("names what an edge carries on hover, and lights the hovered file's edges", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const edge = overviewBox().querySelector("[data-slot=overview-edge]");
    if (edge === null) throw new Error("no edge");
    await userEvent.hover(edge);
    expect(overviewBox().querySelector("[data-slot=overview-detail]")?.textContent).toBe(
      "src/routes/ imports, calls src/services/: cachedReceipt",
    );
    await userEvent.unhover(edge);
    await userEvent.hover(nodeOf("group:src/services"));
    expect(edge.hasAttribute("data-lit")).toBe(true);
    await userEvent.unhover(nodeOf("group:src/services"));
    expect(screen.getByText(/^Hover or focus a directory/)).toBeTruthy();
  });

  // It renders the large fixture's map first, which takes about 9 s on CI's runners.
  it("draws a large PR by directory, and opens a directory in place", async () => {
    renderReview({ view: largeAnalysisView });
    await screen.findByRole("heading", {
      level: 1,
      name: largeAnalysisView.analysis.pullRequest?.title,
    });
    await openOverview();
    expect(overviewRows()).toEqual([
      ["src/module0/"],
      ["src/module1/"],
      ["src/module2/"],
      ["src/module3/"],
      ["src/module4/"],
      ["src/module5/"],
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Show the files of src/module1/" }));
    expect(overviewBox().querySelector('[data-key="group:src/module1"]')).toBeNull();
    expect(nodeOf("src/module1/part7.ts")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Collapse src/module1/" }));
    expect(nodeOf("group:src/module1")).toBeTruthy();
  }, 30_000);

  it("takes the form chosen in the Display menu, and keeps it", async () => {
    renderReview();
    await loaded();
    await openOverview();
    await userEvent.click(screen.getByRole("button", { name: "Display" }));
    const forms = within(await screen.findByRole("group", { name: "Overview (preview)" }));
    expect(
      forms.getAllByRole("menuitemradio").map((item) => [item.textContent, item.ariaChecked]),
    ).toEqual([
      ["Directories", "true"],
      ["Lanes", "false"],
      ["Bow tie", "false"],
      ["Flow rows", "false"],
    ]);
    await userEvent.click(forms.getByRole("menuitemradio", { name: "Flow rows" }));
    await userEvent.keyboard("{Escape}");
    expect(window.localStorage.getItem("megareviewer:overview-form")).toBe('"rows"');
    expect(screen.queryByRole("region", { name: "Overview of the changed files" })).toBeNull();
    const rows = within(screen.getByRole("region", { name: "Flow paths of the pull request" }));
    // A file outside the pull request that uses its code starts a path; a test outside doesn't.
    const labels = [...document.querySelectorAll("[data-slot=flow-path-label]")].map(
      (label) => label.textContent,
    );
    expect(labels.some((label) => label?.startsWith("email-receipts.ts"))).toBe(true);
    expect(labels.some((label) => label?.includes("email-receipts.test.ts"))).toBe(false);
    // Proved-mechanical files are listed apart, never a stop on a path.
    const also = within(rows.getByRole("region", { name: "Also changed" }));
    expect(also.getByRole("button", { name: "pnpm-lock.yaml" })).toBeTruthy();
    expect(rows.queryByRole("button", { name: /^pnpm-lock, / })).toBeNull();

    const [stop] = rows.getAllByRole("button", { name: /, (changed|new file)/ });
    if (stop === undefined) throw new Error("the fixture has a flow path");
    const path = stop.dataset.path;
    await userEvent.click(stop);
    expect(layoutIs("map")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(layoutIs("overview")).toBe(true);
    expect((document.activeElement as HTMLElement | null)?.dataset.path).toBe(path);
  });

  it.each([
    ["lanes", "Flow paths of the pull request, by directory"],
    ["bow-tie", "Where the change is reached, what it runs through and what it ends in"],
  ])("draws the stored form %s", async (form, name) => {
    window.localStorage.setItem("megareviewer:overview-form", JSON.stringify(form));
    renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Display" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Understand" }));
    expect(screen.getByRole("region", { name })).toBeTruthy();
  });
});

describe("the tour", () => {
  const withTour = () => {
    window.localStorage.setItem("megareviewer:review-layout", '"overview"');
  };
  const tourRegion = () => screen.getByRole("region", { name: "Tour steps" });

  it("is the Understand layout unless the Tour switch is off", async () => {
    const first = renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(await screen.findByRole("menuitemradio", { name: "Understand" })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "Overview" })).toBeNull();
    first.unmount();

    window.localStorage.setItem("megareviewer:tour", "false");
    renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(await screen.findByRole("menuitemradio", { name: "Overview" })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "Understand" })).toBeNull();
  });

  it("shows the steps in order, their points, and what the tour didn't show", async () => {
    withTour();
    renderReview({ view: tourAnalysisView });
    await loaded();
    const steps = within(await screen.findByRole("region", { name: "Tour steps" }));
    expect(steps.getAllByRole("heading", { level: 2 }).map((one) => one.textContent)).toEqual([
      "Step 1: GET /orders/:id/receipt sends an order's receipt as plain text, or a 404",
      "Step 2: cachedReceipt keeps each order's receipt in memory once it's rendered",
      "Step 3: Tax lines are fetched up to 3 times before the receipt fails",
      "Step 4: Receipt lines show prices through formatMoney and dates through dayjs",
      "After the tour",
    ]);
    expect(steps.getByText("lines 14–21 · 8 of 18 changed lines")).toBeTruthy();
    const [firstChip] = steps.getAllByRole("button", { name: /^Finding/ });
    expect(firstChip?.textContent).toContain(
      "Any signed-in user can read every customer's receipt",
    );
    expect(steps.getByText("Not in the tour")).toBeTruthy();
    expect(steps.getByText("Suggested depth")).toBeTruthy();
    const strip = screen.getByRole("group", { name: "Directories on the tour" });
    expect(within(strip).getByRole("button", { name: /^src\/routes\/, step 1/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Overview of the changed files" })).toBeNull();
  });

  it("opens a chip's card in the map", async () => {
    withTour();
    renderReview({ view: tourAnalysisView });
    await loaded();
    const [chip] = within(await screen.findByRole("region", { name: "Tour steps" })).getAllByRole(
      "button",
      { name: /^Finding/ },
    );
    if (chip === undefined) throw new Error("no chip");
    await userEvent.click(chip);
    await waitFor(() => expect(layoutIs("map")).toBe(true));
  });

  it("keeps a comment on a step's line as a draft of the review, which the map shows", async () => {
    withTour();
    renderReview({ view: tourAnalysisView });
    await loaded();
    const region = await screen.findByRole("region", { name: "Tour steps" });
    const [number] = within(region).getAllByRole("button", { name: /^Comment on line \d+$/ });
    if (number === undefined) throw new Error("no commentable line");
    const line = Number(number.textContent);
    await userEvent.click(number);
    await userEvent.type(
      within(region).getByRole("textbox", { name: `Comment on line ${line}` }),
      "Why here?",
    );
    await userEvent.click(within(region).getByRole("button", { name: "Add to review" }));
    const stored = z
      .array(z.object({ line: z.number(), body: z.string() }).passthrough())
      .parse(JSON.parse(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`) ?? "[]"));
    expect(stored).toMatchObject([{ line, body: "Why here?" }]);

    await userEvent.keyboard("v");
    await waitFor(() => expect(layoutIs("map")).toBe(true));
    expect(within(mainArea()).getByText("Why here?")).toBeTruthy();
  });

  it("opens a step in the map, marked and labelled, and comes back to it with Esc", async () => {
    withTour();
    renderReview({ view: tourAnalysisView });
    await loaded();
    const region = await screen.findByRole("region", { name: "Tour steps" });
    await userEvent.click(
      within(region).getByRole("button", {
        name: "Open src/services/receipts.ts lines 41–50 in code",
      }),
    );
    await waitFor(() => expect(layoutIs("map")).toBe(true));
    expect(screen.getByRole("button", { name: "Back to tour · Step 2" })).toBeTruthy();
    const label = document.querySelector("[data-slot=tour-landing]");
    expect(label?.textContent).toContain("Tour step 2");
    // The label is what the map scrolls to, not the top of the part it's in.
    expect(scrolledTo().at(-1)).toBe(label?.id);
    expect(document.querySelectorAll("[data-point-mark=step]").length).toBeGreaterThan(0);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(layoutIs("overview")).toBe(true));
    expect(document.activeElement?.textContent).toContain("Step 2:");
    expect(screen.queryByRole("button", { name: "Back to tour · Step 2" })).toBeNull();
    // The step it came back to is the current one.
    const current = document.querySelector("[data-slot=tour-step][aria-current=step]");
    expect(current?.textContent).toContain("cachedReceipt keeps each order's receipt");
    expect(
      screen.getByRole("button", { name: /^src\/services\/, steps 2, 3 and 4, current step$/ }),
    ).toBeTruthy();
  });

  it("switches with v between the tour's current step and its lines in the map", async () => {
    withTour();
    window.sessionStorage.clear();
    renderReview({ view: tourAnalysisView });
    await loaded();
    await screen.findByRole("region", { name: "Tour steps" });
    window.sessionStorage.setItem(`megareviewer:tour-step:${id}`, "3");
    await userEvent.keyboard("v");
    await waitFor(() => expect(layoutIs("map")).toBe(true));
    expect(screen.getByRole("button", { name: "Back to tour · Step 3" })).toBeTruthy();
    await userEvent.keyboard("v");
    await waitFor(() => expect(layoutIs("overview")).toBe(true));
    expect(document.activeElement?.textContent).toContain("Step 3:");
  });

  it("is opened from the brief's link, which shows only with a tour", async () => {
    renderReview({ view: tourAnalysisView });
    await loaded();
    expect(layoutIs("map")).toBe(true);
    await userEvent.click(await screen.findByRole("button", { name: "Tour · 4 steps" }));
    await waitFor(() => expect(layoutIs("overview")).toBe(true));
    expect(screen.getByRole("region", { name: "Tour steps" })).toBeTruthy();
  });

  it("is the overview and a line saying why, without a tour", async () => {
    withTour();
    const first = renderReview();
    await loaded();
    expect(
      await screen.findByText("This AI review ran without the tour. Re-run it to get one."),
    ).toBeTruthy();
    expect(overviewBox()).toBeTruthy();
    first.unmount();

    renderReview({
      view: {
        ...codeOnly,
        analysis: {
          ...codeOnly.analysis,
          stages: { ...codeOnly.analysis.stages, findings: "skipped" },
          usage: [],
          modelCalls: [],
        },
      },
    });
    await loaded();
    expect(await screen.findByText(/^No AI review yet\. The tour/)).toBeTruthy();
    expect(overviewBox()).toBeTruthy();
    expect(() => tourRegion()).toThrow();
  });
});

describe("layouts", () => {
  it("are chosen in the Display menu, which shows the one in use", async () => {
    renderReview();
    await loaded();
    expect(screen.queryByRole("group", { name: "Layout" })).toBeNull();
    const display = screen.getByRole("button", { name: "Display" });
    await userEvent.click(display);
    const map = await screen.findByRole("menuitemradio", { name: "Map" });
    expect(map.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Understand" }));
    expect(overviewBox()).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // The overview takes the focus to the file in view; closing doesn't hand it back to the menu.
    expect(document.activeElement).not.toBe(display);
    await userEvent.click(display);
    expect(
      (await screen.findByRole("menuitemradio", { name: "Understand" })).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("switch with v, keeping the file the reviewer is on", async () => {
    renderReview();
    await loaded();
    await userEvent.click(cardOf(h.routeImports));
    expect(focusedLabel()).toMatch(IMPORTS);
    await userEvent.keyboard("v");
    expect(layoutIs("overview")).toBe(true);
    expect(focusedKey()).toBe("group:src/routes");

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("v");
    expect(layoutIs("map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe("file-src/services/receipts.ts");
    expect(focusedLabel()).toBe("src/services/receipts.ts");
  });

  it("remember the choice for every PR, and read a stored call tree as the overview", async () => {
    const first = renderReview();
    await loaded();
    await openOverview();
    expect(window.localStorage.getItem("megareviewer:review-layout")).toBe('"overview"');
    first.unmount();

    window.localStorage.setItem("megareviewer:review-layout", '"tree"');
    renderReview();
    await loaded();
    expect(overviewBox()).toBeTruthy();
    expect(layoutIs("overview")).toBe(true);
  });
});

describe("keyboard shortcuts", () => {
  it("move between files with n and p, from the focused one", async () => {
    renderReview();
    await loaded();
    await userEvent.click(cardOf(h.routeImports));
    await userEvent.keyboard("n");
    expect(scrolledTo().at(-1)).toBe("file-src/services/receipts.ts");
    expect(focusedLabel()).toBe("src/services/receipts.ts");
    await userEvent.keyboard("n");
    expect(scrolledTo().at(-1)).toBe("file-package.json");
    // There's no file after the last.
    await userEvent.keyboard("n");
    expect(scrolledTo().at(-1)).toBe("file-package.json");
    await userEvent.keyboard("pp");
    expect(scrolledTo().at(-1)).toBe("file-src/routes/orders.ts");
  });

  it("open a comment on the focused hunk's first changed line with c", async () => {
    renderReview();
    await loaded();
    await userEvent.click(cardOf(h.receiptRoute));
    await userEvent.keyboard("c");
    const field = within(mainArea()).getByRole("textbox", { name: /^Comment on line / });
    expect(document.activeElement).toBe(field);
  });

  it("are listed for each layout, and none fire while the list is open", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const keysOf = (name: string) =>
      within(within(dialog).getByRole("region", { name }))
        .getAllByRole("definition")
        .map((keys) => keys.textContent);
    expect(keysOf("In the code")).toEqual(["n", "p", "c", "o"]);
    expect(keysOf("In the overview")).toEqual(["←→↑↓", "↵"]);
    expect(keysOf("Anywhere")).toEqual(["v", "⇧R", "Esc", "?"]);
    await userEvent.keyboard("v");
    expect(layoutIs("map")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("parts of a split hunk", () => {
  it("sit next to each other on their file's card, which names no definitions", async () => {
    renderReview();
    await loaded();
    const cache = cardOf(p.cache);
    // The code names what the part defines.
    expect(cache.querySelector("[data-slot=hunk-part]")).toBeNull();
    expect(within(cache).queryByText("Related parts")).toBeNull();
    // No lines lie between the two parts of one hunk, so no fold either.
    expect(placeOf(p.retry).nextElementSibling).toBe(placeOf(p.cache));
    // Nor a divider: the lines run on as in the diff.
    expect(placeOf(p.cache).classList.contains("border-t")).toBe(false);
  });

  it("put a point on the part showing its lines, with no link from the rest of its hunk", async () => {
    renderReview();
    await loaded();
    expect(within(cardOf(p.retry)).getByRole("article", { name: RETRIES })).toBeTruthy();
    expect(within(cardOf(p.cache)).queryByRole("article", { name: RETRIES })).toBeNull();
    expect(cardOf(p.cache).querySelector("[data-slot=point-mention]")).toBeNull();
  });

  it("show a comment in the part that holds its line", async () => {
    window.localStorage.setItem(
      `megareviewer:hunk-comments:${id}`,
      JSON.stringify([{ hunkId: h.retryAndCache, side: "new", line: 45, body: "Evict these." }]),
    );
    renderReview();
    await loaded();
    expect(cardOf(p.cache).querySelector("[data-slot=line-comment]")?.textContent).toContain(
      "Evict these.",
    );
    expect(cardOf(p.retry).querySelector("[data-slot=line-comment]")).toBeNull();
  });
});

describe("navigation", () => {
  it("never show contract, on a file's card or its parts", async () => {
    renderReview();
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    expect(orders.querySelector("[data-slot=file-card-header]")?.textContent).not.toMatch(
      /contract/,
    );
    expect(orders.querySelector("[data-slot=hunk-contract-reason]")).toBeNull();
    expect(cardOf(h.receiptRoute).querySelector("[data-slot=hunk-header]")).toBeNull();
    expect(cardOf(h.routeImports).querySelector("[data-slot=hunk-header]")).toBeNull();
    expect(within(cardOf(h.receiptRoute)).queryByRole("button", { name: "contract" })).toBeNull();
    expect(cardOf(h.receiptRoute).querySelector("[data-slot=part-risk]")).toBeNull();
  });

  it("name a file on its card without a status for modified, a part count or a Reviewed mark", async () => {
    renderReview();
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    expect(orders.querySelector("[data-slot=file-status]")).toBeNull();
    expect(orders.querySelector("[data-slot=file-card-header]")?.textContent).not.toMatch(/part/);
    expect(within(orders).queryByRole("checkbox")).toBeNull();
    // The line between the imports and the route is a fold.
    const gap = orders.querySelector("[data-slot=file-gap]");
    expect(gap?.textContent).toBe("1 line unchanged");
    expect(gap?.querySelector("[data-slot=unfold-icon]")).not.toBeNull();
  });

  it("open a card's folds whole on a click, fetching the file once", async () => {
    const user = userEvent.setup();
    const { requests } = renderReview();
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    const folds = () =>
      [...orders.querySelectorAll("[data-slot=file-gap]")].map((gap) => gap.textContent);
    const fileRequests = () => requests.filter((request) => request.url.includes("/files/"));
    expect(folds()).toEqual(["1 line unchanged", "4 lines unchanged", "Unchanged lines below"]);
    expect(fileRequests()).toEqual([]);

    // Below the last part the file's length isn't known until it's fetched.
    await user.click(within(orders).getByRole("button", { name: "Unchanged lines below" }));
    await waitFor(() => expect(within(orders).getByText("// unchanged line 64")).toBeTruthy());
    expect(folds()).toEqual(["1 line unchanged", "4 lines unchanged"]);
    // Both numbers: the PR removed 6 lines above it.
    const row = within(orders).getByText("// unchanged line 35").closest("[role=row]");
    expect(row?.textContent).toMatch(/^2935/);

    await user.click(within(orders).getByRole("button", { name: "4 lines unchanged" }));
    expect(folds()).toEqual(["1 line unchanged"]);
    expect(within(orders).getByText("// unchanged line 25")).toBeTruthy();
    expect(fileRequests().map((request) => request.url)).toEqual([
      `/api/analyses/${id}/files/head/src%2Froutes%2Forders.ts`,
    ]);
  });

  it("scroll a card's lines sideways as one, its parts and opened folds together", async () => {
    const user = userEvent.setup();
    renderReview();
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    await user.click(within(orders).getByRole("button", { name: "4 lines unchanged" }));
    await within(orders).findByText("// unchanged line 25");
    // A suggestion in a finding's card scrolls on its own, as a thread's does.
    const scrollers = [...orders.querySelectorAll(".overflow-x-auto")].filter(
      (one) => one.closest("[data-slot=point-fold], [data-slot=line-row]") === null,
    );
    expect(scrollers.map((one) => one.getAttribute("data-slot"))).toEqual(["file-lines"]);
    // What isn't a line stays at the visible width while the lines scroll under it.
    expect(orders.querySelector("[data-slot=file-gap]")?.className).toMatch(/sticky left-0/);
  });

  it("say on the fold when its file can't be fetched", async () => {
    const user = userEvent.setup();
    renderReview({
      respond: (request) =>
        request.url.includes("/files/")
          ? failure(502, "host-error", "GitHub returned 500")
          : undefined,
    });
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    await user.click(within(orders).getByRole("button", { name: "4 lines unchanged" }));
    expect((await within(orders).findByRole("alert")).textContent).toMatch(/GitHub returned 500/);
    // Clicking again tries again.
    expect(within(orders).getByRole("button", { name: "4 lines unchanged" })).toBeTruthy();
  });
});

describe("without the model", () => {
  const withoutModel: AnalysisView = {
    ...fixture,
    analysis: {
      ...analysis,
      intent: null,
      findings: [],
      stages: {
        ...analysis.stages,
        intent: "skipped",
        findings: "skipped",
        steps: "skipped",
      },
      pullRequest:
        analysis.pullRequest === null
          ? null
          : {
              ...analysis.pullRequest,
              description: "\nAdds receipts. <b>Not bold</b>\n\nMoves formatMoney too.",
            },
    },
  };

  it("shows the title and the description's first sentence, rule marks only, and no points", async () => {
    renderReview({ view: withoutModel });
    await loaded();
    // Markup is text, and doesn't start a sentence.
    expect(screen.getByText("Adds receipts. <b>Not bold</b>")).toBeTruthy();
    expect(screen.queryByText(/Moves formatMoney too/)).toBeNull();
    expect(document.querySelector("[data-slot=point-chip]")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("offers Publish, since the reviewer's own verdict is a review in itself", async () => {
    renderReview({ view: { ...withoutModel, isAuthor: true } });
    await loaded();
    // It's in the bar, in reach wherever the page is scrolled, and counts what will post.
    const publish = screen.getByRole("button", { name: /^Publish review…/ });
    expect(publish.dataset.slot).toBe("publish-button");
    expect(reviewBar().contains(publish)).toBe(true);
    expect(publish.textContent).not.toContain("to post");

    window.localStorage.setItem(
      `megareviewer:hunk-comments:${id}`,
      JSON.stringify([{ hunkId: h.receiptRoute, side: "new", line: 12, body: "Check the owner." }]),
    );
    renderReview({ view: { ...withoutModel, isAuthor: true } });
    await loaded();
    expect(
      screen.getAllByRole("button", { name: /^Publish review…/ }).at(-1)?.textContent,
    ).toContain("1 to post");
  });

  it("shows what was asked in full, as text, in the details", async () => {
    renderReview({ view: withoutModel });
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const asked = screen.getByRole("dialog", { name: "What was asked" });
    expect(
      within(asked).getByText(/^Adds receipts\. <b>Not bold<\/b>\s+Moves formatMoney too\.$/),
    ).toBeTruthy();
    expect(within(asked).getByText(/^SHOP-142 · /)).toBeTruthy();
    expect(within(asked).getByText("Commits (3)")).toBeTruthy();
  });
});

describe("comments on hunks", () => {
  it("posts a comment now, as a thread of its own, without keeping a draft", async () => {
    const { requests } = renderReview();
    await loaded();
    const [number] = within(mainArea()).getAllByRole("button", { name: /^Comment on line \d+$/ });
    if (number === undefined) throw new Error("no commentable line");
    const line = Number(number.textContent);
    await userEvent.click(number);
    await userEvent.type(
      within(mainArea()).getByRole("textbox", { name: `Comment on line ${line}` }),
      "Why this?",
    );
    await userEvent.click(within(mainArea()).getByRole("button", { name: "Comment now" }));
    await vi.waitFor(() =>
      expect(
        within(mainArea()).queryByRole("textbox", { name: `Comment on line ${line}` }),
      ).toBeNull(),
    );
    const posted = requests.find((request) => request.url === `${viewPath}/comments`);
    expect(posted?.body).toMatchObject({ side: "new", line, body: "Why this?" });
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
  });

  it("writes a comment from a line number, keeps it, and publishes it", async () => {
    const { requests, unmount } = renderReview();
    await loaded();
    const [number] = within(mainArea()).getAllByRole("button", { name: /^Comment on line \d+$/ });
    if (number === undefined) throw new Error("no commentable line");
    const line = Number(number.textContent);
    await userEvent.click(number);
    await userEvent.type(
      within(mainArea()).getByRole("textbox", { name: `Comment on line ${line}` }),
      "Why this?",
    );
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toContain("Why this?");

    unmount();
    const again = renderReview();
    await loaded();
    // It's back as the comment it will be, until it's edited.
    const saved = mainArea().querySelector<HTMLElement>("[data-slot=line-comment]");
    if (saved === null) throw new Error("no draft");
    expect(within(saved).getByText("Why this?")).toBeTruthy();
    await userEvent.click(within(saved).getByRole("button", { name: "Edit" }));
    const field = within(mainArea()).getByRole<HTMLTextAreaElement>("textbox", {
      name: `Comment on line ${line}`,
    });
    expect(field.value).toBe("Why this?");

    await userEvent.click(screen.getByRole("button", { name: /^Publish review…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Publish review" });
    expect(await within(dialog).findByText("Why this?")).toBeTruthy();
    expect(within(dialog).queryByRole("radio")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish 1 comment" }));
    // The view here is fixed, so it never turns published; the request is what matters.
    await waitFor(() =>
      expect(
        again.requests.find((request) => request.url === `${viewPath}/publication`)?.body,
      ).toMatchObject({ hunkComments: [{ side: "new", line, body: "Why this?" }] }),
    );
    expect(requests.some((request) => request.url === `${viewPath}/publication`)).toBe(false);
  });

  it("removes a comment that's emptied, and c opens one on the focused hunk", async () => {
    renderReview();
    await loaded();
    await userEvent.click(cardOf(h.routeImports));
    await userEvent.keyboard("c");
    const field = within(mainArea()).getByRole("textbox", { name: /^Comment on (old )?line \d+$/ });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "x");
    await userEvent.clear(field);
    // Esc leaves the box.
    await userEvent.keyboard("{Escape}");
    expect(within(mainArea()).queryByRole("textbox", { name: /^Comment on/ })).toBeNull();
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
  });
});

describe("publishing", () => {
  const openDialog = async () => {
    await userEvent.click(screen.getByRole("button", { name: /^Publish review…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Publish review" });
    await waitFor(() => expect(within(dialog).queryByText("Reading the comments…")).toBeNull());
    return dialog;
  };

  it("shows a finding added to the review as it'll post, the verdict, and nothing else", async () => {
    renderReview();
    await loaded();
    await userEvent.click(addToReview(FINDING));
    const dialog = await openDialog();
    const comments = within(dialog).getAllByRole("listitem");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.textContent).toContain(
      "Any signed-in user can read every customer's receipt",
    );
    expect(comments[0]?.textContent).toContain("src/routes/orders.ts:15");
    expect(
      within(within(dialog).getByRole("group", { name: "Verdict" })).getAllByRole("button").length,
    ).toBe(3);
    expect(within(dialog).queryByText(/Reviewed with megareviewer|on the code/)).toBeNull();
    expect(within(dialog).getByLabelText("Summary").getAttribute("placeholder")).toBe(
      "Summary (optional)",
    );
  });

  it("posts the verdict the reviewer picks", async () => {
    const { requests } = renderReview();
    await loaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Request changes" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Publish and request changes" }),
    );
    expect(await screen.findByRole("link", { name: "Changes requested" })).toBeTruthy();
    expect(
      requests.find((request) => request.url === `${viewPath}/publication`)?.body,
    ).toMatchObject({ verdict: "request_changes" });
  });

  /** Picks Approve and publishes: with nothing to say, an approval is the review. */
  const approve = async (dialog: HTMLElement) => {
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish and approve" }));
  };

  it("publishes, closes and shows the link to the review", async () => {
    const { requests } = renderReview();
    await loaded();
    await approve(await openDialog());
    expect(await screen.findByRole("link", { name: "Approved" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The drafts posted with it are threads on the host now.
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
    expect(requests.find((request) => request.url === `${viewPath}/publication`)?.body).toEqual({
      publicationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      summary: "",
      allowStale: false,
      hunkComments: [],
      verdict: "approve",
    });
    expect(addToReview(RETRIES).hasAttribute("disabled")).toBe(true);
  });

  it("publishes another review after one, under a new ID", async () => {
    const { requests } = renderReview();
    await loaded();
    const first = await openDialog();
    await userEvent.type(within(first).getByLabelText("Summary"), "One question first.");
    await userEvent.click(within(first).getByRole("button", { name: "Publish the summary" }));
    expect(await screen.findByRole("link", { name: "Commented" })).toBeTruthy();

    const second = await openDialog();
    expect(within(second).getByText(/^Your earlier review is on the pull request\./)).toBeTruthy();
    await approve(second);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [one, two] = requests
      .filter((request) => request.url === `${viewPath}/publication`)
      .map((request) =>
        z.object({ publicationId: z.string(), verdict: z.string() }).parse(request.body),
      );
    expect([one?.verdict, two?.verdict]).toEqual(["comment", "approve"]);
    expect(two?.publicationId).not.toBe(one?.publicationId);
  });

  it("can't publish a comment with nothing in it, and says what would", async () => {
    renderReview();
    await loaded();
    const dialog = await openDialog();
    const publish = within(dialog).getByRole("button", { name: "Publish the summary" });
    expect(publish.hasAttribute("disabled")).toBe(true);
    expect(publish.getAttribute("aria-describedby")).not.toBeNull();
    expect(
      within(dialog).getByText(
        "Nothing to post yet: write a summary, or approve or request changes.",
      ),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(
      within(dialog).getByRole("button", { name: "Publish and approve" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(within(dialog).queryByText(/^Nothing to post yet/)).toBeNull();
  });

  it("on the reviewer's own PR, shows the verdict and why it can only comment", async () => {
    const { requests } = renderReview({ view: { ...fixture, isAuthor: true } });
    await loaded();
    const dialog = await openDialog();
    const verdicts = within(within(dialog).getByRole("group", { name: "Verdict" }));
    expect(verdicts.getByRole("button", { name: "Comment" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    for (const name of ["Approve", "Request changes"]) {
      expect(verdicts.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
    expect(within(dialog).getByText(/^You opened this pull request/)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Summary"), "Notes for reviewers.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish the summary" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.url === `${viewPath}/publication`)?.body,
      ).toMatchObject({ verdict: "comment", summary: "Notes for reviewers." }),
    );
  });

  it("asks before publishing on a PR that changed since the analysis", async () => {
    const { requests } = renderReview({
      respond: (request) =>
        request.url === `${viewPath}/publication` &&
        typeof request.body === "object" &&
        request.body !== null &&
        "allowStale" in request.body &&
        request.body.allowStale === false
          ? failure(409, "stale-analysis", "The PR has new commits")
          : undefined,
    });
    await loaded();
    const dialog = await openDialog();
    await approve(dialog);
    expect(
      await within(dialog).findByText("This PR changed since the analysis. Publish anyway?"),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish anyway" }));
    expect(await screen.findByRole("link", { name: "Approved" })).toBeTruthy();
    const publishes = requests.filter((request) => request.url === `${viewPath}/publication`);
    const publicationId = expect.stringMatching(/^[0-9a-f-]{36}$/);
    const review = { publicationId, summary: "", hunkComments: [], verdict: "approve" };
    expect(publishes.map((request) => request.body)).toEqual([
      { ...review, allowStale: false },
      { ...review, allowStale: true },
    ]);
    // Both are the one review: the same ID, so the server posts it once.
    const [first, second] = publishes.map((request) =>
      z.object({ publicationId: z.string() }).parse(request.body),
    );
    expect(second?.publicationId).toBe(first?.publicationId);
  });

  it("shows why publishing failed and retries", async () => {
    let attempts = 0;
    renderReview({
      respond: (request) => {
        if (request.url !== `${viewPath}/publication`) return undefined;
        attempts += 1;
        return attempts === 1 ? failure(502, "host-error", "GitHub returned 502") : undefined;
      },
    });
    await loaded();
    const dialog = await openDialog();
    await approve(dialog);
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("The git host returned an error: GitHub returned 502.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Approved" })).toBeTruthy();
  });

  it("closes with Cancel without publishing", async () => {
    const { requests } = renderReview();
    await loaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.some((request) => request.url === `${viewPath}/publication`)).toBe(false);
  });
});

describe("the bar's verdicts", () => {
  const approveButton = () => within(reviewBar()).getByRole("button", { name: "Approve" });
  const publishButton = () => within(reviewBar()).getByRole("button", { name: /^Publish review…/ });

  it("fills Approve once Claude's run is done and nothing waits, and approves at once", async () => {
    const { requests } = renderReview();
    await loaded();
    expect(approveButton().className).toContain("bg-review-approved");
    expect(publishButton().className).toContain("border-border");
    // The main action is last.
    expect(comesBefore(publishButton(), approveButton())).toBe(true);

    await userEvent.click(approveButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await within(reviewBar()).findByRole("link", { name: "Approved" })).toBeTruthy();
    expect(requests.find((request) => request.url === `${viewPath}/publication`)?.body).toEqual({
      publicationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      summary: "",
      allowStale: true,
      hunkComments: [],
      verdict: "approve",
    });
  });

  it("approves a PR with new commits at once, from an outline button", async () => {
    const { requests } = renderReview({ view: { ...fixture, stale: true } });
    await loaded();
    expect(approveButton().getAttribute("aria-disabled")).not.toBe("true");
    expect(approveButton().className).not.toContain("bg-review-approved");

    await userEvent.click(approveButton());
    expect(
      await within(reviewBar()).findByRole("button", { name: "Revoke approval" }),
    ).toBeTruthy();
    expect(
      requests.find((request) => request.url === `${viewPath}/publication`)?.body,
    ).toMatchObject({ allowStale: true, hunkComments: [], verdict: "approve" });
  });

  it("fills Publish while comments wait, and approving leaves them for the next review", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(addToReview(FINDING));
    expect(publishButton().className).toContain("bg-primary");
    expect(publishButton().textContent).toContain("1 to post");
    expect(approveButton().className).not.toContain("bg-review-approved");
    expect(comesBefore(approveButton(), publishButton())).toBe(true);

    await userEvent.click(approveButton());
    expect(await within(reviewBar()).findByRole("link", { name: "Approved" })).toBeTruthy();
    expect(
      requests.find((request) => request.url === `${viewPath}/publication`)?.body,
    ).toMatchObject({ hunkComments: [], verdict: "approve" });
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toContain(
      "Any signed-in user can read",
    );
  });

  it("turns Approve into Revoke approval while the reviewer's approval stands, and back", async () => {
    // Approved on the host's own page, on an analysis since outdated: it can still be taken back.
    let approved = true;
    const { requests } = renderReview({
      view: { ...fixture, stale: true },
      respond: (request) => {
        if (request.method === "DELETE" && request.url === `${viewPath}/approval`) {
          approved = false;
          return jsonResponse(200, {});
        }
        if (request.url !== statusPath || !approved) return undefined;
        return jsonResponse(200, {
          ...fixturePullRequestStatus,
          reviewers: [
            ...fixturePullRequestStatus.reviewers,
            { id: "lee-park", name: "Lee Park", team: false, verdict: "approved" },
          ],
        });
      },
    });
    await loaded();
    const revoke = await within(reviewBar()).findByRole("button", { name: "Revoke approval" });
    expect(revoke.getAttribute("aria-disabled")).toBeNull();
    expect(revoke.className).not.toContain("bg-review-approved");
    // An approval is the whole review: no Publish, and no link, since it wasn't sent from here.
    const verdict = () => reviewBar().querySelector("[data-slot=your-verdict]");
    expect(verdict()?.textContent).toBe("Approved");
    expect(verdict()?.querySelector("a")).toBeNull();
    expect(within(reviewBar()).queryByRole("button", { name: /^Publish review…/ })).toBeNull();

    await userEvent.click(revoke);
    const approve = await within(reviewBar()).findByRole("button", { name: "Approve" });
    expect(approve.getAttribute("aria-disabled")).not.toBe("true");
    expect(verdict()).toBeNull();
    expect(within(reviewBar()).getByRole("button", { name: /^Publish review…/ })).toBeTruthy();
    expect(
      requests.filter(
        (request) => request.method === "DELETE" && request.url === `${viewPath}/approval`,
      ),
    ).toHaveLength(1);
  });

  it("brings Publish back beside Revoke approval once a comment waits", async () => {
    renderReview({
      respond: (request) =>
        request.url === statusPath
          ? jsonResponse(200, {
              ...fixturePullRequestStatus,
              reviewers: [{ id: "lee-park", name: "Lee Park", team: false, verdict: "approved" }],
            })
          : undefined,
    });
    await loaded();
    const revoke = await within(reviewBar()).findByRole("button", { name: "Revoke approval" });
    await userEvent.click(addToReview(FINDING));
    expect(publishButton().className).toContain("bg-primary");
    expect(comesBefore(revoke, publishButton())).toBe(true);
  });

  it("says the reviewer requested changes, and doesn't fill Approve after it", async () => {
    renderReview({
      respond: (request) =>
        request.url === statusPath
          ? jsonResponse(200, {
              ...fixturePullRequestStatus,
              reviewers: [
                { id: "lee-park", name: "Lee Park", team: false, verdict: "changes-requested" },
              ],
            })
          : undefined,
    });
    await loaded();
    expect(await within(reviewBar()).findByText("Changes requested")).toBeTruthy();
    expect(approveButton().className).not.toContain("bg-review-approved");
  });

  it("says why an approval couldn't be revoked", async () => {
    renderReview({
      respond: (request) => {
        if (request.method === "DELETE") {
          return failure(502, "host-error", "Must have admin rights.");
        }
        if (request.url !== statusPath) return undefined;
        return jsonResponse(200, {
          ...fixturePullRequestStatus,
          reviewers: [{ id: "lee-park", name: "Lee Park", team: false, verdict: "approved" }],
        });
      },
    });
    await loaded();
    await userEvent.click(
      await within(reviewBar()).findByRole("button", { name: "Revoke approval" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't revoke the approval. The git host returned an error: Must have admin rights.",
    );
  });

  it("disables Approve on the reviewer's own PR and says why", async () => {
    const { requests } = renderReview({ view: { ...fixture, isAuthor: true } });
    await loaded();
    expect(approveButton().getAttribute("aria-disabled")).toBe("true");
    expect(description(approveButton())).toBe(
      "You opened this pull request, and its author can't approve it.",
    );
    await userEvent.click(approveButton());
    expect(requests.some((request) => request.url === `${viewPath}/publication`)).toBe(false);
  });

  it("fills nothing before Claude runs, and says what a run would cover", async () => {
    renderReview({
      view: {
        ...codeOnly,
        analysis: {
          ...codeOnly.analysis,
          stages: { ...codeOnly.analysis.stages, findings: "skipped" },
          usage: [],
        },
      },
    });
    await loaded();
    expect(approveButton().className).not.toContain("bg-review-approved");
    expect(publishButton().className).toContain("border-border");
    expect(reviewBar().textContent).toContain("No AI review yetFind bugs across 7 files");
    expect(
      within(reviewBar()).getByRole("button", { name: "Request AI review" }).className,
    ).toContain("bg-ai-soft");
  });

  it("asks for no tour with a run once the Display menu's Tour switch is off", async () => {
    const { requests } = renderReview({
      view: codeOnly,
      respond: (request) =>
        request.url === `${viewPath}/model` ? jsonResponse(200, { analysisId: id }) : undefined,
    });
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Display" }));
    const tour = await screen.findByRole("menuitemcheckbox", { name: "Tour (preview)" });
    expect(tour.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(tour);
    expect(window.localStorage.getItem("megareviewer:tour")).toBe("false");
    await userEvent.keyboard("{Escape}");

    const button = within(reviewBar()).getByRole("button", { name: "Request AI review" });
    await waitFor(() => expect(description(button)).toContain("Sonnet 5.5"));
    await userEvent.click(button);
    expect(requests.find((request) => request.url === `${viewPath}/model`)?.body).toEqual({
      optionId: "claude-code/claude-sonnet-5-5",
    });
  });

  it("re-runs Claude after asking: takes the run off and runs the chosen model again", async () => {
    let running = false;
    const { requests } = renderReview({
      respond: (request) => {
        if (request.url !== viewPath && request.url !== `${viewPath}/model`) return undefined;
        if (request.method === "POST") {
          running = true;
          return jsonResponse(200, { analysisId: id });
        }
        return request.method === "GET" && running
          ? jsonResponse(200, { ...fixture, analysis: analysisInProgress(analysis, 2) })
          : undefined;
      },
    });
    await loaded();
    await userEvent.click(within(reviewBar()).getByRole("button", { name: "Re-run" }));
    const dialog = await screen.findByRole("dialog", { name: "Re-run AI review" });
    expect(dialog.textContent).toContain("Sonnet 5.5 through Claude Code, on your Pro plan");
    await userEvent.click(within(dialog).getByRole("button", { name: "Re-run" }));

    expect(await within(reviewBar()).findByRole("button", { name: /^Reviewing · / })).toBeTruthy();
    const model = requests.filter((request) => request.url === `${viewPath}/model`);
    expect(model.map((request) => request.method)).toEqual(["DELETE", "POST"]);
    expect(model[1]?.body).toEqual({ optionId: "claude-code/claude-sonnet-5-5", tour: true });
    expect(screen.queryByRole("status", { name: "Loading the analysis" })).toBeNull();
  });
});

describe("outside the pull request", () => {
  const withCheckout = (checkout: AnalysisView["analysis"]["checkout"]): AnalysisView => ({
    ...fixture,
    analysis: { ...analysis, checkout, unchangedCallers: [] },
  });

  it("counts a changed definition's uses on its card, and lists each with the lines around it", async () => {
    renderReview();
    await loaded();
    const card = cardOf(h.receiptFormatting);
    const toggle = within(card).getByRole("button", {
      name: "Used unchanged in 1 place and 1 test",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const uses = [...card.querySelectorAll("[data-slot=unchanged-use]")];
    expect(
      uses.map((use) => use.querySelector("[data-slot=unchanged-place]")?.textContent),
    ).toEqual(["src/jobs/email-receipts.ts:14", "test/jobs/email-receipts.test.ts:31"]);
    const used = uses[0]?.querySelector("[data-slot=unchanged-line][data-used]");
    expect(used?.textContent).toBe("14    const text = await renderReceipt(order);");
    expect(uses[0]?.querySelectorAll("[data-slot=unchanged-line]")).toHaveLength(5);
    // Only the card of the part that changes the definition says so.
    expect(within(cardOf(h.receiptRoute)).queryByText(/Used unchanged/)).toBeNull();
  });

  it("shows a faded node per caller file in the overview, opening the code it uses", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const outside = nodeOf("outside:src/jobs/email-receipts.ts");
    expect(outside.getAttribute("data-risk") === "outside").toBe(true);
    expect(outside.getAttribute("aria-label")).toBe("email-receipts.ts, outside the PR · 1 use");
    act(() => outside.focus());
    expect(overviewBox().querySelector("[data-slot=overview-detail]")?.textContent).toBe(
      "src/jobs/email-receipts.ts · outside the pull request · uses src/services/ (renderReceipt).",
    );
    expect(overviewBox().querySelector("[data-slot=overview-legend]")?.textContent).toContain(
      "Faded files are outside the pull request, under the code whose changes they use.",
    );
    await userEvent.click(outside);
    expect(layoutIs("map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.receiptFormatting}`);
  });

  /** The page's status, with the folder searched for clones. */
  const searching = (cloneSearchFolder: string | null) => (request: RecordedRequest) =>
    request.url === "/api/status"
      ? jsonResponse(200, { ...fixtureStatus, cloneSearchFolder })
      : undefined;

  it("says in the details that no clone was found, and where it looked", async () => {
    renderReview({ view: withCheckout("none"), respond: searching("/home/lee") });
    await loaded();
    const details = await openDetails();
    await waitFor(() =>
      expect(details.querySelector("[data-slot=checkout-note]")?.textContent).toBe(
        "Code outside the pull request that calls what it changes isn't shown: megareviewer found no clone of acme/shop on this machine. It looked in your home folder. Start it in a clone, or pass --checkout <dir>, then open the pull request again.",
      ),
    );
    expect(document.querySelector("[data-slot=unchanged-uses]")).toBeNull();
  });

  it("says in the details that the home folder isn't searched", async () => {
    renderReview({ view: withCheckout("none"), respond: searching(null) });
    await loaded();
    const details = await openDetails();
    await waitFor(() =>
      expect(details.querySelector("[data-slot=checkout-note]")?.textContent).toContain(
        "megareviewer found no clone of acme/shop on this machine. It didn't look in your home folder, because it was started with --no-search. Start it in a clone",
      ),
    );
  });

  it.each([
    ["/home/lee", "/home/lee/code/shop", "~/code/shop"],
    ["/home/lee", "/srv/shop", "/srv/shop"],
    [null, "/home/lee/code/shop", "/home/lee/code/shop"],
    ["/home/lee", null, "it"],
  ])(
    "says in the details where to fetch the head commit (searching %s, clone in %s)",
    async (searched, dir, shown) => {
      const view = withCheckout("missing-commit");
      renderReview({
        view: { ...view, analysis: { ...view.analysis, checkoutDir: dir } },
        respond: searching(searched),
      });
      await loaded();
      const details = await openDetails();
      await waitFor(() =>
        expect(details.querySelector("[data-slot=checkout-note]")?.textContent).toBe(
          `Code outside the pull request that calls what it changes isn't shown: the clone on this machine doesn't have the head commit 9e8d7c6. Run git fetch in ${shown}, or git fetch origin pull/128/head for a pull request from a fork, then open the pull request again.`,
        ),
      );
    },
  );

  it("says in the details that the repository is being downloaded", async () => {
    renderReview({ view: withCheckout("downloading"), respond: searching("/home/lee") });
    await loaded();
    expect((await openDetails()).querySelector("[data-slot=checkout-note]")?.textContent).toBe(
      "Downloading acme/shop to find the code that calls what this pull request changes. It shows on the changes when the download ends.",
    );
  });

  it.each([
    [null, "Open the pull request again to try again."],
    [
      "/home/lee/code/shop",
      "Open the pull request again to try again, or run git fetch in ~/code/shop first.",
    ],
  ])("says in the details why the download failed (clone in %s)", async (dir, fix) => {
    const view = withCheckout("download-failed");
    const checkoutError =
      "GitHub didn't let megareviewer download acme/shop. Check that the GitHub token can read this repository's contents.";
    renderReview({
      view: { ...view, analysis: { ...view.analysis, checkoutDir: dir, checkoutError } },
      respond: searching("/home/lee"),
    });
    await loaded();
    const details = await openDetails();
    await waitFor(() =>
      expect(details.querySelector("[data-slot=checkout-note]")?.textContent).toBe(
        `Code outside the pull request that calls what it changes isn't shown: the repository couldn't be downloaded. ${checkoutError} ${fix}`,
      ),
    );
  });

  it("shows the callers when a download ends, without the landing", async () => {
    const { setView, emit } = renderReview({ view: withCheckout("downloading") });
    await loaded();
    expect(document.querySelector("[data-slot=unchanged-uses]")).toBeNull();

    setView(fixture);
    emit(id, { type: "done" });

    const card = cardOf(h.receiptFormatting);
    expect(
      await within(card).findByRole("button", { name: "Used unchanged in 1 place and 1 test" }),
    ).not.toBeNull();
    expect(document.querySelector("[data-landing]")?.getAttribute("data-landing")).toBe("done");
  });

  it("says nothing about the checkout in the details when one was read", async () => {
    renderReview();
    await loaded();
    expect((await openDetails()).querySelector("[data-slot=checkout-note]")).toBeNull();
  });
});

describe("review threads", () => {
  it("puts threads under their lines, the others under Earlier comments, and counts open ones", async () => {
    renderReview();
    await loaded();
    const onLine = await within(mainArea()).findByRole("article", { name: "Thread on line 29" });
    expect(onLine.closest("[data-slot=line-threads]")).not.toBeNull();
    const earlier = within(mainArea()).getByRole("region", {
      name: "Earlier comments on src/routes/orders.ts",
    });
    expect(earlier.textContent).toContain("Was on line 58; the code has changed since");
    expect(within(earlier).getByRole("article").dataset.state).toBe("outdated");
    const elsewhere = within(mainArea()).getByRole("region", { name: "Comments on other files" });
    expect(elsewhere.textContent).toContain("src/lib/money.ts");
    const card = mainArea().querySelector(
      '[data-slot=file-card][data-path="src/services/receipts.ts"]',
    );
    expect(card?.querySelector("[data-slot=count-threads]")?.textContent).toContain(
      "2 open threads",
    );
  });

  it("warns when the threads can't be read, and keeps the code", async () => {
    renderReview({
      respond: (request) =>
        request.url.endsWith("/threads")
          ? failure(502, "host-error", "GitHub answered 502")
          : undefined,
    });
    await loaded();
    const warning = await screen.findByText(/Couldn't read the comments on the pull request/);
    expect(warning.textContent).toContain("GitHub answered 502");
    expect(fileCards().length).toBeGreaterThan(0);
  });

  it("shows a suggestion with nothing to apply it", async () => {
    renderReview();
    await loaded();
    const thread = await within(mainArea()).findByRole("article", { name: "Thread on line 29" });
    expect(thread.querySelector("[data-slot=suggestion-diff]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /batch|Apply/ })).toBeNull();
  });

  describe("stepping through them from the bar", () => {
    const position = () => within(reviewBar()).getByRole("button", { name: /, show all$/ });
    const step = (name: "Next thread" | "Previous thread") =>
      userEvent.click(within(reviewBar()).getByRole("button", { name }));
    const barStatus = () => within(reviewBar()).getByRole("status").textContent;

    it("goes round the unresolved threads in the page's order before Claude runs", async () => {
      renderReview({ view: codeOnly });
      await loaded();
      // Before the first step, the count: three of the four are unresolved.
      await waitFor(() => expect(position().textContent).toBe("3 unresolved"));
      await step("Next thread");
      // orders.ts comes before receipts.ts, so its earlier comment is first.
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_earlier");
      expect(focusedLabel()).toBe("Thread on line 60");
      expect(position().getAttribute("aria-label")).toBe("Thread 1 of 3, show all");
      expect(barStatus()).toBe(
        "Thread 1 of 3, src/routes/orders.ts line 58, outdated: Lee Park: Return a 404 here too.",
      );
      expect(document.getElementById("thread-PRRT_earlier")?.dataset.current).toBe("true");
      await step("Next thread");
      // Line 29 before line 32, though the host lists 32 first.
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_attempts");
      expect(document.getElementById("thread-PRRT_earlier")?.dataset.current).toBeUndefined();
      await step("Next thread");
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_tax");
      await step("Next thread");
      expect(position().textContent).toBe("1 of 3");
      await step("Previous thread");
      expect(position().textContent).toBe("3 of 3");
      // The title goes back to the thread.
      await userEvent.click(
        within(reviewBar()).getByRole("button", { name: /^Go to thread: Lee Park: This retries/ }),
      );
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_tax");
    });

    it("opens a folded resolved thread gone to from the list, and steps on from it", async () => {
      renderReview({ view: codeOnly });
      await loaded();
      await waitFor(() => expect(position().textContent).toBe("3 unresolved"));
      const money = document.getElementById("thread-PRRT_money");
      expect(
        within(money as HTMLElement).getByRole("button", { name: "Show 1 comment" }),
      ).toBeTruthy();

      await userEvent.click(position());
      const list = screen.getByRole("dialog", { name: "4 threads, 3 unresolved" });
      await userEvent.click(within(list).getByRole("button", { name: /Rounds half-cents up\?/ }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_money");
      await waitFor(() => expect(document.activeElement?.id).toBe("thread-PRRT_money"));
      const opened = document.getElementById("thread-PRRT_money") as HTMLElement;
      expect(within(opened).queryByRole("button", { name: "Show 1 comment" })).toBeNull();
      expect(within(opened).getByRole("button", { name: "Hide" })).toBeTruthy();
      // It isn't one of the steps, so the position is the count, and Next goes on down the page,
      // round to the first.
      expect(position().textContent).toBe("3 unresolved");
      await step("Next thread");
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_earlier");

      // Every thread is a step once the list says so.
      await userEvent.click(position());
      await userEvent.click(screen.getByRole("button", { name: "All (4)" }));
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(position().getAttribute("aria-label")).toBe("Thread 1 of 4, show all");
    });

    it("keeps a thread resolved here as a step, so the position doesn't jump", async () => {
      renderReview({ view: codeOnly });
      await loaded();
      await waitFor(() => expect(position().textContent).toBe("3 unresolved"));
      await step("Next thread");
      await step("Next thread");
      expect(position().textContent).toBe("2 of 3");
      const attempts = document.getElementById("thread-PRRT_attempts") as HTMLElement;
      await userEvent.click(within(attempts).getByRole("button", { name: "Resolve" }));
      // Read again after the write: resolved now, still the second of three.
      await waitFor(() => expect(barStatus()).toMatch(/^Thread 2 of 3, .*line 29, resolved: /));
      expect(position().textContent).toBe("2 of 3");
      await step("Next thread");
      expect(position().textContent).toBe("3 of 3");
    });

    it("beside Claude's points, narrows the stepper to the threads with their chip", async () => {
      renderReview();
      await loaded();
      const chip = await within(reviewBar()).findByRole("button", { name: "3 unresolved threads" });
      expect(position().textContent).toBe("3 points");
      await userEvent.click(chip);
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      // Narrowing goes to the first thread, as the findings' chip goes to the first of them.
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_earlier");
      expect(position().getAttribute("aria-label")).toBe("Thread 1 of 3, show all");
      await step("Next thread");
      expect(scrolledTo().at(-1)).toBe("thread-PRRT_attempts");

      // Going to a point takes the stepper back to the points; the thread's place is kept.
      await userEvent.click(chip);
      expect(position().textContent).toBe("3 points");
      expect(document.getElementById("thread-PRRT_attempts")?.dataset.current).toBeUndefined();
      await userEvent.click(chip);
      expect(position().textContent).toBe("2 of 3");
    });

    it("goes to the map from the overview, which doesn't show threads", async () => {
      renderReview({ view: codeOnly });
      await loaded();
      await waitFor(() => expect(position().textContent).toBe("3 unresolved"));
      await userEvent.keyboard("v");
      expect(overviewBox()).toBeTruthy();
      await step("Next thread");
      await waitFor(() => expect(scrolledTo().at(-1)).toBe("thread-PRRT_earlier"));
      expect(screen.queryByRole("region", { name: "Overview of the changed files" })).toBeNull();
    });

    it("shows no stepper on a pull request without threads", async () => {
      const { requests } = renderReview({
        view: codeOnly,
        respond: (request) =>
          request.url.endsWith("/threads") ? jsonResponse(200, { threads: [] }) : undefined,
      });
      await loaded();
      await waitFor(() =>
        expect(requests.some((request) => request.url.endsWith("/threads"))).toBe(true),
      );
      expect(reviewBar().querySelector("[data-slot=thread-stepper]")).toBeNull();
    });
  });
});
