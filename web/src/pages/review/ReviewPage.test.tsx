import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "../../../../contracts/index.ts";
import {
  AnalysisId,
  DecisionId,
  type PublicationReceipt,
} from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
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
const mainHeading = () => within(mainArea()).getAllByRole("heading", { level: 2 })[0]?.textContent;
const tour = () => screen.getByRole("navigation", { name: "Tour" });
const decisions = () => screen.getByRole("region", { name: "Decisions" });
const approve = (title: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`^Approve: ${title.source}`) });
const reject = (title: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`^Reject: ${title.source}`) });
const OWNERSHIP = /Looks up the order by ID/;
const RETRIES = /Retries the tax service/;
const putRequests = (requests: readonly RecordedRequest[]) =>
  requests.filter((request) => request.method === "PUT");

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("ReviewPage states", () => {
  it("shows a skeleton while loading, then the review", async () => {
    renderReview();
    expect(screen.getByLabelText("Loading the analysis")).toBeTruthy();
    await loaded();
    expect(screen.queryByLabelText("Loading the analysis")).toBeNull();
    expect(mainHeading()).toBe("The receipt endpoint");
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

  it("shows each section of a running analysis as soon as its data exists", async () => {
    const { setView } = renderReview({
      view: { ...fixture, analysis: analysisInProgress(analysis, 2) },
    });
    await loaded();
    const progress = screen.getByRole("list", { name: "Analysis progress" });
    expect(progress.textContent).toContain("Prepare: done");
    expect(progress.textContent).toContain("Intent: running");
    expect(screen.getByText("Working out the intent…")).toBeTruthy();
    expect(mainHeading()).toBe("Changes by file");
    expect(within(mainArea()).getAllByRole("region", { name: /, lines / })).toHaveLength(5);
    expect(within(mainArea()).getByRole("heading", { name: "Mechanical changes 6" })).toBeTruthy();
    expect(screen.getByText("Building the tour…")).toBeTruthy();

    setView({ ...fixture, analysis: analysisInProgress(analysis, 4) });
    expect(await screen.findByRole("region", { name: "Intent" })).toBeTruthy();
    expect(screen.getByText("Finding the decisions the code makes…")).toBeTruthy();

    setView({ ...fixture, analysis: analysisInProgress(analysis, 5) });
    expect(
      await screen.findByText("You can give verdicts once the analysis is complete."),
    ).toBeTruthy();
    expect(approve(OWNERSHIP).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Publish…" }).hasAttribute("disabled")).toBe(true);

    setView(fixture);
    await waitFor(() => expect(mainHeading()).toBe("The receipt endpoint"));
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
    expect(screen.getByRole("region", { name: "Intent" })).toBeTruthy();
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

describe("intent panel", () => {
  it("shows stated and inferred intent side by side when they disagree", async () => {
    renderReview();
    await loaded();
    const intent = screen.getByRole("region", { name: "Intent" });
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
    const details = intent.querySelector("details");
    expect(details?.open).toBe(false);
    expect(within(intent).getByText(/^Details/).textContent).toBe(
      `Details (${analysis.intent?.inferred.behaviorChanges.length})`,
    );
    expect(within(intent).queryByRole("heading", { name: "Asked" })).toBeNull();
  });

  it("is one line when the code does what was asked, with the stated intent in the details", async () => {
    renderReview({ view: withIntent({ mismatches: [] }) });
    await loaded();
    const intent = screen.getByRole("region", { name: "Intent" });
    expect(within(intent).getByText("✓ Does what was asked:")).toBeTruthy();
    expect(within(intent).getByText(analysis.intent?.inferred.summary ?? "")).toBeTruthy();
    expect(within(intent).queryByRole("heading", { name: "Inferred from the code" })).toBeNull();
    expect(within(intent).getByRole("list", { name: "Sources" })).toBeTruthy();

    await userEvent.click(within(intent).getByText(/^Details/));
    expect(intent.querySelector("details")?.open).toBe(true);
    expect(within(intent).getByRole("heading", { name: "Asked" })).toBeTruthy();
    expect(within(intent).getByText(analysis.intent?.stated?.summary ?? "")).toBeTruthy();
  });

  it("is one line from the code when nothing was stated and nothing disagrees", async () => {
    renderReview({ view: withIntent({ stated: null, mismatches: [] }) });
    await loaded();
    const intent = screen.getByRole("region", { name: "Intent" });
    expect(within(intent).getByText("From the code:")).toBeTruthy();
    expect(
      within(intent).getByText("No stated intent: the PR has no description or linked tickets."),
    ).toBeTruthy();
    expect(within(intent).queryByText("✓ Does what was asked:")).toBeNull();
    expect(within(intent).queryByRole("heading", { name: "Asked" })).toBeNull();
  });

  it("leaves the details out when there's nothing in them", async () => {
    renderReview({
      view: withIntent({
        stated: null,
        mismatches: [],
        inferred: { summary: "Renames a variable.", behaviorChanges: [] },
      }),
    });
    await loaded();
    const intent = screen.getByRole("region", { name: "Intent" });
    expect(intent.querySelector("details")).toBeNull();
  });

  it("says when nothing was stated", async () => {
    renderReview({ view: withIntent({ stated: null }) });
    await loaded();
    expect(
      screen.getByText("No stated intent: the PR has no description or linked tickets."),
    ).toBeTruthy();
  });

  it("shows a mismatch's hunks when it's clicked, and goes back to the tour", async () => {
    renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: /Contradicts/ }));
    expect(mainHeading()).toMatch(/^SHOP-142 says only the customer/);
    const cards = within(mainArea()).getAllByRole("region");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.classList.contains("highlighted")).toBe(true);
    expect(within(tour()).queryByRole("button", { current: "step" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Back to tour/ }));
    expect(mainHeading()).toBe("The receipt endpoint");
  });

  it("remembers being collapsed for this analysis", async () => {
    const first = renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByText("Inferred from the code").closest("[hidden]")).not.toBeNull();
    first.unmount();

    renderReview();
    await loaded();
    expect(screen.getByRole("button", { name: "Show" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
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
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByRole("button", { name: "Show" })).toBeTruthy();
  });
});

describe("tour", () => {
  it("moves through the steps with Prev and Next, marking each visited", async () => {
    renderReview();
    await loaded();
    expect(within(mainArea()).getByText("Step 1 of 4")).toBeTruthy();
    expect(within(tour()).getByRole("button", { current: "step" }).textContent).toContain(
      "The receipt endpoint",
    );
    expect(screen.getByRole("button", { name: "← Prev" }).hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(mainHeading()).toBe("Retrying the tax service and caching receipts");
    expect(within(mainArea()).getAllByRole("region")).toHaveLength(1);
    const visited = within(tour())
      .getAllByRole("button")
      .filter((entry) => entry.textContent?.includes("(visited)"));
    expect(visited).toHaveLength(2);
  });

  it("remembers visited steps for this analysis", async () => {
    const first = renderReview();
    await loaded();
    await userEvent.click(within(tour()).getByRole("button", { name: /The new dependency/ }));
    first.unmount();

    renderReview();
    await loaded();
    expect(
      within(tour()).getByRole("button", { name: /The new dependency/ }).textContent,
    ).toContain("(visited)");
    expect(
      within(tour()).getByRole("button", { name: /Dates and prices/ }).textContent,
    ).not.toContain("(visited)");
  });

  it("ends with the mechanical changes", async () => {
    renderReview();
    await loaded();
    await userEvent.click(within(tour()).getByRole("button", { name: "Mechanical changes (6)" }));
    expect(screen.getByRole("heading", { name: "Mechanical changes 6" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next →" }).hasAttribute("disabled")).toBe(true);
  });

  it("says when the tour is the fallback grouped by file", async () => {
    renderReview({
      view: {
        ...fixture,
        analysis: {
          ...analysis,
          tour:
            analysis.tour === null ? null : { ...analysis.tour, builtBy: "file-order" as const },
        },
      },
    });
    await loaded();
    expect(
      screen.getByText("The model's tour wasn't usable, so changes are grouped by file."),
    ).toBeTruthy();
  });
});

describe("decisions", () => {
  it("counts reviewed decisions and saves a verdict at once", async () => {
    const { requests } = renderReview();
    await loaded();
    expect(within(decisions()).getByText("0 of 5 reviewed")).toBeTruthy();
    await userEvent.click(reject(OWNERSHIP));
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");
    expect(within(decisions()).getByText("1 of 5 reviewed")).toBeTruthy();
    await waitFor(() => expect(putRequests(requests)).toHaveLength(1));
    expect(putRequests(requests)[0]).toMatchObject({
      url: `${viewPath}/verdicts/d2`,
      body: { verdict: "rejected", comment: "" },
    });
  });

  it("returns a verdict to pending when its active button is clicked again", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(approve(RETRIES));
    await userEvent.click(approve(RETRIES));
    expect(approve(RETRIES).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() =>
      expect(putRequests(requests).at(-1)?.body).toMatchObject({ verdict: "pending" }),
    );
  });

  it("rolls a verdict back and says why when saving fails", async () => {
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
    const alert = await within(screen.getByRole("complementary")).findByRole("alert");
    expect(alert.textContent).toContain(
      "Couldn't save your verdict on “Retries the tax service 3 times with no backoff”. Database locked.",
    );
    expect(approve(RETRIES).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(within(screen.getByRole("complementary")).queryByRole("alert")).toBeNull();
  });

  it("autosaves a comment once typing pauses", async () => {
    const { requests } = renderReview();
    await loaded();
    const field = screen.getByLabelText(
      "Comment on: Retries the tax service 3 times with no backoff",
    );
    await userEvent.type(field, "Add backoff");
    expect(putRequests(requests)).toHaveLength(0);
    expect(await within(decisions()).findByText("Saved")).toBeTruthy();
    expect(putRequests(requests)).toHaveLength(1);
    expect(putRequests(requests)[0]?.body).toEqual({ verdict: "pending", comment: "Add backoff" });
  });

  it("shows a decision's hunks highlighted in focus, and goes back to the tour", async () => {
    renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: /^Adds dependency dayjs/ }));
    expect(within(mainArea()).getByText("Decision")).toBeTruthy();
    expect(mainHeading()).toBe("Adds dependency dayjs 1.11.13 to format dates");
    const cards = within(mainArea()).getAllByRole("region");
    expect(cards.map((card) => card.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "src/services/receipts.ts",
      "package.json",
    ]);
    expect(cards.every((card) => card.classList.contains("highlighted"))).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /Back to tour/ }));
    expect(mainHeading()).toBe("The receipt endpoint");
  });

  it("is read-only once the review is published", async () => {
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

describe("keyboard shortcuts", () => {
  it("move through hunks and steps", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("j");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^src\/routes\/orders.ts, lines 1[0-9]/,
    );
    await userEvent.keyboard("j");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^src\/routes\/orders.ts, lines 1–/,
    );
    await userEvent.keyboard("k");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^src\/routes\/orders.ts, lines 1[0-9]/,
    );

    await userEvent.keyboard("n");
    expect(mainHeading()).toBe("Retrying the tax service and caching receipts");
    await userEvent.keyboard("p");
    expect(mainHeading()).toBe("The receipt endpoint");
    await userEvent.keyboard("p");
    expect(mainHeading()).toBe("The receipt endpoint");
  });

  it("give verdicts and comments on the selected decision, and Esc leaves it", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("a");
    expect(within(decisions()).getByText("0 of 5 reviewed")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /^Looks up the order by ID/ }));
    await userEvent.keyboard("r");
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("a");
    expect(approve(OWNERSHIP).getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("a");
    expect(approve(OWNERSHIP).getAttribute("aria-pressed")).toBe("false");

    await userEvent.keyboard("c");
    const field = screen.getByLabelText(
      "Comment on: Looks up the order by ID without checking that it belongs to the user",
    );
    expect(document.activeElement).toBe(field);
    // Typed into the field, these are text, not shortcuts.
    await userEvent.keyboard("ran");
    expect((field as HTMLTextAreaElement).value).toBe("ran");
    expect(approve(OWNERSHIP).getAttribute("aria-pressed")).toBe("false");
    expect(reject(OWNERSHIP).getAttribute("aria-pressed")).toBe("false");
    expect(within(mainArea()).getByText("Decision")).toBeTruthy();

    field.blur();
    await userEvent.keyboard("{Escape}");
    expect(mainHeading()).toBe("The receipt endpoint");
  });

  it("show the shortcut list, and Esc closes it", async () => {
    renderReview();
    await loaded();
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getAllByRole("term")).toHaveLength(9);
    // Page shortcuts are off while a dialog is open.
    await userEvent.keyboard("n");
    expect(mainHeading()).toBe("The receipt endpoint");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
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
      { summary: "", allowStale: false },
      { summary: "", allowStale: true },
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
