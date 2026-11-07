import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "../../../../contracts/index.ts";
import type { HunkId } from "../../../../src/domain/diff/index.ts";
import {
  AnalysisId,
  DecisionId,
  type PublicationReceipt,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixtureHunks,
  largeAnalysisView,
} from "../../../dev/fixtures/index.ts";
import { mockFetch } from "../../../dev/mock-fetch.ts";
import { createMockApi } from "../../../dev/mock-routes.ts";
import { analysisFailed, analysisInProgress } from "../../../dev/progress.ts";
import { type Highlighter, HighlighterContext } from "../../diff/index.ts";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse, type RecordedRequest } from "../../testing/fetch.ts";
import { ReviewPage } from "./ReviewPage.tsx";

const fixture = fixtureAnalysisView;
const analysis = fixture.analysis;
const id = analysis.id;
const h = fixtureHunks;
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
        {children}
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
  const main = document.querySelector<HTMLElement>(".main-area");
  if (main === null) throw new Error("no main area");
  return main;
};
/** The step headings in the map, in order. */
const stepHeadings = () =>
  [...mainArea().querySelectorAll(".step-heading h2")].map((heading) => heading.textContent);
/** A hunk's place in the map: its card, or its collapsed row. */
const placeOf = (hunkId: HunkId) => {
  const place = document.getElementById(`hunk-${hunkId}`);
  if (place === null) throw new Error(`no hunk ${hunkId} in the map`);
  return place;
};
const cardOf = (hunkId: HunkId) => {
  const card = placeOf(hunkId).querySelector<HTMLElement>(":scope > .hunk-card");
  if (card === null) throw new Error(`no card for ${hunkId}`);
  return card;
};
const focusedLabel = () => document.activeElement?.getAttribute("aria-label");
const rail = () => screen.getByRole("complementary", { name: "Map" });
const overviewBox = () => screen.getByRole("region", { name: "Overview of the changed files" });
const decisionCard = (title: RegExp) => screen.getByRole("article", { name: title });
const approve = (title: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`^Approve: ${title.source}`) });
const reject = (title: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`^Reject: ${title.source}`) });
const OWNERSHIP = /Looks up the order by ID/;
const ENDPOINT = /Adds a public endpoint/;
const RETRIES = /Retries the tax service/;
const DAYJS = /Adds dependency dayjs/;
const putRequests = (requests: readonly RecordedRequest[]) =>
  requests.filter((request) => request.method === "PUT");
const scrolledTo = () =>
  vi
    .mocked(Element.prototype.scrollIntoView)
    .mock.contexts.map((element) => (element as Element).id);

