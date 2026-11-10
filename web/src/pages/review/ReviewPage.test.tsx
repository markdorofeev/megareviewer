import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "../../../../contracts/index.ts";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import {
  AnalysisId,
  DecisionId,
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
import { type Highlighter, HighlighterContext } from "../../diff/index.ts";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse, type RecordedRequest } from "../../testing/fetch.ts";
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
/** The map's file cards, by path, in page order. */
const fileCards = () =>
  [...mainArea().querySelectorAll(".file-card")].map((card) => card.getAttribute("aria-label"));
/** A hunk's place in the map: its card, or its collapsed row. */
const placeOf = (hunkId: PartId) => {
  const place = document.getElementById(`hunk-${hunkId}`);
  if (place === null) throw new Error(`no hunk ${hunkId} in the map`);
  return place;
};
/** The card of a step's parts from one file, named by its path. */
const fileCardOf = (path: string) => screen.getByRole("region", { name: path });
const cardOf = (hunkId: PartId) => {
  const card = placeOf(hunkId).querySelector<HTMLElement>(":scope > .hunk-card");
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
const _RECEIPTS = /^src\/services\/receipts\.ts, lines 26–/;
/** The retry and cache hunk's two parts. */
const RETRY = /^src\/services\/receipts\.ts, lines 26–39$/;

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

  it("shows each part of a running analysis as soon as its data exists", async () => {
    const { setView } = renderReview({
      view: { ...fixture, analysis: analysisInProgress(analysis, 2) },
    });
    await loaded();
    const progress = screen.getByRole("list", { name: "Analysis progress" });
    expect(progress.textContent).toContain("Prepare: done");
    expect(progress.textContent).toContain("Intent: running");
    expect(screen.getByText("Working out the intent…")).toBeTruthy();
    expect(fileCards()).toContain("src/routes/orders.ts");
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
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Analysis progress" })).toBeNull(),
    );
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
    expect(fileCards()).toContain("src/routes/orders.ts");

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
  it("names the PR once, by its title and a link", async () => {
    renderReview();
    await loaded();
    const link = screen.getByRole("link", { name: "shop #128" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/shop/pull/128");
    expect(screen.queryByText(/Sam Rivera/)).toBeNull();
    expect(screen.queryByText(/shop-142-order-receipts/)).toBeNull();
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
    // The split hunk's first part on the page.
    expect(focusedLabel()).toMatch(RETRY);
    expect(cardOf(h.receiptRoute).classList.contains("highlighted")).toBe(false);
    expect(cardOf(p.retry).classList.contains("highlighted")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(cardOf(p.cache).classList.contains("highlighted")).toBe(false);
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
        .map((row) => row.title),
    ).toEqual(["src/routes/orders.ts", "src/services/receipts.ts", "package.json"]);
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.querySelector(".review-body.map")?.children).toHaveLength(2);
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
    expect(screen.getByRole("button", { name: "Overview" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await userEvent.keyboard("v");
    expect(fileCards()).toHaveLength(3);
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

const openOverview = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Overview" }));
  return overviewBox();
};
/** The diagram's file nodes by row, as their labels. */
const overviewRows = () => {
  const rows = new Map<string, string[]>();
  for (const box of overviewBox().querySelectorAll<HTMLElement>(
    ".overview-diagram .overview-node-box",
  )) {
    const label = box.querySelector(".overview-label")?.textContent ?? "";
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
const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";

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
    expect(pressed("Map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe("file-src/services/receipts.ts");
    await userEvent.keyboard("{Escape}");
    expect(pressed("Overview")).toBe(true);
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
    expect(pressed("Map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe("file-src/routes/orders.ts");
  });

  it("names what an edge carries", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const edge = overviewBox().querySelector(".overview-edge");
    expect(edge?.classList.contains("call")).toBe(true);
    expect(edge?.querySelector("title")?.textContent).toBe(
      "src/routes/ imports, calls src/services/: cachedReceipt",
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
      "src/routes/ imports, calls src/services/: cachedReceipt",
    );
    await userEvent.unhover(edge);
    await userEvent.hover(nodeOf("group:src/services"));
    expect(edge.classList.contains("lit")).toBe(true);
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
  it("switch with v, keeping the file the reviewer is on", async () => {
    renderReview();
    await loaded();
    await userEvent.click(cardOf(h.routeImports));
    expect(focusedLabel()).toMatch(IMPORTS);
    await userEvent.keyboard("v");
    expect(pressed("Overview")).toBe(true);
    expect(focusedKey()).toBe("group:src/routes");

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("v");
    expect(pressed("Map")).toBe(true);
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
    expect(pressed("Overview")).toBe(true);
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

  it("give verdicts and comments on the decision of the hunk the reviewer is on", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("a");
    expect(approve(ENDPOINT).getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(cardOf(h.receiptRoute));
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
    expect(keysOf("Map")).toEqual(["n", "p", "a", "r", "c", "Esc"]);
    expect(keysOf("Overview")).toEqual(["←→↑↓", "Enter"]);
    expect(keysOf("Both layouts")).toEqual(["v", "?"]);
    await userEvent.keyboard("v");
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
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
    expect(cache.querySelector(".hunk-part")).toBeNull();
    expect(within(cache).queryByText("Related parts")).toBeNull();
    // No lines lie between the two parts of one hunk, so no fold either.
    expect(placeOf(p.retry).nextElementSibling).toBe(placeOf(p.cache));
  });

  it("put a decision's card on the first part on the page, and link the other to it", async () => {
    renderReview();
    await loaded();
    expect(within(cardOf(p.retry)).getByRole("article", { name: RETRIES })).toBeTruthy();
    expect(within(cardOf(p.cache)).queryByRole("article", { name: RETRIES })).toBeNull();
    expect(cardOf(p.cache).querySelector(".decision-mention")?.textContent).toMatch(RETRIES);
  });

  it("show a comment in the part that holds its line", async () => {
    window.localStorage.setItem(
      `megareviewer:hunk-comments:${id}`,
      JSON.stringify([{ hunkId: h.retryAndCache, side: "new", line: 45, body: "Evict these." }]),
    );
    renderReview();
    await loaded();
    expect(
      within(cardOf(p.cache)).getByRole("textbox", { name: "Comment on line 45" }),
    ).toBeTruthy();
    // The retry part holds the decision's card, whose own box isn't a line's.
    expect(within(cardOf(p.retry)).queryByRole("textbox", { name: /^Comment on line/ })).toBeNull();
  });
});

describe("navigation", () => {
  it("count a file's contract parts on its card, and give each its reason on its own line", async () => {
    renderReview();
    await loaded();
    const route = analysis.risk.find((risk) => risk.hunkId === h.receiptRoute);
    const orders = fileCardOf("src/routes/orders.ts");
    expect(orders.querySelector(".file-card-header .count-contract")?.textContent).toBe(
      "1 contract · ",
    );
    expect(orders.querySelector(".file-card-header .hunk-contract-reason")).toBeNull();
    const divider = cardOf(h.receiptRoute).querySelector(".hunk-header");
    expect(divider?.querySelector(".hunk-contract-reason")?.textContent).toBe(route?.reason);
    // The gutter numbers the lines and the header counts the changes, so the divider doesn't.
    expect(divider?.textContent).toBe(route?.reason);
    // The imports are logic and link nowhere else: nothing to say, so no divider.
    expect(cardOf(h.routeImports).querySelector(".hunk-header")).toBeNull();
    // Git's section heading, a line from above the hunk, isn't on a divider.
    expect(divider?.querySelector(".hunk-heading")).toBeNull();
    // The risk is a bar beside the lines, not a badge on the line.
    expect(within(cardOf(h.receiptRoute)).queryByRole("button", { name: "contract" })).toBeNull();
    expect(cardOf(h.receiptRoute).querySelector(".part-risk.risk-contract")).not.toBeNull();
  });

  it("name a file on its card without a status for modified, a part count or a Reviewed mark", async () => {
    renderReview();
    await loaded();
    const orders = fileCardOf("src/routes/orders.ts");
    expect(orders.querySelector(".file-status")).toBeNull();
    expect(orders.querySelector(".file-card-header")?.textContent).not.toMatch(/part/);
    expect(within(orders).queryByRole("checkbox")).toBeNull();
    // The line between the imports and the route is a fold.
    const gap = orders.querySelector(".file-gap.folded");
    expect(gap?.textContent).toBe("1 line unchanged");
    expect(gap?.querySelector("svg.unfold-icon")).not.toBeNull();
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

  it("shows the title and the description's first sentence, rule marks only, and no decision cards", async () => {
    renderReview({ view: withoutModel });
    await loaded();
    // Markup is text, and doesn't start a sentence.
    expect(screen.getByText("Adds receipts. <b>Not bold</b>")).toBeTruthy();
    expect(screen.queryByText(/Moves formatMoney too/)).toBeNull();
    expect(document.querySelector(".mismatch-chip")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("offers Publish to the author only once there's something to post", async () => {
    const { unmount } = renderReview({ view: { ...withoutModel, isAuthor: true } });
    await loaded();
    expect(screen.queryByRole("button", { name: "Publish…" })).toBeNull();
    window.localStorage.setItem(
      `megareviewer:hunk-comments:${id}`,
      JSON.stringify([{ hunkId: h.receiptRoute, side: "new", line: 12, body: "Check the owner." }]),
    );
    unmount();
    renderReview({ view: { ...withoutModel, isAuthor: true } });
    await loaded();
    expect(screen.getByRole("button", { name: "Publish…" })).toBeTruthy();
  });

  it("offers Publish to a reviewer with nothing but a verdict to give", async () => {
    renderReview({ view: withoutModel });
    await loaded();
    expect(screen.getByRole("button", { name: "Publish…" })).toBeTruthy();
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
    await userEvent.click(cardOf(h.routeImports));
    await userEvent.keyboard("c");
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
    const uses = [...card.querySelectorAll(".unchanged-uses > li")];
    expect(uses.map((use) => use.querySelector(".unchanged-place")?.textContent)).toEqual([
      "src/jobs/email-receipts.ts:14",
      "test/jobs/email-receipts.test.ts:31",
    ]);
    const used = uses[0]?.querySelector(".unchanged-line.used");
    expect(used?.textContent).toBe("14    const text = await renderReceipt(order);");
    expect(uses[0]?.querySelectorAll(".unchanged-line")).toHaveLength(5);
    // Only the card of the part that changes the definition says so.
    expect(within(cardOf(h.receiptRoute)).queryByText(/Used unchanged/)).toBeNull();
  });

  it("shows a faded node per caller file in the overview, opening the code it uses", async () => {
    renderReview();
    await loaded();
    await openOverview();
    const outside = nodeOf("outside:src/jobs/email-receipts.ts");
    expect(outside.classList.contains("outside")).toBe(true);
    expect(outside.getAttribute("aria-label")).toBe("email-receipts.ts, outside the PR · 1 use");
    act(() => outside.focus());
    expect(overviewBox().querySelector(".overview-detail")?.textContent).toBe(
      "src/jobs/email-receipts.ts · outside the pull request · uses src/services/ (renderReceipt).",
    );
    expect(overviewBox().querySelector(".overview-legend")?.textContent).toContain(
      "Faded files are outside the pull request, under the code whose changes they use.",
    );
    await userEvent.click(outside);
    expect(pressed("Map")).toBe(true);
    expect(scrolledTo().at(-1)).toBe(`hunk-${h.receiptFormatting}`);
  });

  it("says in the details why nothing outside is shown without a checkout", async () => {
    renderReview({ view: withCheckout("none") });
    await loaded();
    expect(
      within(await openDetails()).getByText(/didn't run in a checkout of acme\/shop/),
    ).toBeTruthy();
    expect(document.querySelector(".hunk-outside")).toBeNull();
  });

  it("says in the details to fetch the head commit when the checkout lacks it", async () => {
    renderReview({ view: withCheckout("missing-commit") });
    await loaded();
    const details = await openDetails();
    expect(details.querySelector(".checkout-note")?.textContent).toBe(
      "Code outside the pull request that calls what it changes isn't shown: the local checkout doesn't have the head commit 9e8d7c6. Run git fetch in it, or git fetch origin pull/128/head for a pull request from a fork, then open the pull request again.",
    );
  });

  it("says nothing about the checkout in the details when one was read", async () => {
    renderReview();
    await loaded();
    expect((await openDetails()).querySelector(".checkout-note")).toBeNull();
  });
});
