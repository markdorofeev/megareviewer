import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "../../../../contracts/index.ts";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import {
  AnalysisId,
  PointId,
  type PublicationReceipt,
} from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixtureHunks,
  fixtureParts,
  largeAnalysisView,
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
const decisionChip = (title: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`^Decision: ${title.source}`) });
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
const RISK = /Adds a public endpoint, GET/;
const PLAIN_TEXT = /Why plain text/;
const DAYJS = /Why dayjs for one date format/;
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
    expect(within(reviewBar()).getByText("Claude is reading this PR")).toBeTruthy();
    expect(
      reviewBar().querySelector("[data-slot=model-hairline]")?.getAttribute("data-state"),
    ).toBe("running");
    // The description stays until the intent arrives.
    const description = firstSentence(analysis.pullRequest?.description ?? "");
    expect(screen.getByText(description)).toBeTruthy();
    expect(fileCards()).toContain("src/routes/orders.ts");
    expect(within(mainArea()).getAllByRole("region", { name: /, lines / })).toHaveLength(5);
    expect(within(mainArea()).getByRole("heading", { name: "Mechanical changes 5" })).toBeTruthy();

    // The intent is the first result: Claude's sentence swaps in where the description was,
    // which keeps its room, hidden from readers, until the run ends.
    setView({ ...fixture, analysis: analysisInProgress(analysis, 4) });
    expect(await screen.findByText(analysis.intent?.inferred.summary ?? "")).toBeTruthy();
    const swap = document.querySelector("[data-slot=intent-swap]");
    expect(swap?.querySelector("[data-leaving]")?.getAttribute("aria-hidden")).toBe("true");
    // Findings are in, but the code doesn't change until everything has arrived.
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
    expect(screen.queryByRole("button", { name: /Analyze with Claude/ })).toBeNull();

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
    // The code's analysis, before anyone asked for the model.
    const codeOnly = {
      ...fixture,
      analysis: {
        ...analysisFailed(analysis, "intent", "unused"),
        stages: {
          ...analysis.stages,
          intent: "skipped",
          risk: "skipped",
          decisions: "skipped",
          tour: "skipped",
        },
        modelError: null,
      } as const,
    };
    const { requests, setView } = renderReview({
      view: codeOnly,
      respond: (request) =>
        request.url === `${viewPath}/model` ? jsonResponse(200, { analysisId: id }) : undefined,
    });
    await loaded();
    const button = within(reviewBar()).getByRole("button", { name: "Analyze with Claude" });
    // What runs it, once the status has loaded.
    await waitFor(() =>
      expect(button.getAttribute("title")).toBe("Runs on Claude Code, on your Pro plan"),
    );
    const loads = () => requests.filter((request) => request.url === viewPath).length;
    const before = loads();

    await userEvent.click(button);
    expect(requests.some((request) => request.url === `${viewPath}/model`)).toBe(true);
    // Following the analysis again loads it again, without leaving the page.
    await waitFor(() => expect(loads()).toBe(before + 1));
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();

    setView({ ...fixture, analysis: analysisInProgress(analysis, 2) });
    expect(await screen.findByText("Claude is reading this PR")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Analyze with Claude" })).toBeNull();
  });

  it("says why Claude couldn't finish, and tries again", async () => {
    const { requests } = renderReview({
      view: { ...fixture, analysis: analysisFailed(analysis, "risk", "Overloaded") },
      respond: (request) =>
        request.url === `${viewPath}/model`
          ? failure(503, "model-unavailable", "Claude Code isn't signed in")
          : undefined,
    });
    await loaded();
    // What landed stays; the receipt says what's missing and why.
    expect(within(reviewBar()).getByRole("alert").textContent).toBe(
      "risk, decisions missing: Overloaded",
    );
    // The code's review is all there.
    expect(fileCards()).toContain("src/routes/orders.ts");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(requests.some((request) => request.url === `${viewPath}/model`)).toBe(true);
    expect(await screen.findByText("Claude can't run: Claude Code isn't signed in.")).toBeTruthy();
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

describe("header", () => {
  it("names the PR once, with who wants to merge what, how much it changes and its threads", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T10:21:00Z"));
    renderReview();
    await loaded();
    const link = screen.getByRole("link", { name: "shop #128" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/shop/pull/128");
    const byline = document.querySelector<HTMLElement>("[data-slot=pr-byline]");
    expect(byline?.textContent?.replace(/\s+/g, " ")).toBe(
      "Sam Rivera wants to merge shop-142-order-receipts → into main · updated 40m ago · 7 files +58 −13, 58 lines added, 13 removed",
    );
    await waitFor(() =>
      expect(document.querySelector("[data-slot=thread-totals]")?.textContent).toBe(
        "4 threads · 3 unresolved",
      ),
    );
  });

  it("leaves out who, what and the threads while the pull request is being collected", async () => {
    const { setView } = renderReview({
      view: { ...fixture, analysis: analysisInProgress(analysis, 0) },
    });
    await screen.findByRole("heading", { level: 1, name: "Collecting the pull request…" });
    expect(document.querySelector("[data-slot=pr-byline]")).toBeNull();
    expect(document.querySelector("[data-slot=thread-totals]")).toBeNull();

    // Collected, but the diff isn't read yet: who and what, but no count of files.
    setView({ ...fixture, analysis: analysisInProgress(analysis, 1) });
    await loaded();
    const byline = document.querySelector("[data-slot=pr-byline]");
    expect(byline?.textContent).toContain("Sam Rivera wants to merge");
    expect(byline?.textContent).not.toContain("files");
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

  it("warns about new commits and re-analyzes the PR", async () => {
    const { requests } = renderReview({
      view: { ...fixture, stale: true },
      respond: (request) =>
        request.method === "POST" && request.url === "/api/analyses"
          ? jsonResponse(200, { analysisId: otherId })
          : undefined,
    });
    await loaded();
    expect(screen.getByText("This PR has new commits since the analysis.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(requests.find((request) => request.url === "/api/analyses")?.body).toEqual({
      url: "https://github.com/acme/shop/pull/128",
    });
    expect(window.location.pathname).toBe(`/review/${otherId}`);
  });

  it("shows the usage totals with a breakdown by pass", async () => {
    renderReview();
    await loaded();
    expect(screen.getByText(/^Usage:/).textContent).toBe(
      "Usage: 93k tokens in · 115k cache read · 8k out · $0.77",
    );
    const breakdown = document.getElementById(
      screen.getByText(/^Usage:/).getAttribute("aria-describedby") ?? "",
    );
    if (breakdown === null) throw new Error("no breakdown");
    expect(within(breakdown).getAllByRole("row")).toHaveLength(5);
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
    expect(screen.getByText("✓ Does what was asked:")).toBeTruthy();
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

  it("leaves the details' toggle out when there's nothing behind it", async () => {
    renderReview({
      view: withIntent({
        stated: null,
        mismatches: [],
        inferred: { summary: "Renames a variable.", behaviorChanges: [] },
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
        .getAllByRole("button")
        .flatMap((row) => (row.title.endsWith("/") ? [] : [row.title])),
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

  it("sit where their kind goes: a risk over its range, a finding under its line, a decision at its end", async () => {
    renderReview();
    await loaded();
    const card = cardOf(h.receiptRoute);
    const risk = within(card).getByRole("article", { name: RISK });
    const finding = within(card).getByRole("article", { name: FINDING });
    expect(comesBefore(risk, lineRow(card, "added line 13"))).toBe(true);
    expect(comesBefore(lineRow(card, "added line 15"), finding)).toBe(true);
    expect(comesBefore(finding, lineRow(card, "added line 16"))).toBe(true);
    expect(lineRow(card, "added line 15").querySelector("[data-slot=finding-flag]")).not.toBeNull();
    expect(
      within(lineRow(card, "added line 20")).getByRole("button", { name: PLAIN_TEXT }),
    ).toBeTruthy();
    // The SHOP-142 mismatch is a line of the finding that shows it, not a card of its own.
    expect(finding.textContent).toContain("Contradicts what was asked:");
    expect(screen.queryByRole("article", { name: /^SHOP-142 says/ })).toBeNull();
    expect(finding.textContent).toContain("blocking");
    expect(within(finding).getByText("Suggested change")).toBeTruthy();
  });

  it("link a decision's other hunk back to it, and open its footnote there", async () => {
    renderReview();
    await loaded();
    const back = within(cardOf(h.dependency)).getByRole("button", { name: DAYJS });
    await userEvent.click(back);
    expect(scrolledTo().at(-1)).toBe("point-d3");
    expect(decisionChip(DAYJS).dataset.current).toBe("true");
    expect(decisionChip(DAYJS).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("article", { name: DAYJS }).dataset.slot).toBe("decision-note");
    expect(cardOf(h.dependency).dataset.highlighted === "true").toBe(true);
  });

  it("mark a finding's and a risk's lines with their kind's bar, a finding's winning", async () => {
    renderReview();
    await loaded();
    const kinds = [...cardOf(h.receiptRoute).querySelectorAll("[data-point]")].map((row) =>
      row.getAttribute("data-point"),
    );
    // The risk covers the hunk's nine added lines, 13 to 21; the finding rests on 15. Decisions
    // are footnotes and mark none.
    expect(kinds).toEqual(["risk", "risk", "finding", ...Array(6).fill("risk")]);
  });

  it("add a finding to the review as a draft with its severity and suggestion", async () => {
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
      severity: "blocking",
      suggestion: ["  const order = await findOrder(req.user.id, req.params.id);"],
    });
    expect(draft.body).toMatch(/^Any signed-in user can read every customer's receipt\n\n/);
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

  it("comment on a risk in the comment box, prefilled with its reason", async () => {
    renderReview();
    await loaded();
    await userEvent.click(pointButton("Comment", RISK));
    const field = within(mainArea()).getByRole("textbox", { name: /^Comment on lines 13–21/ });
    expect((field as HTMLTextAreaElement).value).toMatch(RISK);
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

  it("open a decision's footnote from its chip, and hide them all from the bar", async () => {
    renderReview();
    await loaded();
    expect(screen.queryByRole("article", { name: PLAIN_TEXT })).toBeNull();
    await userEvent.click(decisionChip(PLAIN_TEXT));
    const note = screen.getByRole("article", { name: PLAIN_TEXT });
    expect(note.textContent).toContain("plain text needs no renderer");
    // The click is the chip's, not the line's: no comment box opens.
    expect(within(mainArea()).queryByRole("textbox", { name: /^Comment on/ })).toBeNull();

    await userEvent.click(
      within(reviewBar()).getByRole("button", { name: "Hide decisions on the code" }),
    );
    expect(screen.queryByRole("button", { name: /^Decision: / })).toBeNull();
    expect(screen.queryByRole("article", { name: PLAIN_TEXT })).toBeNull();
    expect(window.localStorage.getItem("megareviewer:decisions-shown")).toBe("false");
    expect(
      within(reviewBar()).getByRole("button", { name: "Show decisions on the code" }),
    ).toBeTruthy();
  });

  it("show the decisions again when the stepper goes to one", async () => {
    window.localStorage.setItem("megareviewer:decisions-shown", "false");
    renderReview();
    await loaded();
    expect(screen.queryByRole("button", { name: /^Decision: / })).toBeNull();
    await userEvent.click(await within(reviewBar()).findByRole("button", { name: "4 decisions" }));
    expect(scrolledTo().at(-1)).toBe("point-d1");
    expect(decisionChip(PLAIN_TEXT).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("article", { name: PLAIN_TEXT })).toBeTruthy();
  });

  it("are counted by kind in the bar, and stepped through both ways, round", async () => {
    renderReview();
    await loaded();
    await waitFor(() =>
      expect(
        [...reviewBar().querySelectorAll("[data-slot=point-chip]")].map((chip) =>
          chip.textContent?.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(["3 findings", "1 risk", "4 decisions"]),
    );
    // Before the first step, the count; Next goes to the first.
    expect(position().textContent).toBe("8 points");
    expect(position().getAttribute("aria-label")).toBe("8 points, show all");
    await step("Next point");
    expect(scrolledTo().at(-1)).toBe("point-f1");
    expect(position().getAttribute("aria-label")).toBe("Point 1 of 8, show all");
    expect(within(reviewBar()).getByRole("status").textContent).toMatch(
      /^Finding 1 of 8: Any signed-in user can read/,
    );
    expect(
      within(reviewBar()).getByRole("button", { name: /^Go to finding: Any signed-in user/ }),
    ).toBeTruthy();

    await step("Previous point");
    expect(position().textContent).toBe("8 of 8");
    expect(scrolledTo().at(-1)).toBe("point-d4");
    await step("Next point");
    expect(position().textContent).toBe("1 of 8");
    await step("Next point");
    expect(scrolledTo().at(-1)).toBe("point-f2");

    // The title goes back to the point's card.
    await userEvent.click(within(reviewBar()).getByRole("button", { name: /^Go to finding/ }));
    expect(scrolledTo().slice(-2)).toEqual(["point-f2", "point-f2"]);
  });

  it("narrow to a kind with its chip, and widen again", async () => {
    renderReview();
    await loaded();
    const chip = await within(reviewBar()).findByRole("button", { name: "4 decisions" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    // The reviewer wasn't on a decision, so the stepper goes to the first.
    expect(scrolledTo().at(-1)).toBe("point-d1");
    expect(position().textContent).toBe("1 of 4");
    await step("Next point");
    expect(scrolledTo().at(-1)).toBe("point-d2");
    expect(position().textContent).toBe("2 of 4");
    // The list the position opens is narrowed too.
    await userEvent.click(position());
    const list = screen.getByRole("dialog", { name: "4 decisions from Claude" });
    const rows = within(within(list).getByRole("list", { name: "Points" })).getAllByRole("button");
    expect(rows.map((row) => row.dataset.kind)).toEqual(Array(4).fill("decision"));
    await userEvent.click(within(list).getByRole("button", { name: "Close" }));

    // Another chip narrows to its own kind; the same one again widens to every point.
    await userEvent.click(within(reviewBar()).getByRole("button", { name: "3 findings" }));
    expect(scrolledTo().at(-1)).toBe("point-f1");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(within(reviewBar()).getByRole("button", { name: "3 findings" }));
    expect(position().textContent).toBe("1 of 8");
  });

  it("are listed in full from the position, and a row there is where the stepper goes on", async () => {
    renderReview();
    await loaded();
    await userEvent.click(position());
    const list = screen.getByRole("list", { name: "Points" });
    expect(within(list).getAllByRole("button")).toHaveLength(8);
    await userEvent.click(within(list).getAllByRole("button")[1] as HTMLElement);
    expect(scrolledTo().at(-1)).toBe("point-f2");
    expect(position().textContent).toBe("2 of 8");

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
    // The row before the card's is the last line it rests on, with the kind's bar.
    expect(fold?.previousElementSibling?.getAttribute("data-point")).toBe("finding");
    expect(Number(card.style.getPropertyValue("--lines-above"))).toBeGreaterThan(0);
    // Opened with its results, the page is at rest: nothing lands.
    expect(document.querySelector("[data-landing]")?.getAttribute("data-landing")).toBe("done");
    expect(fold?.hasAttribute("data-fresh")).toBe(false);
  });

  it("count each file's points in the tree", async () => {
    renderReview();
    await loaded();
    const row = within(rail()).getByTitle("src/routes/orders.ts");
    const count = (kind: string) =>
      row.querySelector(`[data-slot=point-count][data-kind=${kind}]`)?.textContent;
    expect(count("finding")).toBe("1 finding");
    expect(count("risk")).toBe("1 risk");
    expect(count("decision")).toBe("1 decision");
  });

  it("can't be acted on once the review is published", async () => {
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
    expect(screen.queryByRole("button", { name: /^Publish review…/ })).toBeNull();
    expect(pointCard(FINDING).dataset.state).toBe("raised");
    expect(addToReview(FINDING).hasAttribute("disabled")).toBe(true);
  });

  it("keeps line comments open after publishing: they post now", async () => {
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
    expect(box.queryByRole("button", { name: "Add to review" })).toBeNull();
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
  await userEvent.click(await screen.findByRole("menuitemradio", { name: "Overview" }));
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
    expect(within(strip).getByRole("button", { name: /^\.\/, 1 file, \d+ contract/ })).toBeTruthy();
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
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Overview" }));
    expect(overviewBox()).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // The overview takes the focus to the file in view; closing doesn't hand it back to the menu.
    expect(document.activeElement).not.toBe(display);
    await userEvent.click(display);
    expect(
      (await screen.findByRole("menuitemradio", { name: "Overview" })).getAttribute("aria-checked"),
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
  it("count a file's contract parts on its card, and mark no part by its risk", async () => {
    renderReview();
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    expect(
      orders.querySelector("[data-slot=file-card-header] [data-slot=count-contract]")?.textContent,
    ).toBe("▲ 1 contract · ");
    // A rule's reason quotes the code under it, so the contract part has no divider at all.
    expect(orders.querySelector("[data-slot=hunk-contract-reason]")).toBeNull();
    expect(cardOf(h.receiptRoute).querySelector("[data-slot=hunk-header]")).toBeNull();
    expect(cardOf(h.routeImports).querySelector("[data-slot=hunk-header]")).toBeNull();
    // The file's count says a part is contract; the part itself carries no badge or bar.
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
      decisions: [],
      risk: analysis.risk.map((risk) =>
        risk.source === "model" ? { ...risk, source: "rule" as const } : risk,
      ),
      stages: {
        ...analysis.stages,
        intent: "skipped",
        findings: "skipped",
        decisions: "skipped",
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
  const withoutDecisions: AnalysisView = {
    ...fixture,
    analysis: { ...analysis, decisions: [], stages: { ...analysis.stages, decisions: "skipped" } },
  };

  it("posts a comment now, as a thread of its own, without keeping a draft", async () => {
    const { requests } = renderReview({ view: withoutDecisions });
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
    const { requests, unmount } = renderReview({ view: withoutDecisions });
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
    const again = renderReview({ view: withoutDecisions });
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
    const dialog = await screen.findByRole("dialog", { name: "Publish 1 comment" });
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
    renderReview({ view: withoutDecisions });
    await loaded();
    await userEvent.click(cardOf(h.routeImports));
    await userEvent.keyboard("c");
    const field = within(mainArea()).getByRole("textbox", { name: /^Comment on (old )?line \d+$/ });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "x");
    await userEvent.clear(field);
    // Tab moves to the box's severity; Esc leaves the box.
    await userEvent.keyboard("{Escape}");
    expect(within(mainArea()).queryByRole("textbox", { name: /^Comment on/ })).toBeNull();
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
  });
});

describe("publishing", () => {
  const openDialog = async (name = "Publish the review") => {
    await userEvent.click(screen.getByRole("button", { name: /^Publish review…/ }));
    const dialog = await screen.findByRole("dialog", { name });
    await waitFor(() => expect(within(dialog).queryByText("Reading the comments…")).toBeNull());
    return dialog;
  };

  it("shows a finding added to the review as it'll post, the verdict, and nothing else", async () => {
    renderReview();
    await loaded();
    await userEvent.click(addToReview(FINDING));
    const dialog = await openDialog("Publish 1 comment");
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish the review" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
    expect(
      requests.find((request) => request.url === `${viewPath}/publication`)?.body,
    ).toMatchObject({ verdict: "request_changes" });
  });

  it("publishes, closes and shows the link to the review", async () => {
    const { requests } = renderReview();
    await loaded();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish the review" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The drafts posted with it are threads on the host now.
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
    expect(requests.find((request) => request.url === `${viewPath}/publication`)?.body).toEqual({
      summary: "",
      allowStale: false,
      hunkComments: [],
      verdict: "comment",
    });
    expect(addToReview(RETRIES).hasAttribute("disabled")).toBe(true);
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish the review" }));
    expect(
      await within(dialog).findByText("This PR changed since the analysis. Publish anyway?"),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish anyway" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
    const publishes = requests.filter((request) => request.url === `${viewPath}/publication`);
    expect(publishes.map((request) => request.body)).toEqual([
      { summary: "", allowStale: false, hunkComments: [], verdict: "comment" },
      { summary: "", allowStale: true, hunkComments: [], verdict: "comment" },
    ]);
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish the review" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("The git host returned an error: GitHub returned 502.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
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

  it("says in the details why nothing outside is shown without a checkout", async () => {
    renderReview({ view: withCheckout("none") });
    await loaded();
    expect(
      within(await openDetails()).getByText(/didn't run in a checkout of acme\/shop/),
    ).toBeTruthy();
    expect(document.querySelector("[data-slot=unchanged-uses]")).toBeNull();
  });

  it("says in the details to fetch the head commit when the checkout lacks it", async () => {
    renderReview({ view: withCheckout("missing-commit") });
    await loaded();
    const details = await openDetails();
    expect(details.querySelector("[data-slot=checkout-note]")?.textContent).toBe(
      "Code outside the pull request that calls what it changes isn't shown: the local checkout doesn't have the head commit 9e8d7c6. Run git fetch in it, or git fetch origin pull/128/head for a pull request from a fork, then open the pull request again.",
    );
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
});