const ROUTE = /^src\/routes\/orders\.ts, lines 10–24$/;
const IMPORTS = /^src\/routes\/orders\.ts, lines 1–8$/;
const RECEIPTS = /^src\/services\/receipts\.ts, lines 26–/;

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
    expect(stepHeadings()[0]).toBe("1 The receipt endpoint");
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

  it("shows each part of a running analysis as soon as its data exists", async () => {
    const { setView } = renderReview({
      view: { ...fixture, analysis: analysisInProgress(analysis, 2) },
    });
    await loaded();
    const progress = screen.getByRole("list", { name: "Analysis progress" });
    expect(progress.textContent).toContain("Prepare: done");
    expect(progress.textContent).toContain("Intent: running");
    expect(screen.getByText("Working out the intent…")).toBeTruthy();
    expect(stepHeadings()).toEqual(["Changes by file"]);
    expect(within(mainArea()).getAllByRole("region", { name: /, lines / })).toHaveLength(5);
    expect(within(mainArea()).getByRole("heading", { name: "Mechanical changes 5" })).toBeTruthy();

    setView({ ...fixture, analysis: analysisInProgress(analysis, 4) });
    expect(await screen.findByText(analysis.intent?.inferred.summary ?? "")).toBeTruthy();
    expect(screen.getByText("Finding the decisions the code makes…")).toBeTruthy();

    setView({ ...fixture, analysis: analysisInProgress(analysis, 5) });
    expect(
      await screen.findByText("You can give verdicts once the analysis is complete."),
    ).toBeTruthy();
    expect(approve(OWNERSHIP).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Publish…" }).hasAttribute("disabled")).toBe(true);

    setView(fixture);
    await waitFor(() => expect(stepHeadings()[0]).toBe("1 The receipt endpoint"));
    expect(screen.queryByRole("list", { name: "Analysis progress" })).toBeNull();
  });

  it("shows where a failed analysis stopped, what it has, and retries it", async () => {
    const { requests } = renderReview({
      view: { ...fixture, analysis: analysisFailed(analysis, "risk", "The model gave up") },
      respond: (request) =>
        request.url === `${viewPath}/retry`
          ? jsonResponse(200, { analysisId: otherId })
          : undefined,
    });
    await loaded();
    expect(screen.getByRole("alert").textContent).toContain(
      "The analysis failed at the risk stage: The model gave up",
    );
    expect(screen.getByText(analysis.intent?.inferred.summary ?? "")).toBeTruthy();
    expect(
      screen.getByText("There's no guided tour, so the changes are shown by file."),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(requests.some((request) => request.url === `${viewPath}/retry`)).toBe(true);
    expect(window.location.pathname).toBe(`/review/${otherId}`);
  });

  it("starts afresh when a retry runs again under the same ID", async () => {
    let view: AnalysisView = {
      ...fixture,
      analysis: analysisFailed(analysis, "risk", "The model gave up"),
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
  it("links the PR and shows its author and branches", async () => {
    renderReview();
    await loaded();
    const link = screen.getByRole("link", { name: "acme/shop #128" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/shop/pull/128");
    expect(link.closest("p")?.textContent).toBe(
      "acme/shop #128 · Sam Rivera · shop-142-order-receipts → main",
    );
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
    const chip = screen.getByRole("button", { name: /^SHOP-142 says only the customer/ });
    expect(chip.textContent).toContain("1 of 1");
    expect(screen.queryByRole("heading", { name: "Inferred from the code" })).toBeNull();
  });

  it("goes to a mismatch's hunks from the chip, and names the next one", async () => {
    const second = {
      ...firstMismatch,
      description: "Caches receipts forever.",
      hunkIds: [h.retryAndCache],
    };
    renderReview({ view: withIntent({ mismatches: [firstMismatch, second] }) });
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: /^SHOP-142/ }));
    expect(focusedLabel()).toMatch(ROUTE);
    expect(cardOf(h.receiptRoute).classList.contains("highlighted")).toBe(true);
    const next = screen.getByRole("button", { name: /^Caches receipts forever\./ });
    expect(next.textContent).toContain("2 of 2");

    await userEvent.click(next);
    expect(focusedLabel()).toMatch(RECEIPTS);
    expect(cardOf(h.receiptRoute).classList.contains("highlighted")).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(cardOf(h.retryAndCache).classList.contains("highlighted")).toBe(false);
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
    expect(focusedLabel()).toMatch(ROUTE);
  });

  it("says the code does what was asked when they agree, with what was asked in the details", async () => {
    renderReview({ view: withIntent({ mismatches: [] }) });
    await loaded();
    expect(screen.getByText("✓ Does what was asked:")).toBeTruthy();
    expect(document.querySelector(".mismatch-chip")).toBeNull();
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
  it("shows every step in one scroll, in tour order, then the mechanical changes", async () => {
    renderReview();
    await loaded();
    expect(stepHeadings()).toEqual([
      "1 The receipt endpoint",
      "2 Retrying the tax service and caching receipts",
      "3 Dates and prices on the receipt",
      "4 The new dependency",
    ]);
    expect(screen.getByText(analysis.tour?.steps[0]?.explanation ?? "")).toBeTruthy();
    expect(within(mainArea()).getByRole("heading", { name: "Mechanical changes 5" })).toBeTruthy();
    expect(
      within(mainArea())
        .getAllByRole("region", { name: /, lines / })
        .map((card) => card.getAttribute("aria-label")),
    ).toHaveLength(5);
  });

  it("shows a mechanical hunk collapsed in its file's step, expanding to its card", async () => {
    renderReview();
    await loaded();
    const row = within(placeOf(h.formatMoneyRemoved)).getByRole("button", { name: /moved/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(within(placeOf(h.formatMoneyRemoved)).getByRole("region")).toBeTruthy();
  });

  it("shows only contract hunks when asked, remembers it, and shows the rest again", async () => {
    const first = renderReview();
    await loaded();
    expect(within(rail()).getByText("2 contract")).toBeTruthy();
    const toggle = within(rail()).getByRole("checkbox", { name: "Contract changes only" });
    await userEvent.click(toggle);
    const shown = within(mainArea()).getAllByRole("region", { name: /, lines / });
    expect(shown.map((card) => card.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "src/routes/orders.ts",
      "package.json",
    ]);
    expect(stepHeadings()).toEqual(["1 The receipt endpoint", "4 The new dependency"]);
    expect(window.localStorage.getItem(`megareviewer:contract-only:${id}`)).toBe("true");
    first.unmount();

    renderReview();
    await loaded();
    expect(stepHeadings()).toHaveLength(2);
    // Going to a hunk that isn't shown shows everything again.
    await userEvent.click(
      within(rail()).getByRole("button", { name: /^src\/services\/receipts\.ts, lines 26/ }),
    );
    expect(stepHeadings()).toHaveLength(4);
    expect(focusedLabel()).toMatch(RECEIPTS);
  });

  it("links a flow to the code of earlier steps it passes through, and quiets supporting steps", async () => {
    const step = (id: string, title: string, hunkIds: HunkId[], extra: object = {}) => ({
      id: TourStepId.parse(id),
      title,
      explanation: "",
      hunkIds,
      kind: "flow" as const,
      via: [],
      entries: [],
      ...extra,
    });
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          tour: {
            steps: [
              step("s1", "GET /orders/:id/receipt", [
                h.routeImports,
                h.receiptRoute,
                h.retryAndCache,
              ]),
              step("s2", "Command: main in cli.ts", [h.receiptFormatting], {
                via: [h.retryAndCache],
                entries: [],
              }),
              step("s3", "Other changes in src/routes", [h.formatMoneyRemoved], {
                kind: "supporting",
              }),
            ],
            builtBy: "code",
          },
        },
      },
    });
    await loaded();
    const second = screen.getByRole("region", { name: "2 Command: main in cli.ts" });
    const through = within(second).getByRole("list", { name: "Passes through" });
    await userEvent.click(within(through).getByRole("button", { name: /^receipts\.ts lines 26/ }));
    expect(focusedLabel()).toMatch(RECEIPTS);
    const supporting = screen.getByRole("region", { name: "3 Other changes in src/routes" });
    expect(supporting.querySelector(".step-heading.supporting")).not.toBeNull();
    expect(
      within(screen.getByRole("region", { name: "1 GET /orders/:id/receipt" })).queryByRole(
        "list",
        {
          name: "Passes through",
        },
      ),
    ).toBeNull();
  });

  it("says when the model's tour failed and the call-graph tour replaced it", async () => {
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          tour: analysis.tour === null ? null : { ...analysis.tour, builtBy: "code" as const },
        },
      },
    });
    await loaded();
    expect(
      screen.getByText("The model's tour wasn't usable, so this one follows the call graph."),
    ).toBeTruthy();
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
    await userEvent.click(within(rail()).getByRole("checkbox", { name: "Contract changes only" }));
    expect(stepHeadings()).toHaveLength(2);
  });
});

