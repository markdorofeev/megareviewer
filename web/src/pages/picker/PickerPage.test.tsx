import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestListResponse, StatusResponse } from "../../../../contracts/index.ts";
import type { ReviewActivity } from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixturePullRequests,
  fixtureStatus,
} from "../../../dev/fixtures/index.ts";
import { mockFetch } from "../../../dev/mock-fetch.ts";
import { createMockApi } from "../../../dev/mock-routes.ts";
import { ConnectionsButton } from "../../app/ConnectionsButton.tsx";
import { ConnectionsProvider } from "../../app/connections-context.tsx";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse, type RecordedRequest } from "../../testing/fetch.ts";
import { TooltipProvider } from "../../ui/tooltip.tsx";
import { PickerPage } from "./PickerPage.tsx";
import { avatarColors } from "./PullRequestList.tsx";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const reviewPath = `/review/${fixtureAnalysisView.analysis.id}`;

type Respond = (request: RecordedRequest) => Response | Promise<Response>;

/** The mock API, with some of its routes answered otherwise, by "METHOD /path". */
const api = (overrides: Readonly<Record<string, Respond>> = {}) => {
  const mock = mockFetch(createMockApi());
  return fakeFetch((request) => {
    const override = overrides[`${request.method} ${new URL(request.url, "http://x").pathname}`];
    return override !== undefined
      ? override(request)
      : mock(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
  });
};

const json =
  (body: unknown, status = 200): Respond =>
  () =>
    jsonResponse(status, body);
const list = (body: PullRequestListResponse) => ({ "GET /api/pull-requests": json(body) });
const status = (body: StatusResponse) => ({ "GET /api/status": json(body) });
const activity = (body: ReviewActivity) => ({ "GET /api/review-activity": json(body) });
const NO_ACTIVITY = activity({ reviews: [], comments: [] });

/** A response that waits until `release` is called. */
const held = () => {
  let release: (response: Response) => void = () => {};
  const respond: Respond = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  return { respond, release: (response: Response) => release(response) };
};

const renderPicker = (
  overrides: Readonly<Record<string, Respond>> = {},
  now: () => number = () => NOW,
) => {
  const { fetch, requests } = api({ ...NO_ACTIVITY, ...overrides });
  const { wrapper: Api } = testApi({ fetch });
  render(
    <Api>
      <TooltipProvider>
        <ConnectionsProvider now={now}>
          <ConnectionsButton now={now} />
          <PickerPage now={now} />
        </ConnectionsProvider>
      </TooltipProvider>
    </Api>,
  );
  return { requests };
};

const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Pull request link" });
const analyze = () => screen.getByRole("button", { name: /^Analyz/ });
const toReview = () => screen.getByRole("region", { name: "To review" });
const yours = () => screen.getByRole("region", { name: "Your pull requests" });
const off = { configured: false, user: null, error: null };
const failing = { configured: true, user: null, error: "Bad credentials" };
const signedIn = { configured: true, user: { id: "sam", name: "Sam" }, error: null };
const bothHosts = {
  ...fixtureStatus,
  hosts: { github: fixtureStatus.hosts.github, bitbucket: signedIn },
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("PickerPage's lists", () => {
  it("lists PRs to review and the reviewer's own, with each row's name", async () => {
    renderPicker();
    const row = await within(toReview()).findByRole("button", {
      name: "Add order receipts endpoint. acme/shop #128 by Sam Rivera, updated 19 min ago, GitHub",
    });
    expect(row.querySelector("time")?.getAttribute("title")).toMatch(/2026/);
    expect(within(toReview()).getAllByRole("button")).toHaveLength(3);
    expect(within(toReview()).getByText("3 pull requests")).toBeTruthy();
    expect(within(yours()).getAllByRole("button")[0]?.getAttribute("aria-label")).toMatch(
      / by you, /,
    );
  });

  it("shows skeletons and where it's loading from before the first read", async () => {
    const pending = held();
    renderPicker({ ...status(bothHosts), "GET /api/pull-requests": pending.respond });
    expect(await within(toReview()).findByText("Loading from GitHub and Bitbucket")).toBeTruthy();
    expect(within(yours()).getByText("Loading", { selector: "p" })).toBeTruthy();
    expect(within(toReview()).getByText("…")).toBeTruthy();
  });

  it("shows each list's empty state", async () => {
    renderPicker(list({ items: [], errors: [] }));
    expect(await within(toReview()).findByText("Nothing is waiting for you")).toBeTruthy();
    expect(within(yours()).getByText("No open pull requests")).toBeTruthy();
  });

  it("sends the reviewer to Connections without a git host", async () => {
    renderPicker({
      ...status({ ...fixtureStatus, hosts: { github: off, bitbucket: off } }),
      ...list({ items: [], errors: [] }),
    });
    const message = "Connect GitHub or Bitbucket to list pull requests.";
    expect(await within(toReview()).findByText(message)).toBeTruthy();
    expect(within(yours()).getByText(message)).toBeTruthy();
    expect(within(yours()).queryByRole("button")).toBeNull();
    await userEvent.click(within(toReview()).getByRole("button", { name: "Open Connections" }));
    expect(await screen.findByText("Connections", { selector: "h2" })).toBeTruthy();
  });

  it("names a host whose list failed and shows the other's", async () => {
    renderPicker({
      ...status(bothHosts),
      ...list({
        items: fixturePullRequests.items.filter((item) => item.ref.repo.host === "github"),
        errors: [{ host: "bitbucket", message: "Bitbucket returned 503" }],
      }),
    });
    const alert = await within(toReview()).findByRole("alert");
    expect(alert.textContent).toBe(
      "Couldn't load Bitbucket pull requests.Bitbucket returned 503GitHub pull requests are shown.Retry",
    );
    expect(within(toReview()).getByText("GitHub only")).toBeTruthy();
    expect(within(yours()).getByText("GitHub only")).toBeTruthy();
    expect(within(toReview()).getAllByRole("button", { name: /GitHub$/ }).length).toBeGreaterThan(
      0,
    );
  });

  it("hides a host failing in Connections, with Fix… opening it on Check again", async () => {
    renderPicker({
      ...status({
        ...bothHosts,
        hosts: { github: fixtureStatus.hosts.github, bitbucket: failing },
      }),
      ...list({
        items: fixturePullRequests.items.filter((item) => item.ref.repo.host === "github"),
        errors: [{ host: "bitbucket", message: "401" }],
      }),
    });
    const note = await within(toReview()).findByText(
      "Bitbucket pull requests are hidden until Bitbucket works again.",
    );
    expect(note.closest("[role=status]")).toBeTruthy();
    expect(within(toReview()).queryByRole("alert")).toBeNull();
    await userEvent.click(within(toReview()).getByRole("button", { name: "Fix…" }));
    expect(document.activeElement).toBe(await screen.findByRole("button", { name: "Check again" }));
  });

  it("shows only notes when every host failed", async () => {
    renderPicker({
      ...status(bothHosts),
      ...list({
        items: [],
        errors: [
          { host: "github", message: "GitHub returned 502" },
          { host: "bitbucket", message: "Bitbucket returned 503" },
        ],
      }),
    });
    expect(await within(toReview()).findAllByRole("alert")).toHaveLength(2);
    expect(within(toReview()).queryByText("Nothing is waiting for you")).toBeNull();
    expect(within(toReview()).queryByText(/pull requests?$/)).toBeNull();
    expect(within(yours()).getByText("Couldn't load pull requests.")).toBeTruthy();
  });

  it("says why the lists can't load, and keeps the rows when a read again fails", async () => {
    let fail = true;
    const { requests } = renderPicker({
      "GET /api/pull-requests": () =>
        fail
          ? Promise.reject(new TypeError("Failed to fetch"))
          : jsonResponse(200, fixturePullRequests),
    });
    const alerts = await within(toReview()).findAllByRole("alert");
    expect(alerts[0]?.textContent).toMatch(/^Couldn't list pull requests\./);
    expect(within(yours()).getByRole("alert").textContent).toMatch(/^Couldn't list/);

    fail = false;
    await userEvent.click(within(toReview()).getByRole("button", { name: "Retry" }));
    await within(toReview()).findByRole("button", { name: /Add order receipts/ });
    fail = true;
    await userEvent.click(screen.getByRole("button", { name: /^Connections:/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect((await within(toReview()).findByRole("alert")).textContent).toMatch(/^Couldn't list/);
    expect(within(toReview()).getByRole("button", { name: /Add order receipts/ })).toBeTruthy();
    expect(requests.filter((request) => request.url === "/api/pull-requests")).toHaveLength(3);
  });

  it("moves through one list with the arrows, Home and End, never into the other", async () => {
    renderPicker();
    const rows = await within(toReview()).findAllByRole("button");
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    rows[0]?.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    await userEvent.keyboard("{End}{ArrowDown}");
    expect(document.activeElement).toBe(rows[2]);
    await userEvent.keyboard("{Home}{ArrowUp}");
    expect(document.activeElement).toBe(rows[0]);
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  it("reads the lists again when the tab comes back after 2 minutes, not before", async () => {
    let now = NOW;
    const { requests } = renderPicker({}, () => now);
    await within(toReview()).findByRole("button", { name: /Add order receipts/ });
    const reads = () => requests.filter((request) => request.url === "/api/pull-requests").length;
    const visible = () => act(() => document.dispatchEvent(new Event("visibilitychange")));
    now += 60_000;
    visible();
    expect(reads()).toBe(1);
    now += 90_000;
    visible();
    expect(reads()).toBe(2);
  });
});

describe("PickerPage's field", () => {
  it("validates on submit, and clears on the next keystroke", async () => {
    renderPicker();
    await userEvent.click(analyze());
    expect(screen.getByText("Paste a pull request link first.")).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(analyze().hasAttribute("disabled")).toBe(false);

    await userEvent.type(field(), "https://gitlab.com/a/b/-/merge_requests/1{Enter}");
    expect(screen.getByText(/^That isn't a pull request link\./)).toBeTruthy();
    await userEvent.type(field(), "x");
    expect(screen.queryByText(/^That isn't/)).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBe("false");
    expect(document.activeElement).toBe(field());
  });

  it("opens a link without its scheme", async () => {
    renderPicker();
    await userEvent.type(field(), "github.com/acme/shop/pull/128{Enter}");
    await vi.waitFor(() => expect(window.location.pathname).toBe(reviewPath));
  });

  it("shows the start, and cancels it back to an editable field", async () => {
    const start = held();
    renderPicker({ "POST /api/analyses": start.respond });
    await userEvent.type(field(), "https://github.com/acme/api/pull/902{Enter}");
    expect(await screen.findByText("Fetching acme/api #902 from GitHub…")).toBeTruthy();
    expect(field().readOnly).toBe(true);
    expect(analyze().textContent).toBe("Analyzing…");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(field().readOnly).toBe(false);
    expect(document.activeElement).toBe(field());
    await act(async () =>
      start.release(jsonResponse(200, { analysisId: fixtureAnalysisView.analysis.id })),
    );
    expect(window.location.pathname).toBe("/");
  });

  it("says why it couldn't open, with Try again and Open Connections", async () => {
    const { requests } = renderPicker();
    await userEvent.type(
      field(),
      "https://bitbucket.org/acme-team/billing/pull-requests/57{Enter}",
    );
    const message = await screen.findByText(/^Couldn't open acme-team\/billing #57: /);
    expect(message.textContent).toBe(
      "Couldn't open acme-team/billing #57: Bitbucket isn't configured. Open Connections",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/^Couldn't open acme-team/);
    expect(requests.filter((request) => request.url === "/api/analyses")).toHaveLength(2);
    await userEvent.type(field(), "8");
    expect(screen.queryByText(/^Couldn't open/)).toBeNull();
  });

  it("focuses and selects the field on /, but not while typing elsewhere", async () => {
    renderPicker();
    await userEvent.type(field(), "abc");
    field().blur();
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(3);
    await userEvent.keyboard("/");
    expect(field().value).toBe("/");
  });
});

describe("PickerPage's rows", () => {
  it("starts from a row, and Esc puts it back", async () => {
    const start = held();
    renderPicker({ "POST /api/analyses": start.respond });
    const row = await within(toReview()).findByRole("button", { name: /Add order receipts/ });
    await userEvent.click(row);
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(within(row).getByText("Opening review…")).toBeTruthy();
    expect(screen.getByText("Opening acme/shop #128")).toBeTruthy();
    await userEvent.click(row);
    await userEvent.keyboard("{Escape}");
    expect(row.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(document.activeElement).toBe(row);
  });

  it("lets another row replace the one starting", async () => {
    const start = held();
    renderPicker({ "POST /api/analyses": start.respond });
    const [first, second] = await within(toReview()).findAllByRole("button");
    if (first === undefined || second === undefined) throw new Error("two rows");
    await userEvent.click(first);
    await userEvent.click(second);
    expect(first.getAttribute("aria-busy")).toBe("false");
    expect(second.getAttribute("aria-busy")).toBe("true");
  });

  it("opens the review when it starts", async () => {
    renderPicker();
    await userEvent.click(await within(toReview()).findByRole("button", { name: /Add order/ }));
    await vi.waitFor(() => expect(window.location.pathname).toBe(reviewPath));
  });

  it("shows a row's failure above its list, with Try again", async () => {
    renderPicker();
    await userEvent.click(await within(toReview()).findByRole("button", { name: /Round invoice/ }));
    const alert = await within(toReview()).findByRole("alert");
    expect(alert.textContent).toMatch(
      /^Couldn't open acme-team\/billing #57: Bitbucket isn't configured\./,
    );
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(within(yours()).queryByRole("alert")).toBeNull();
  });
});

describe("PickerPage's review activity", () => {
  const busy: ReviewActivity = {
    reviews: [
      ...[1, 2, 3, 4, 5, 6, 7].map((number) => ({
        at: "2026-10-20T12:00:00Z",
        pullRequest: { repo: { host: "github" as const, owner: "acme", repo: "shop" }, number },
      })),
    ],
    comments: Array.from({ length: 26 }, () => "2026-10-20T12:00:00Z"),
  };
  const region = () => screen.getByRole("region", { name: "Review activity" });

  /** A ResizeObserver that reports the given width. */
  const cardWidth = (width: number) =>
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly report: (entries: readonly { contentRect: { width: number } }[]) => void;
        constructor(report: (entries: readonly { contentRect: { width: number } }[]) => void) {
          this.report = report;
        }
        observe() {
          this.report([{ contentRect: { width } }]);
        }
        disconnect() {}
      },
    );

  it("names each day, and totals the weeks shown", async () => {
    renderPicker(activity(busy));
    const day = await screen.findByRole("gridcell", {
      name: "Oct 20: 7 PRs reviewed, 26 comments",
    });
    expect(day.querySelector(".bg-primary > span")).toBeTruthy();
    expect(
      screen.getByRole("gridcell", { name: /^Oct 21: No PRs reviewed, 0 comments \(today\)$/ }),
    );
    expect(within(region()).getByText("Busiest day: Oct 20, 7 PRs and 26 comments.")).toBeTruthy();
    expect(within(region()).getByText("Last 26 weeks")).toBeTruthy();
  });

  it("shows as many weeks as the card fits", async () => {
    cardWidth(300);
    renderPicker(activity(busy));
    expect(await within(region()).findByText("Last 11 weeks")).toBeTruthy();
    expect(
      screen.getByRole("grid", { name: /^Review activity for the last 11 weeks/ }),
    ).toBeTruthy();
  });

  it("moves between days with the arrows, Home and End, from today", async () => {
    renderPicker(activity(busy));
    const today = await screen.findByRole("gridcell", { name: /\(today\)$/ });
    expect(today.tabIndex).toBe(0);
    today.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Oct 20:/);
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Oct 13:/);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Oct 15:/);
    await userEvent.keyboard("{Home}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Apr 26:/);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(today);
  });

  it("shows the day in a tooltip", async () => {
    renderPicker(activity(busy));
    const day = await screen.findByRole("gridcell", { name: /^Oct 20:/ });
    await userEvent.hover(day);
    expect(await screen.findByText("Tue, Oct 20")).toBeTruthy();
    expect(screen.getByText("7 PRs reviewed · 26 comments")).toBeTruthy();
  });

  it("invites a first review when nothing was posted", async () => {
    renderPicker();
    expect(await within(region()).findByText("No reviews yet.")).toBeTruthy();
    expect(within(region()).getByText("PRs reviewed").previousSibling?.textContent).toBe("0");
    expect(within(region()).queryByText(/^Busiest day/)).toBeNull();
  });

  it("counts comments without a busiest day, and no invitation for older reviews", async () => {
    renderPicker(
      activity({
        reviews: [
          {
            at: "2026-01-05T12:00:00Z",
            pullRequest: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 1 },
          },
        ],
        comments: ["2026-10-19T12:00:00Z"],
      }),
    );
    expect(
      (await within(region()).findByText("comments posted")).previousSibling?.textContent,
    ).toBe("1");
    expect(within(region()).queryByText("No reviews yet.")).toBeNull();
    expect(within(region()).queryByText(/^Busiest day/)).toBeNull();
  });

  it("says when it couldn't read, with Try again", async () => {
    renderPicker({ "GET /api/review-activity": () => Promise.reject(new TypeError("down")) });
    expect(await within(region()).findByText("Couldn't read your review activity.")).toBeTruthy();
    expect(within(region()).getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("avatarColors", () => {
  it("gives an author the same colors every time, and authors different ones", () => {
    expect(avatarColors("sam-rivera")).toBe(avatarColors("sam-rivera"));
    const ids = ["sam-rivera", "lee-park", "jo-tanaka", "priya", "lsato", "jkim", "rnovak", "mina"];
    expect(new Set(ids.map(avatarColors)).size).toBeGreaterThan(3);
  });
});
