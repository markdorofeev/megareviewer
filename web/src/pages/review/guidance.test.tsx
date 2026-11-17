import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { PointId } from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixtureHunks,
  guidedAnalysisView,
} from "../../../dev/fixtures/index.ts";
import { mockFetch } from "../../../dev/mock-fetch.ts";
import { createMockApi } from "../../../dev/mock-routes.ts";
import { PageDisplayProvider } from "../../lib/page-display.tsx";
import { type Highlighter, HighlighterContext } from "../../review/index.ts";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse, type RecordedRequest } from "../../testing/fetch.ts";
import { ReviewPage } from "./ReviewPage.tsx";

const id = fixtureAnalysisView.analysis.id;
/** The fixture PR after a run that read guidance, under the ID the mock API serves. */
const guided: AnalysisView = {
  ...guidedAnalysisView,
  analysis: { ...guidedAnalysisView.analysis, id },
};
const { analysis } = guided;

const SCOPED = /Any signed-in user can read every customer's receipt/;
const STALE = /Keeps serving a receipt rendered before a refund/;
const RETRIES = /Retries the tax service back to back/;
const DEPENDENCY = /Adds a runtime dependency/;

/** Never finishes, so cards stay plain text and Shiki never loads. */
const pendingHighlighter: Highlighter = { highlight: () => new Promise(() => {}) };