/** IntersectionObserver for tests: records what it observes, and reports what a test says. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  /** Reports these elements entering (or leaving) the viewport to every observer watching them. */
  static report(elements: readonly Element[], isIntersecting = true) {
    for (const observer of FakeObserver.all) {
      const entries = elements
        .filter((element) => observer.observed.has(element))
        .map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry);
      if (entries.length > 0)
        observer.callback(entries, observer as unknown as IntersectionObserver);
    }
  }
}

describe("risk map", () => {
  const bar = (name: RegExp) => within(rail()).getByRole("button", { name });

  it("has a row per hunk: its file and lines, and a bar sized by them and marked", async () => {
    renderReview();
    await loaded();
    const route = bar(/^src\/routes\/orders\.ts, lines 10–24, contract$/);
    const height = (row: HTMLElement) => row.querySelector<HTMLElement>(".rail-bar")?.style.height;
    expect(height(route)).toBe("15px");
    expect(height(bar(/^src\/routes\/orders\.ts, lines 1–8, logic$/))).toBe("12px");
    expect(route.querySelector(".rail-hunk-file")?.textContent).toBe("orders.ts 10–24");
    expect(route.querySelector(".rail-hunk-meta")?.textContent).toBe("contract · 2 decisions");
    expect([...route.querySelectorAll(".rail-mark")].map((mark) => mark.textContent)).toEqual([
      "Decision: Adds a public endpoint GET /orders/:id/receipt",
      "Decision: Looks up the order by ID without checking that it belongs to the user",
    ]);
    expect(
      bar(/^package\.json, .*, contract$/).querySelector(".rail-marks, .rail-bar")?.textContent,
    ).toBe("Decision: Adds dependency dayjs 1.11.13 to format dates");
    expect(within(rail()).getByRole("button", { name: "Proved mechanical (5)" })).toBeTruthy();
  });

  it("marks a contract rule's reason", async () => {
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          risk: analysis.risk.map((risk) =>
            risk.hunkId === h.dependency
              ? { ...risk, reason: "Changes dependencies.", source: "rule" as const }
              : risk,
          ),
        },
      },
    });
    await loaded();
    expect(bar(/^package\.json/).querySelector(".mark-rule")?.textContent).toBe(
      "Rule: Changes dependencies.",
    );
  });

  it("scrolls to a hunk or a step from the rail", async () => {
    renderReview();
    await loaded();
    await userEvent.click(bar(/^src\/services\/receipts\.ts, lines 26/));
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.retryAndCache}`);
    expect(focusedLabel()).toMatch(RECEIPTS);
    await userEvent.click(within(rail()).getByRole("button", { name: /^4 The new dependency/ }));
    expect(scrolledTo().at(-1)).toBe("step-s4");
    await userEvent.click(within(rail()).getByRole("button", { name: "Proved mechanical (5)" }));
    expect(scrolledTo().at(-1)).toBe("mechanical-changes");
  });

  it("dims and ticks reviewed hunks, and outlines the hunks in view", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    FakeObserver.all = [];
    renderReview();
    await loaded();
    await userEvent.click(
      within(cardOf(h.routeImports)).getByRole("checkbox", { name: "Reviewed" }),
    );
    const imports = bar(/^src\/routes\/orders\.ts, lines 1–8, logic, reviewed$/);
    expect(imports.querySelector(".rail-bar")?.classList.contains("reviewed")).toBe(true);
    expect(imports.textContent).toContain("✓");

    act(() => FakeObserver.report([placeOf(h.receiptRoute), placeOf(h.routeImports)]));
    const inView = () =>
      within(rail())
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "location")
        .map((button) => button.getAttribute("aria-label")?.split(", ")[1]);
    expect(inView()).toEqual(["lines 10–24", "lines 1–8"]);
    act(() => FakeObserver.report([placeOf(h.receiptRoute)], false));
    expect(inView()).toEqual(["lines 1–8"]);

    // Filtering replaces the places on the page, and the new ones are watched.
    const filter = within(rail()).getByRole("checkbox", { name: "Contract changes only" });
    await userEvent.click(filter);
    await userEvent.click(filter);
    expect(inView()).toEqual([]);
    act(() => FakeObserver.report([placeOf(h.retryAndCache)]));
    expect(inView()).toEqual(["lines 26–50"]);
  });
});

describe("decisions", () => {
  it("sit on the first hunk they rest on, and the others link back to them", async () => {
    renderReview();
    await loaded();
    expect(
      within(cardOf(h.receiptRoute))
        .getAllByRole("article")
        .map(
          (card) => card.getAttribute("aria-labelledby") && card.querySelector("h3")?.textContent,
        ),
    ).toEqual([
      "Adds a public endpoint GET /orders/:id/receipt",
      "Looks up the order by ID without checking that it belongs to the user",
    ]);
    expect(within(cardOf(h.receiptFormatting)).getByRole("article", { name: DAYJS })).toBeTruthy();
    const back = within(cardOf(h.dependency)).getByRole("button", { name: DAYJS });
    expect(within(cardOf(h.dependency)).queryByRole("article")).toBeNull();

    await userEvent.click(back);
    expect(scrolledTo().at(-1)).toBe("decision-d5");
    expect(decisionCard(DAYJS).classList.contains("selected")).toBe(true);
    expect(cardOf(h.dependency).classList.contains("highlighted")).toBe(true);
    expect(cardOf(h.receiptFormatting).classList.contains("highlighted")).toBe(true);
  });

  it("save a verdict at once, given on the card", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(reject(OWNERSHIP));
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(putRequests(requests)).toHaveLength(1));
    expect(putRequests(requests)[0]).toMatchObject({
      url: `${viewPath}/verdicts/d2`,
      body: { verdict: "rejected", comment: "" },
    });
  });

  it("return a verdict to pending when its active button is clicked again", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(approve(RETRIES));
    await userEvent.click(approve(RETRIES));
    expect(approve(RETRIES).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() =>
      expect(putRequests(requests).at(-1)?.body).toMatchObject({ verdict: "pending" }),
    );
  });

  it("roll a verdict back and say why when saving fails", async () => {
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
    await userEvent.click(approve(RETRIES));
    expect(approve(RETRIES).getAttribute("aria-pressed")).toBe("true");
    fail();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Couldn't save your verdict on “Retries the tax service 3 times with no backoff”. Database locked.",
    );
    expect(approve(RETRIES).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("autosave a comment once typing pauses", async () => {
    const { requests } = renderReview();
    await loaded();
    const field = screen.getByLabelText(
      "Comment on: Retries the tax service 3 times with no backoff",
    );
    await userEvent.type(field, "Add backoff");
    expect(putRequests(requests)).toHaveLength(0);
    expect(await within(decisionCard(RETRIES)).findByText("Saved")).toBeTruthy();
    expect(putRequests(requests)).toHaveLength(1);
    expect(putRequests(requests)[0]?.body).toEqual({ verdict: "pending", comment: "Add backoff" });
  });

  it("are read-only once the review is published", async () => {
    const receipt: PublicationReceipt = {
      url: "https://github.com/acme/shop/pull/128#pullrequestreview-9",
      publishedAt: "2026-10-22T10:00:00Z",
      postedCommentIds: {},
    };
    renderReview({
      view: {
        ...fixture,
        publication: receipt,
        verdicts: [
          {
            decisionId: DecisionId.parse("d2"),
            verdict: "rejected",
            comment: "Check the owner.",
            updatedAt: "2026-10-22T09:59:00Z",
          },
        ],
      },
    });
    await loaded();
    expect(screen.getByRole("link", { name: "Published" }).getAttribute("href")).toBe(receipt.url);
    expect(screen.queryByRole("button", { name: "Publish…" })).toBeNull();
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");
    expect(reject(OWNERSHIP).hasAttribute("disabled")).toBe(true);
    const field = screen.getByLabelText<HTMLTextAreaElement>(
      "Comment on: Looks up the order by ID without checking that it belongs to the user",
    );
    expect(field.value).toBe("Check the owner.");
    expect(field.readOnly).toBe(true);
  });
});

/** The fixture with a longer call chain: route → cache → formatting → money, and a call back. */
const chained: AnalysisView = {
  ...fixture,
  analysis: {
    ...analysis,
    callGraph: [
      ...analysis.callGraph,
      {
        fromHunkId: h.retryAndCache,
        toHunkId: h.receiptRoute,
        symbol: "orders",
        line: 45,
        use: "call",
      },
      {
        fromHunkId: h.retryAndCache,
        toHunkId: h.receiptFormatting,
        symbol: "renderReceipt",
        line: 47,
        use: "call",
      },
    ],
  },
};
/** The imports call cachedReceipt again, after the route in the same step. */
const repeated: AnalysisView = {
  ...fixture,
  analysis: {
    ...analysis,
    callGraph: [
      ...analysis.callGraph,
      {
        fromHunkId: h.routeImports,
        toHunkId: h.retryAndCache,
        symbol: "cachedReceipt",
        line: 5,
        use: "call",
      },
    ],
  },
};
/** findOrderById reaches two hunks from one line of the route. */
const ambiguous: AnalysisView = {
  ...fixture,
  analysis: {
    ...analysis,
    callGraph: [
      ...analysis.callGraph,
      ...[h.retryAndCache, h.receiptFormatting].map((toHunkId) => ({
        fromHunkId: h.receiptRoute,
        toHunkId,
        symbol: "findOrderById",
        line: 15,
        use: "call" as const,
      })),
    ],
  },
};
const chip = (within_: HTMLElement, symbol: string) =>
  within(within_).getByRole("button", { name: new RegExp(`^${symbol} `) });

describe("inline calls", () => {
  it("leave out type uses, which only group code", async () => {
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          callGraph: [
            ...analysis.callGraph,
            {
              fromHunkId: h.receiptRoute,
              toHunkId: h.receiptFormatting,
              symbol: "Receipt",
              line: 12,
              use: "type",
            },
          ],
        },
      },
    });
    await loaded();
    expect(within(cardOf(h.receiptRoute)).queryByRole("button", { name: /^Receipt / })).toBeNull();
    expect(cardOf(h.receiptFormatting).querySelector(".hunk-callers")).toBeNull();
  });

  it("open under the line that calls, nest, and stop at a hunk already open above", async () => {
    renderReview({ view: chained });
    await loaded();
    const route = cardOf(h.receiptRoute);
    const cached = chip(route, "cachedReceipt");
    expect(cached.textContent).toBe("▸cachedReceipt src/services/receipts.ts logic");
    expect(within(route).queryByRole("button", { name: /^calls / })).toBeNull();

    await userEvent.click(cached);
    expect(cached.getAttribute("aria-expanded")).toBe("true");
    const opened = route.querySelector<HTMLElement>(".inline-call");
    if (opened === null) throw new Error("no inline call");
    expect(within(opened).getAllByRole("region")[0]?.getAttribute("aria-label")).toMatch(RECEIPTS);
    // The route is open above, so its call back doesn't open it again.
    expect(within(opened).getByText("open above")).toBeTruthy();
    expect(within(opened).queryByRole("button", { name: /^orders / })).toBeNull();

    await userEvent.click(chip(opened, "renderReceipt"));
    const second = opened.querySelector<HTMLElement>(".inline-call");
    if (second === null) throw new Error("no second level");
    expect(within(second).getAllByRole("region")[0]?.getAttribute("aria-label")).toMatch(
      /^src\/services\/receipts\.ts, lines 1–/,
    );
    // A mechanical hunk opens collapsed, with its proof.
    await userEvent.click(chip(second, "formatMoney"));
    expect(
      within(second).getByRole("button", { name: /moved from src\/routes\/orders\.ts/ }),
    ).toBeTruthy();

    await userEvent.click(cached);
    expect(route.querySelector(".inline-call")).toBeNull();
  });

  it("share the reviewed mark with the hunk's own place", async () => {
    renderReview();
    await loaded();
    await userEvent.click(chip(cardOf(h.receiptRoute), "cachedReceipt"));
    const opened = cardOf(h.receiptRoute).querySelector<HTMLElement>(".inline-call");
    if (opened === null) throw new Error("no inline call");
    await userEvent.click(within(opened).getByRole("checkbox", { name: "Reviewed" }));
    expect(
      within(cardOf(h.retryAndCache)).getByRole<HTMLInputElement>("checkbox", { name: "Reviewed" })
        .checked,
    ).toBe(true);
    expect(screen.getByText("1 of 5 hunks reviewed")).toBeTruthy();
  });

  it("chip only the first call to a hunk in a step, and underline the later ones", async () => {
    renderReview({ view: repeated });
    await loaded();
    expect(chip(cardOf(h.receiptRoute), "cachedReceipt")).toBeTruthy();
    const imports = cardOf(h.routeImports);
    expect(within(imports).queryByRole("button", { name: /^cachedReceipt / })).toBeNull();
    const mention = within(imports).getByRole("button", { name: "cachedReceipt" });
    expect(mention.classList.contains("call-mention")).toBe(true);
    // Both calls come from orders.ts, so the callee lists the file once.
    expect(cardOf(h.retryAndCache).querySelector(".hunk-callers")?.textContent).toBe(
      "Called from orders.ts ↑",
    );
  });

  it("peek at a mention's code on focus, close on Esc, and go there on click", async () => {
    renderReview({ view: repeated });
    await loaded();
    const mention = within(cardOf(h.routeImports)).getByRole("button", { name: "cachedReceipt" });
    mention.focus();
    const peek = await waitFor(() => {
      const shown = document.querySelector<HTMLElement>(".peek");
      if (shown === null) throw new Error("no peek");
      return shown;
    });
    expect(peek.textContent).toContain("src/services/receipts.ts");
    expect(peek.textContent).toContain("step 2: Retrying the tax service and caching receipts");
    // The peek starts at the line that defines the symbol.
    expect(peek.querySelector(".peek-line")?.textContent).toBe(
      "+ export const cachedReceipt = async (order: Order): Promise<string> => {",
    );
    expect(mention.getAttribute("aria-describedby")).toBe(peek.id);
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".peek")).toBeNull();

    await userEvent.click(mention);
    expect(focusedLabel()).toMatch(RECEIPTS);
    await userEvent.keyboard("{Escape}");
    expect(focusedLabel()).toMatch(IMPORTS);
  });

  it("peek at a mention's code after resting on it, and close on leaving it", async () => {
    renderReview({ view: repeated });
    await loaded();
    const mention = within(cardOf(h.routeImports)).getByRole("button", { name: "cachedReceipt" });
    await userEvent.hover(mention);
    expect(document.querySelector(".peek")).toBeNull();
    await waitFor(() => expect(document.querySelector(".peek")).not.toBeNull());
    await userEvent.unhover(mention);
    expect(document.querySelector(".peek")).toBeNull();
  });

  it("make one chip of a symbol that reaches several hunks, and open the one picked", async () => {
    renderReview({ view: ambiguous });
    await loaded();
    const route = cardOf(h.receiptRoute);
    const merged = within(route).getByRole("button", { name: /^findOrderById → 2 places/ });
    await userEvent.click(merged);
    const choices = within(route).getByRole("list", { name: "Where findOrderById goes" });
    const [first, second] = within(choices).getAllByRole("button");
    expect(first?.textContent).toMatch(
      /^findOrderById src\/services\/receipts\.ts logic lines 26–/,
    );
    first?.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard("{Enter}");
    expect(within(route).queryByRole("list", { name: "Where findOrderById goes" })).toBeNull();
    const opened = route.querySelector<HTMLElement>(".inline-call");
    expect(
      within(opened ?? route)
        .getAllByRole("region")[0]
        ?.getAttribute("aria-label"),
    ).toMatch(/^src\/services\/receipts\.ts, lines 1–/);
  });

  it("o goes to the first mention's hunk when a hunk has no chip", async () => {
    renderReview({ view: repeated });
    await loaded();
    cardOf(h.routeImports).focus();
    await userEvent.keyboard("o");
    expect(focusedLabel()).toMatch(RECEIPTS);
  });

  it("o opens and closes the focused hunk's first call", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("j");
    expect(focusedLabel()).toMatch(ROUTE);
    await userEvent.keyboard("o");
    expect(cardOf(h.receiptRoute).querySelector(".inline-call")).not.toBeNull();
    await userEvent.keyboard("o");
    expect(cardOf(h.receiptRoute).querySelector(".inline-call")).toBeNull();
  });
});

const openOverview = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Overview" }));
  return overviewBox();
};
/** The diagram's file nodes by row, as their labels. */
const overviewRows = () => {
  const rows = new Map<string, string[]>();
  for (const node of overviewBox().querySelectorAll<HTMLElement>(
    ".overview-diagram .overview-node",
  )) {
    const label = node.querySelector(".overview-label")?.textContent ?? "";
    rows.set(node.style.top, [...(rows.get(node.style.top) ?? []), label]);
  }
  return [...rows.values()];
};
const nodeOf = (path: string) => {
  const node = overviewBox().querySelector<HTMLElement>(`[data-key="${path}"]`);
  if (node === null) throw new Error(`no node for ${path}`);
  return node;
};
const focusedKey = () => (document.activeElement as HTMLElement | null)?.dataset.key;
const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";

describe("overview", () => {
  it("draws the changed files from the entry down, with unlinked ones in the strip", async () => {
    renderReview();
    await loaded();
    await openOverview();
    expect(overviewRows()).toEqual([["orders.ts"], ["receipts.ts"]]);
    const strip = within(overviewBox()).getByRole("region", { name: "Not linked" });
    expect(within(strip).getByRole("button", { name: /^package\.json, contract/ })).toBeTruthy();
    // Proved-mechanical files aren't in it: the map lists them with their proofs.
    expect(overviewBox().querySelector('[data-key="pnpm-lock.yaml"]')).toBeNull();
  });

  it("opens a file's first hunk in the map on a click, and Esc goes back to its node", async () => {
    renderReview();
    await loaded();
    await openOverview();
    await userEvent.click(nodeOf("src/services/receipts.ts"));
    expect(pressed("Map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.retryAndCache}`);
    await userEvent.keyboard("{Escape}");
    expect(pressed("Overview")).toBe(true);
    expect(focusedKey()).toBe("src/services/receipts.ts");
  });

  it("moves between files with the arrows, and Enter opens one", async () => {
    renderReview();
    await loaded();
    await openOverview();
    nodeOf("src/routes/orders.ts").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedKey()).toBe("src/services/receipts.ts");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedKey()).toBe("package.json");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(focusedKey()).toBe("src/routes/orders.ts");
    // A focused file names its flows and what it reaches, for the keyboard.
    expect(
      screen.getByText(
        "src/routes/orders.ts · read in The receipt endpoint · reaches receipts.ts (cachedReceipt).",
      ),
    ).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(pressed("Map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.receiptRoute}`);
  });

  it("ticks a file when all its hunks are reviewed, and counts them otherwise", async () => {
    window.localStorage.setItem(
      "megareviewer:reviewed-hunks",
      JSON.stringify([h.retryAndCache, h.receiptFormatting, h.receiptRoute]),
    );
    renderReview();
    await loaded();
    await openOverview();
    expect(
      within(nodeOf("src/services/receipts.ts")).getByRole("img", { name: "reviewed" }),
    ).toBeTruthy();
    expect(nodeOf("src/routes/orders.ts").getAttribute("aria-label")).toMatch(
      /1 of 2 hunks reviewed$/,
    );
    expect(within(nodeOf("src/routes/orders.ts")).getByText("1/2")).toBeTruthy();
  });

  it("names what an edge carries", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const edge = overviewBox().querySelector(".overview-edge");
    expect(edge?.classList.contains("call")).toBe(true);
    expect(edge?.querySelector("title")?.textContent).toBe(
      "orders.ts imports, calls receipts.ts: cachedReceipt",
    );
  });
  it("names what an edge carries on hover, and lights the hovered file's edges", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const edge = overviewBox().querySelector(".overview-edge");
    if (edge === null) throw new Error("no edge");
    await userEvent.hover(edge);
    expect(overviewBox().querySelector(".overview-detail")?.textContent).toBe(
      "orders.ts imports, calls receipts.ts: cachedReceipt",
    );
    await userEvent.unhover(edge);
    await userEvent.hover(nodeOf("src/services/receipts.ts"));
    expect(edge.classList.contains("lit")).toBe(true);
    await userEvent.unhover(nodeOf("src/services/receipts.ts"));
    expect(screen.getByText(/^Hover or focus a file/)).toBeTruthy();
  });

  it("groups a large PR's files by directory, and opens a group in place", async () => {
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
    await userEvent.click(nodeOf("group:src/module1"));
    expect(overviewBox().querySelector('[data-key="group:src/module1"]')).toBeNull();
    expect(nodeOf("src/module1/part7.ts")).toBeTruthy();
    // A file in a closed group, picked in the palette, opens its group.
    await userEvent.keyboard("t");
    await userEvent.keyboard("/module3/part9");
    await userEvent.keyboard("{Enter}");
    expect(focusedKey()).toBe("src/module3/part9.ts");

    await userEvent.click(screen.getByRole("button", { name: "Collapse src/module1/" }));
    expect(nodeOf("group:src/module1")).toBeTruthy();
  });
});