const renderReview = (
  view: AnalysisView = guided,
  respond: (request: RecordedRequest) => Response | undefined = () => undefined,
) => {
  const mock = createMockApi();
  const forward = mockFetch(mock);
  const { fetch, requests } = fakeFetch((request) => {
    const answer = respond(request);
    if (answer !== undefined) return answer;
    if (request.method === "GET" && request.url === `/api/analyses/${id}`) {
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
        <PageDisplayProvider>{children}</PageDisplayProvider>
      </HighlighterContext.Provider>
    </api.wrapper>
  );
  render(<ReviewPage analysisId={id} />, { wrapper });
  return { requests };
};

const loaded = () =>
  screen.findByRole("heading", { level: 1, name: "Add order receipts endpoint" });
const reviewBar = () => {
  const bar = document.querySelector<HTMLElement>("[data-slot=review-bar]");
  if (bar === null) throw new Error("no review bar");
  return bar;
};
const chips = () =>
  [...reviewBar().querySelectorAll("[data-slot=point-chip]:not([data-kind=thread])")].map((chip) =>
    chip.textContent?.replace(/\s+/g, " ").trim(),
  );
const position = () => {
  const button = reviewBar().querySelector<HTMLElement>(
    "[data-slot=point-stepper] button + button",
  );
  if (button === null) throw new Error("no stepper position");
  return button;
};
const pointCard = (title: RegExp) => screen.getByRole("article", { name: title });
const guidanceOf = (title: RegExp) =>
  pointCard(title).querySelector("[data-slot=point-guidance]")?.textContent;
/** The finding marks on the numbers of the hunk that adds the retry and the cache. */
const retryMarks = () =>
  [...document.querySelectorAll(`[id^="hunk-${fixtureHunks.retryAndCache}"] [data-point-mark]`)]
    .map((cell) => cell.getAttribute("data-point-mark"))
    .filter((kind) => kind === "finding");
const stepTitle = () => reviewBar().querySelector("[data-slot=stepper-title]")?.textContent ?? null;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("a review whose run read guidance", () => {
  it("says on a point which preference or guideline file it's from", async () => {
    renderReview();
    await loaded();
    expect(guidanceOf(SCOPED)).toBe(
      "From your preference: Lookups that aren't scoped to the signed-in user",
    );
    expect(guidanceOf(DEPENDENCY)).toBe("From REVIEW.md");
    expect(guidanceOf(STALE)).toBeUndefined();
    const link = within(pointCard(SCOPED)).getByRole("link", { name: /^Lookups that aren't/ });
    expect(link.getAttribute("href")).toBe("/preferences");
  });

  it("folds a point a preference left out: no step, in no count, and no mark on its lines", async () => {
    renderReview();
    await loaded();
    const folded = pointCard(RETRIES);
    expect(folded.dataset.leftOut).toBe("true");
    expect(folded.textContent).toContain("Left out by your preference: Retries without backoff");
    await waitFor(() => expect(chips()).toEqual(["2 findings", "2 risks"]));
    expect(position().textContent).toBe("4 points");
    // Only the stale receipt's two lines are marked; the retry's six aren't.
    expect(retryMarks()).toHaveLength(2);
    // Round the steps, twice over: the folded point is never one of them.
    const titles = new Set<string | null>();
    for (let step = 0; step < 8; step += 1) {
      await userEvent.click(within(reviewBar()).getByRole("button", { name: "Next point" }));
      titles.add(stepTitle());
    }
    expect(titles.size).toBe(4);
    expect([...titles].some((title) => RETRIES.test(title ?? ""))).toBe(false);
    // The files beside the code count what the chips count.
    const counted = [
      ...document.querySelectorAll("[data-slot=point-count][data-kind=finding]"),
    ].map((count) => count.textContent);
    expect(counted).toEqual(["1 finding", "1 finding"]);

    await userEvent.click(position());
    const list = within(await screen.findByRole("dialog")).getByRole("list", { name: "Points" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(list.textContent).not.toMatch(RETRIES);
  });

  it("shows a left-out point as any other once the reviewer asks", async () => {
    const { requests } = renderReview();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: /^Show: Retries/ }));
    const card = pointCard(RETRIES);
    expect(card.dataset.leftOut).toBeUndefined();
    expect(document.activeElement).toBe(card);
    expect(guidanceOf(RETRIES)).toBe("Left out by your preference: Retries without backoff");
    await waitFor(() => expect(chips()).toEqual(["3 findings", "2 risks"]));
    expect(position().textContent).toBe("5 points");
    expect(retryMarks()).toHaveLength(8);

    // Dismissed and undone, it stays shown: the reviewer has seen it.
    await userEvent.click(within(card).getByRole("button", { name: /^Dismiss: / }));
    await userEvent.click(within(pointCard(RETRIES)).getByRole("button", { name: "Undo" }));
    expect(pointCard(RETRIES).dataset.leftOut).toBeUndefined();
    expect(within(pointCard(RETRIES)).getByRole("button", { name: /^Add to review/ })).toBeTruthy();
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(2);
  });

  it("keeps a left-out point shown that the reviewer raised before, as the server has it", async () => {
    renderReview({
      ...guided,
      pointReviews: [
        { pointId: PointId.parse("f3"), state: "raised", updatedAt: "2026-10-21T10:00:00Z" },
      ],
    });
    await loaded();
    expect(pointCard(RETRIES).dataset.leftOut).toBeUndefined();
    await waitFor(() => expect(chips()).toEqual(["3 findings", "2 risks"]));
  });

  it("says when everything Claude found was left out", async () => {
    renderReview({
      ...guided,
      analysis: {
        ...analysis,
        intent: analysis.intent === null ? null : { ...analysis.intent, mismatches: [] },
        findings: analysis.findings.filter((finding) => finding.id === "f3"),
        risk: analysis.risk.map((risk) =>
          risk.source === "model" ? { ...risk, riskClass: "logic" as const } : risk,
        ),
      },
    });
    await loaded();
    expect(
      await within(reviewBar()).findByText(
        /Claude found nothing to raise, and left out 1 by your preferences/,
      ),
    ).toBeTruthy();
    expect(chips()).toEqual([]);
    expect(pointCard(RETRIES).dataset.leftOut).toBe("true");
  });
});

describe("Don't flag things like this, on the review page", () => {
  const openRule = async (title: RegExp) => {
    await userEvent.click(
      within(pointCard(title)).getByRole("button", { name: /^More ways to dismiss/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Don't flag things like this…" }),
    );
    return within(pointCard(title)).getByRole("form");
  };
  const sent = (requests: readonly RecordedRequest[], method: string, path: string) =>
    requests.filter((request) => request.method === method && request.url === path);

  it("saves the rule as a learned preference for the repository, then dismisses the point", async () => {
    const { requests } = renderReview();
    await loaded();
    const form = await openRule(STALE);
    const field = within(form).getByRole<HTMLTextAreaElement>("textbox");
    expect(field.value).toBe("Keeps serving a receipt rendered before a refund");
    fireEvent.change(field, { target: { value: "Caches that outlive their data" } });
    await userEvent.click(within(form).getByRole("button", { name: "Save and dismiss" }));
    await waitFor(() => expect(pointCard(STALE).dataset.state).toBe("dismissed"));
    expect(sent(requests, "POST", "/api/preferences")[0]?.body).toEqual({
      kind: "dont-flag",
      text: "Caches that outlive their data",
      scope: { kind: "repo", repo: { host: "github", owner: "acme", repo: "shop" } },
      source: "learned",
    });
    expect(sent(requests, "PUT", `/api/analyses/${id}/points/f2`)[0]?.body).toEqual({
      state: "dismissed",
    });
    expect(pointCard(STALE).textContent).toContain("Dismissed, and saved to your preferences");
  });

  it("does neither on Cancel", async () => {
    const { requests } = renderReview();
    await loaded();
    const form = await openRule(DEPENDENCY);
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(pointCard(DEPENDENCY).dataset.state).toBe("open");
    expect(sent(requests, "POST", "/api/preferences")).toHaveLength(0);
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(0);
  });

  it("leaves the point as it was when the rule isn't saved, and says why", async () => {
    const { requests } = renderReview(guided, (request) =>
      request.method === "POST" && request.url === "/api/preferences"
        ? jsonResponse(400, {
            error: {
              code: "bad-request",
              message:
                "50 preferences are already enabled for acme/shop: switch one off or delete it first",
            },
          })
        : undefined,
    );
    await loaded();
    const form = await openRule(STALE);
    await userEvent.click(within(form).getByRole("button", { name: "Save and dismiss" }));
    expect(
      await within(form).findByText(
        "50 preferences are already enabled for acme/shop: switch one off or delete it first.",
      ),
    ).toBeTruthy();
    expect(pointCard(STALE).dataset.state).toBe("open");
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(0);
  });
});