describe("layouts", () => {
  it("switch with v, keeping the file the reviewer is on", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("jj");
    expect(focusedLabel()).toMatch(IMPORTS);
    await userEvent.keyboard("v");
    expect(pressed("Overview")).toBe(true);
    expect(focusedKey()).toBe("src/routes/orders.ts");

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("v");
    expect(pressed("Map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.retryAndCache}`);
    expect(focusedLabel()).toMatch(RECEIPTS);
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
    expect(pressed("Overview")).toBe(true);
  });
});

describe("jump palette", () => {
  const palette = () => screen.getByRole("dialog", { name: "Jump to" });

  it("opens with ⌘K, Ctrl+K and t, and Esc closes it", async () => {
    renderReview();
    await loaded();
    for (const keys of ["{Meta>}k{/Meta}", "{Control>}k{/Control}", "t"]) {
      await userEvent.keyboard(keys);
      expect(palette()).toBeTruthy();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("filters as it's typed; arrows move and Enter goes to a decision's card", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("t");
    await userEvent.keyboard("receipt");
    const groups = within(palette())
      .getAllByRole("region")
      .map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Decisions", "Mismatches", "Symbols", "Steps", "Files"]);
    await userEvent.clear(within(palette()).getByRole("searchbox", { name: "Jump to" }));
    await userEvent.keyboard("!dayjs");
    expect(within(palette()).getAllByRole("region")).toHaveLength(1);
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scrolledTo().at(-1)).toBe("decision-d5");
    expect(decisionCard(DAYJS).classList.contains("selected")).toBe(true);
  });

  it("jumps to a contract hunk by its reason, and to a symbol's hunk", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("t");
    await userEvent.keyboard("!runtime dependency");
    await userEvent.keyboard("{Enter}");
    expect(focusedLabel()).toMatch(/^package\.json/);
    await userEvent.keyboard("t");
    await userEvent.keyboard("@cached");
    await userEvent.click(within(palette()).getByRole("button", { name: /^cachedReceipt/ }));
    expect(focusedLabel()).toMatch(RECEIPTS);
  });

  it("selects a decision's file in the overview, and Enter opens its code", async () => {
    renderReview();
    await loaded();
    await openOverview();
    await userEvent.keyboard("t");
    await userEvent.keyboard("!belongs");
    await userEvent.keyboard("{Enter}");
    expect(focusedKey()).toBe("src/routes/orders.ts");
    await userEvent.keyboard("{Enter}");
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.receiptRoute}`);
  });
});

describe("keyboard shortcuts", () => {
  it("move through hunks with j and k, and between steps with n and p", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("j");
    expect(focusedLabel()).toMatch(ROUTE);
    await userEvent.keyboard("j");
    expect(focusedLabel()).toMatch(IMPORTS);
    await userEvent.keyboard("k");
    expect(focusedLabel()).toMatch(ROUTE);

    await userEvent.keyboard("n");
    expect(scrolledTo().at(-1)).toBe("step-s2");
    await userEvent.keyboard("j");
    expect(focusedLabel()).toMatch(RECEIPTS);
    await userEvent.keyboard("p");
    expect(scrolledTo().at(-1)).toBe("step-s1");
    await userEvent.keyboard("p");
    expect(scrolledTo().at(-1)).toBe("step-s1");
  });

  it("give verdicts and comments on the decision of the hunk the reviewer is on", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("a");
    expect(approve(ENDPOINT).getAttribute("aria-pressed")).toBe("false");

    await userEvent.keyboard("j");
    await userEvent.keyboard("r");
    expect(reject(ENDPOINT).getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(approve(OWNERSHIP));
    expect(decisionCard(OWNERSHIP).classList.contains("selected")).toBe(true);
    await userEvent.keyboard("r");
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");

    await userEvent.keyboard("c");
    const field = screen.getByLabelText(
      "Comment on: Looks up the order by ID without checking that it belongs to the user",
    );
    expect(document.activeElement).toBe(field);
    // Typed into the field, these are text, not shortcuts.
    await userEvent.keyboard("ran");
    expect((field as HTMLTextAreaElement).value).toBe("ran");
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");
  });

  it("are listed for each layout, and none fire while the list is open", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const keysOf = (name: string) =>
      within(within(dialog).getByRole("region", { name }))
        .getAllByRole("term")
        .map((term) => term.textContent);
    expect(keysOf("Map")).toEqual(["j", "k", "n", "p", "o", "x", "]", "[", "a", "r", "c", "Esc"]);
    expect(keysOf("Overview")).toEqual(["←→↑↓", "Enter"]);
    expect(keysOf("Both layouts")).toEqual(["⌘Kt", "v", "?"]);
    await userEvent.keyboard("j");
    expect(focusedLabel()).not.toMatch(ROUTE);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("navigation", () => {
  it("follows a caller's file to its first calling hunk, and Esc goes back", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("n");
    await userEvent.keyboard("j");
    const callers = cardOf(h.retryAndCache).querySelector<HTMLElement>(".hunk-callers");
    expect(callers?.textContent).toBe("Called from orders.ts ↑");
    await userEvent.click(
      within(cardOf(h.retryAndCache)).getByRole("button", { name: "orders.ts ↑" }),
    );
    expect(focusedLabel()).toMatch(ROUTE);
    await userEvent.keyboard("{Escape}");
    expect(focusedLabel()).toMatch(RECEIPTS);
  });

  it("marks hunks reviewed, counts them, and remembers them by hunk", async () => {
    const { unmount } = renderReview();
    await loaded();
    await userEvent.click(
      within(cardOf(h.receiptRoute)).getByRole("checkbox", { name: "Reviewed" }),
    );
    expect(screen.getByText("1 of 5 hunks reviewed")).toBeTruthy();
    expect(window.localStorage.getItem("megareviewer:reviewed-hunks")).toContain(h.receiptRoute);

    unmount();
    renderReview();
    await loaded();
    expect(
      within(cardOf(h.receiptRoute)).getByRole<HTMLInputElement>("checkbox", { name: "Reviewed" })
        .checked,
    ).toBe(true);
  });

  it("x marks the focused hunk reviewed and moves on; ] finds the next unreviewed one", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("jxx");
    expect(screen.getByText("2 of 5 hunks reviewed")).toBeTruthy();
    expect(
      within(rail()).getByRole("button", { name: /^1 The receipt endpoint/ }).textContent,
    ).toContain("✓");
    await userEvent.keyboard("]");
    expect(focusedLabel()).toMatch(RECEIPTS);
    // "[[" types one "[" in user-event's key syntax.
    await userEvent.keyboard("[[");
    expect(focusedLabel()).toMatch(RECEIPTS);
  });
});

describe("without the model", () => {
  const withoutModel: AnalysisView = {
    ...fixture,
    analysis: {
      ...analysis,
      intent: null,
      decisions: [],
      risk: analysis.risk.map((risk) =>
        risk.source === "model" ? { ...risk, source: "rule" as const } : risk,
      ),
      stages: { ...analysis.stages, intent: "skipped", decisions: "skipped" },
      pullRequest:
        analysis.pullRequest === null
          ? null
          : {
              ...analysis.pullRequest,
              description: "\nAdds receipts. <b>Not bold</b>\n\nMoves formatMoney too.",
            },
    },
  };

  it("shows the title and the description's first line, rule marks only, and no decision cards", async () => {
    renderReview({ view: withoutModel });
    await loaded();
    expect(screen.getByText("Asked:")).toBeTruthy();
    expect(screen.getByText("Adds receipts. <b>Not bold</b>")).toBeTruthy();
    expect(screen.queryByText(/Moves formatMoney too/)).toBeNull();
    expect(document.querySelector(".mismatch-chip")).toBeNull();
    expect(rail().querySelectorAll(".rail-bars .mark-decision")).toHaveLength(0);
    expect(rail().querySelectorAll(".rail-bars .mark-rule")).toHaveLength(2);
    expect(screen.queryByRole("article")).toBeNull();
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

  it("writes a comment from a line number, keeps it, and publishes it with the chosen verdict", async () => {
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
    const field = within(mainArea()).getByRole<HTMLTextAreaElement>("textbox", {
      name: `Comment on line ${line}`,
    });
    expect(field.value).toBe("Why this?");

    await userEvent.click(screen.getByRole("button", { name: "Publish…" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish the review" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Request changes" }));
    expect(await within(dialog).findByText("Request changes", { selector: "strong" })).toBeTruthy();
    expect(within(dialog).getByText("Why this?")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    // The view here is fixed, so it never turns published; the request is what matters.
    await waitFor(() =>
      expect(
        again.requests.find((request) => request.url === `${viewPath}/publication`)?.body,
      ).toMatchObject({
        verdict: "request_changes",
        hunkComments: [{ side: "new", line, body: "Why this?" }],
      }),
    );
    expect(requests.some((request) => request.url === `${viewPath}/publication`)).toBe(false);
  });

  it("removes a comment that's emptied, and c opens one on the focused hunk", async () => {
    renderReview({ view: withoutDecisions });
    await loaded();
    await userEvent.keyboard("jc");
    const field = within(mainArea()).getByRole("textbox", { name: /^Comment on (old )?line \d+$/ });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "x");
    await userEvent.clear(field);
    await userEvent.tab();
    expect(within(mainArea()).queryByRole("textbox", { name: /^Comment on/ })).toBeNull();
    expect(window.localStorage.getItem(`megareviewer:hunk-comments:${id}`)).toBe("[]");
  });
});

describe("publishing", () => {
  const openDialog = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Publish…" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish the review" });
    await within(dialog).findByText(/^Verdict:/);
    return dialog;
  };

  it("previews exactly what will be posted, updating with the summary", async () => {
    renderReview();
    await loaded();
    await userEvent.click(reject(OWNERSHIP));
    await userEvent.type(
      screen.getByLabelText(
        "Comment on: Looks up the order by ID without checking that it belongs to the user",
      ),
      "Check the owner.",
    );
    const dialog = await openDialog();
    expect(within(dialog).getByText(/^Verdict:/).textContent).toBe("Verdict: Request changes");
    expect(
      within(dialog).getByText(
        "4 decisions aren't reviewed yet. The summary lists them as not reviewed.",
      ),
    ).toBeTruthy();
    const comments = within(dialog).getAllByRole("listitem");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.textContent).toBe(
      "src/routes/orders.ts:13**Rejected: Looks up the order by ID without checking that it belongs to the user**\n\nCheck the owner.",
    );

    await userEvent.type(within(dialog).getByLabelText("Summary"), "One blocker.");
    await waitFor(() => expect(within(dialog).getByText(/^One blocker\./)).toBeTruthy());
  });

  it("explains a Comment verdict when the reviewer is the author", async () => {
    renderReview({ view: { ...fixture, isAuthor: true } });
    await loaded();
    const dialog = await openDialog();
    expect(within(dialog).getByText(/^Verdict:/).textContent).toBe("Verdict: Comment");
    expect(within(dialog).getByText(/^You opened this pull request/)).toBeTruthy();
  });

  it("publishes, closes and shows the link to the review", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(approve(RETRIES));
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.find((request) => request.url === `${viewPath}/publication`)?.body).toEqual({
      summary: "",
      allowStale: false,
      hunkComments: [],
      verdict: null,
    });
    expect(approve(RETRIES).hasAttribute("disabled")).toBe(true);
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(
      await within(dialog).findByText("This PR changed since the analysis. Publish anyway?"),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish anyway" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
    const publishes = requests.filter((request) => request.url === `${viewPath}/publication`);
    expect(publishes.map((request) => request.body)).toEqual([
      { summary: "", allowStale: false, hunkComments: [], verdict: null },
      { summary: "", allowStale: true, hunkComments: [], verdict: null },
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("The git host returned an error: GitHub returned 502.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Published" })).toBeTruthy();
  });

  it("saves a comment still waiting for its pause before previewing", async () => {
    renderReview();
    await loaded();
    await userEvent.type(
      screen.getByLabelText("Comment on: Retries the tax service 3 times with no backoff"),
      "Add jitter",
    );
    const dialog = await openDialog();
    expect(within(dialog).getAllByRole("listitem")[0]?.textContent).toContain("Add jitter");
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
