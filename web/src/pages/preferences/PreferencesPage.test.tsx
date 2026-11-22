import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferencesView, StatusResponse } from "../../../../contracts/index.ts";
import type { RepoRef } from "../../../../src/domain/review/index.ts";
import {
  emptyPreferencesView,
  fixtureImport,
  fixturePreferencesView,
  fixtureStatus,
  lockedModelOptions,
} from "../../../dev/fixtures/index.ts";
import { mockFetch } from "../../../dev/mock-fetch.ts";
import { createMockApi } from "../../../dev/mock-routes.ts";
import { ConnectionsProvider } from "../../app/connections-context.tsx";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse, type RecordedRequest } from "../../testing/fetch.ts";
import { TooltipProvider } from "../../ui/tooltip.tsx";
import { tooLong } from "./PreferenceForm.tsx";
import { PreferencesPage } from "./PreferencesPage.tsx";

type Respond = (request: RecordedRequest) => Response | Promise<Response>;

const failure = (status: number, code: string, message: string) =>
  jsonResponse(status, { error: { code, message } });

/** A response that waits until `release` is called. */
const held = () => {
  let release: (response: Response) => void = () => {};
  const respond: Respond = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  return { respond, release: (response: Response) => release(response) };
};

/** The page over the mock API, at `path`, with some routes answered otherwise, by "METHOD /path". */
const renderPage = (
  options: {
    readonly preferences?: PreferencesView;
    readonly overrides?: Readonly<Record<string, Respond>>;
    readonly now?: () => number;
    readonly path?: string;
  } = {},
) => {
  window.history.replaceState(null, "", options.path ?? "/preferences");
  const mock = mockFetch(
    createMockApi(options.preferences === undefined ? {} : { preferences: options.preferences }),
  );
  const { fetch, requests } = fakeFetch((request) => {
    const path = new URL(request.url, "http://x").pathname;
    const override = options.overrides?.[`${request.method} ${path}`];
    return override !== undefined
      ? override(request)
      : mock(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
  });
  const { wrapper: Api } = testApi({ fetch });
  render(
    <Api>
      <TooltipProvider>
        <ConnectionsProvider>
          <PreferencesPage {...(options.now === undefined ? {} : { now: options.now })} />
        </ConnectionsProvider>
      </TooltipProvider>
    </Api>,
  );
  const sent = (method: string, path: string) =>
    requests.filter(
      (request) => request.method === method && new URL(request.url, "http://x").pathname === path,
    );
  return { requests, sent };
};

const SHOP = "/preferences?scope=github/acme/shop";
const API = "/preferences?scope=bitbucket/acme/api";
const SUGGESTIONS = "/preferences?scope=suggestions";

/** The panel shown, by its title. */
const panel = (name: string | RegExp) => screen.findByRole("region", { name });
const everywhere = () => panel("Everywhere");
const scopes = () => screen.getByRole("navigation", { name: "Scopes" });
const rows = (section: HTMLElement) =>
  [...section.querySelectorAll("[data-slot=preference]")].map((row) => row.textContent);
const proposalRows = (section: HTMLElement) => [
  ...section.querySelectorAll("[data-slot=proposal]"),
];

/** The text an element's aria-describedby points to. */
const description = (element: Element): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();

beforeEach(() => {
  window.history.replaceState(null, "", "/preferences");
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("PreferencesPage", () => {
  it("shows a skeleton while it loads", async () => {
    const pending = held();
    renderPage({ overrides: { "GET /api/preferences": pending.respond } });
    const loading = screen.getByRole("status", { name: "Loading your preferences" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Preferences" })).toBeTruthy();
    await act(async () => pending.release(jsonResponse(200, emptyPreferencesView)));
    expect(screen.queryByRole("status", { name: "Loading your preferences" })).toBeNull();
  });

  it("says why a read failed, and reads again", async () => {
    let fail = true;
    const { sent } = renderPage({
      overrides: {
        "GET /api/preferences": () =>
          fail
            ? failure(500, "internal", "The store is locked")
            : jsonResponse(200, fixturePreferencesView),
      },
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't read your preferences. The store is locked.");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await everywhere()).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent("GET", "/api/preferences")).toHaveLength(2);
  });

  it("lists the scopes, with a count only where there's one, and opens on Everywhere", async () => {
    renderPage({ preferences: { ...fixturePreferencesView, preferences: [] } });
    await everywhere();
    const buttons = within(scopes()).getAllByRole("button");
    expect(buttons.map((one) => one.getAttribute("aria-label"))).toEqual([
      "Suggestions, 2 waiting",
      "Everywhere",
      "acme/shop",
      "acme/api",
    ]);
    expect(buttons.map((one) => one.textContent)).toEqual([
      "Suggestions2",
      "Everywhere",
      "shop",
      "api",
    ]);
    expect(buttons[1]?.getAttribute("aria-current")).toBe("page");
  });

  it("opens the scope chosen, says so in the URL, and moves the focus to it", async () => {
    renderPage();
    await everywhere();
    const shop = within(scopes()).getByRole("button", { name: "acme/shop, 2 preferences" });
    await userEvent.click(shop);
    const section = await panel("acme/shop");
    expect(window.location.search).toBe("?scope=github/acme/shop");
    expect(shop.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(
      within(section).getByRole("heading", { level: 2, name: "acme/shop" }),
    );
    expect(section.textContent).toContain("GitHub");
    expect(screen.queryByRole("region", { name: "Everywhere" })).toBeNull();

    // Back goes to the scope before, as a page would.
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    expect(await everywhere()).toBeTruthy();
  });

  it("opens the scope the URL names, as after a reload, and Everywhere for one it doesn't know", async () => {
    renderPage({ path: API });
    expect(await panel("acme/api")).toBeTruthy();
    expect(
      within(scopes())
        .getByRole("button", { name: /^acme\/api/ })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("falls back to Everywhere for a scope it doesn't list", async () => {
    renderPage({ path: "/preferences?scope=github/acme/gone" });
    expect(await everywhere()).toBeTruthy();
  });

  it("offers the same scopes in a select for a narrow screen", async () => {
    renderPage();
    await everywhere();
    const select = screen.getByRole("combobox", { name: "Scope" });
    expect(select.textContent).toContain("Everywhere");
    await userEvent.click(select);
    const options = await screen.findAllByRole("option");
    expect(options.map((one) => one.getAttribute("aria-label"))).toEqual([
      "Suggestions, 2 waiting",
      "Everywhere, 2 preferences",
      "acme/shop, 2 preferences",
      "acme/api, 1 preference",
    ]);
    await userEvent.click(screen.getByRole("option", { name: /^acme\/api/ }));
    const section = await panel("acme/api");
    expect(window.location.search).toBe("?scope=bitbucket/acme/api");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(section).getByRole("heading", { level: 2 })),
    );
  });

  it("names a repository by its name alone, and its owner where another has the name", async () => {
    const shop = fixturePreferencesView.repositories[0];
    if (shop === undefined) throw new Error("the fixture has repositories");
    const fork: RepoRef = { ...shop.repo, owner: "tomkx" };
    renderPage({
      preferences: {
        ...fixturePreferencesView,
        repositories: [...fixturePreferencesView.repositories, { ...shop, repo: fork }],
      },
    });
    await everywhere();
    const names = within(scopes())
      .getAllByRole("button")
      .slice(2)
      .map((one) => [one.getAttribute("aria-label"), one.textContent]);
    expect(names).toEqual([
      ["acme/shop, 2 preferences", "acme/shop2"],
      ["acme/api, 1 preference", "api1"],
      ["tomkx/shop", "tomkx/shop"],
    ]);
  });

  it("offers Suggest from my reviews on a repository's panel alone, and says so where there's none", async () => {
    renderPage({ preferences: { ...fixturePreferencesView, proposals: [] } });
    await everywhere();
    expect(screen.queryByRole("button", { name: "Suggest from my reviews" })).toBeNull();
    await userEvent.click(within(scopes()).getByRole("button", { name: /^Suggestions/ }));
    const section = await panel("Suggestions");
    expect(screen.queryByRole("button", { name: "Suggest from my reviews" })).toBeNull();
    expect(section.textContent).toContain(
      "No suggestions yet. Suggest from my reviews, on a repository's panel, proposes rules from what you did on its pull requests and your comments on them.",
    );
    await userEvent.click(within(scopes()).getByRole("button", { name: /^acme\/shop/ }));
    await panel("acme/shop");
    expect(screen.getAllByRole("button", { name: "Suggest from my reviews" })).toHaveLength(1);
  });

  it("says what a preference is, with the form, when there's none", async () => {
    const { sent } = renderPage({ preferences: emptyPreferencesView });
    const section = await everywhere();
    expect(section.textContent).toContain(
      "No preferences for every repository yet. A preference is one rule for AI reviews: Look for something to look for, or Don't flag something not to flag.",
    );
    expect(within(section).queryByRole("region", { name: /^Preferences/ })).toBeNull();
    expect(within(section).queryByRole("region", { name: /^Suggestions/ })).toBeNull();
    // The form is always open, so there's nothing to open it with or to cancel.
    expect(within(section).queryByRole("button", { name: "Cancel" })).toBeNull();
    const form = within(section).getByRole("form", { name: "Add a preference" });
    await userEvent.type(within(form).getByRole("textbox"), "Unbounded retries");
    await userEvent.click(within(form).getByRole("button", { name: "Add preference" }));
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    expect(sent("POST", "/api/preferences")[0]?.body).toEqual({
      kind: "look-for",
      text: "Unbounded retries",
      scope: { kind: "global" },
    });
    expect(section.textContent).not.toContain("A preference is one rule");
    expect(within(scopes()).getByRole("button", { name: "Everywhere, 1 preference" })).toBeTruthy();
  });

  it("lists a scope's preferences with their kind, where they came from and their switch", async () => {
    renderPage();
    const section = await everywhere();
    expect(rows(section)).toEqual([
      "Look forTenant isolation: every query filters by tenant ID",
      "Don't flagNamingFrom your reviews",
    ]);
    expect(within(section).getByRole("heading", { level: 3, name: "Preferences 2" })).toBeTruthy();
  });

  it("keeps a switched-off preference's switch, and says it's off in words", async () => {
    renderPage({ path: SHOP });
    const section = await panel("acme/shop");
    expect(rows(section)).toEqual([
      "Look forMigrations that lock a tableFrom your reviews",
      "Don't flagMissing tests for changes that only add loggingoff",
    ]);
    const switches = within(section).getAllByRole("switch", { name: /^Use in AI reviews: / });
    expect(switches.map((one) => one.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("switches a preference off, and says why one can't be switched on", async () => {
    const { sent } = renderPage({
      overrides: {
        "PUT /api/preferences/pref_0000000000000004": () =>
          failure(
            400,
            "bad-request",
            "50 preferences are already enabled for acme/shop: switch one off or delete it first",
          ),
      },
    });
    const section = await everywhere();
    const naming = within(section).getByRole("switch", { name: "Use in AI reviews: Naming" });
    await userEvent.click(naming);
    await waitFor(() => expect(naming.getAttribute("aria-checked")).toBe("false"));
    expect(sent("PUT", "/api/preferences/pref_0000000000000002")[0]?.body).toEqual({
      enabled: false,
    });
    await userEvent.click(within(scopes()).getByRole("button", { name: /^acme\/shop/ }));
    const shop = await panel("acme/shop");
    const off = within(shop).getByRole("switch", { name: /Missing tests/ });
    await userEvent.click(off);
    expect((await within(shop).findByRole("alert")).textContent).toBe(
      "50 preferences are already enabled for acme/shop: switch one off or delete it first.",
    );
    expect(off.getAttribute("aria-checked")).toBe("false");
  });

  it("adds a preference on the panel's repository, and keeps the kind for the next", async () => {
    const { sent } = renderPage({ path: SHOP });
    const section = await panel("acme/shop");
    const form = within(section).getByRole("form", { name: "Add a preference" });
    expect(within(form).getByRole("combobox", { name: "Applies to" }).textContent).toContain(
      "acme/shop",
    );
    await userEvent.click(within(form).getByRole("radio", { name: "Don't flag" }));
    const field = within(form).getByRole<HTMLTextAreaElement>("textbox");
    await userEvent.type(field, "Money as floats{Enter}");
    await waitFor(() => expect(rows(section)).toHaveLength(3));
    expect(sent("POST", "/api/preferences")[0]?.body).toEqual({
      kind: "dont-flag",
      text: "Money as floats",
      scope: { kind: "repo", repo: { host: "github", owner: "acme", repo: "shop" } },
    });
    expect(field.value).toBe("");
    expect(
      within(form).getByRole("radio", { name: "Don't flag" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(scopes()).getByRole("button", { name: "acme/shop, 3 preferences" })).toBeTruthy();
  });

  it("says under the field why a preference wasn't added, keeping what was written", async () => {
    renderPage({
      overrides: {
        "POST /api/preferences": () =>
          failure(400, "bad-request", "50 preferences are already enabled for every repository"),
      },
    });
    const section = await everywhere();
    const form = within(section).getByRole("form", { name: "Add a preference" });
    const field = within(form).getByRole<HTMLTextAreaElement>("textbox");
    await userEvent.type(field, "Naming{Enter}");
    expect((await within(form).findByText(/50 preferences are already enabled/)).textContent).toBe(
      "50 preferences are already enabled for every repository.",
    );
    expect(field.value).toBe("Naming");
  });

  it("edits a preference in place, and gives the focus back to Edit", async () => {
    const { sent } = renderPage();
    const section = await everywhere();
    await userEvent.click(within(section).getByRole("button", { name: "Edit: Naming" }));
    const form = within(section).getByRole("form", { name: "Edit: Naming" });
    const field = within(form).getByRole("textbox");
    expect(document.activeElement).toBe(field);
    await userEvent.clear(field);
    await userEvent.type(field, "Names of locals");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(rows(section)[1]).toBe("Don't flagNames of localsFrom your reviews"),
    );
    expect(sent("PUT", "/api/preferences/pref_0000000000000002")[0]?.body).toEqual({
      kind: "dont-flag",
      text: "Names of locals",
      scope: { kind: "global" },
    });
    expect(document.activeElement).toBe(
      within(section).getByRole("button", { name: "Edit: Names of locals" }),
    );
  });

  it("asks before deleting a preference", async () => {
    const { sent } = renderPage();
    const section = await everywhere();
    await userEvent.click(within(section).getByRole("button", { name: "Delete: Naming" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete preference" });
    expect(dialog.textContent).toContain("Naming");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(rows(section)).toHaveLength(2);
    expect(sent("DELETE", "/api/preferences/pref_0000000000000002")).toHaveLength(0);

    await userEvent.click(within(section).getByRole("button", { name: "Delete: Naming" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    expect(sent("DELETE", "/api/preferences/pref_0000000000000002")).toHaveLength(1);
  });
});

describe("PreferencesPage's suggestions", () => {
  /** Two proposals waiting for acme/shop, one for everywhere. */
  const twoForShop = {
    ...fixturePreferencesView,
    proposals: [...fixturePreferencesView.proposals, fixtureImport],
  };

  it("lists every proposal on its own panel, by scope, with what it's based on", async () => {
    renderPage({ path: SUGGESTIONS });
    const section = await panel("Suggestions");
    const groups = within(section).getAllByRole("heading", { level: 3 });
    expect(groups.map((one) => one.textContent)).toEqual(["Everywhere 1", "acme/shop 1"]);
    const [jsdoc] = proposalRows(
      within(section).getByRole("list", { name: "Suggestions for acme/shop" }),
    );
    expect(jsdoc?.textContent).toContain("Don't flagMissing JSDoc on internal helpers");
    expect(within(jsdoc as HTMLElement).getByRole("list", { name: "Based on" }).textContent).toBe(
      "Dismissed: Missing JSDoc on `parseConfig`, acme/shop #121Dismissed: Missing JSDoc on `renderReceipt`, acme/shop #128",
    );
    expect(within(section).queryByRole("form")).toBeNull();
  });

  it("shows a scope's own proposals first on its panel", async () => {
    renderPage({ path: SHOP });
    const section = await panel("acme/shop");
    const suggestions = within(section).getByRole("region", {
      name: "Suggestions from your reviews 1",
    });
    expect(proposalRows(suggestions)).toHaveLength(1);
    expect(
      suggestions.compareDocumentPosition(
        within(section).getByRole("region", { name: /^Preferences/ }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("adds a proposal as it reads, which makes it a preference", async () => {
    const { sent } = renderPage({ path: SHOP, preferences: twoForShop });
    const section = await panel("acme/shop");
    const list = within(section).getByRole("list", { name: "Suggestions for acme/shop" });
    await userEvent.click(
      within(list).getByRole("button", {
        name: "Add suggestion: Missing JSDoc on internal helpers",
      }),
    );
    await waitFor(() => expect(rows(section)).toHaveLength(3));
    expect(rows(section)[2]).toBe("Don't flagMissing JSDoc on internal helpersFrom your reviews");
    expect(sent("PUT", "/api/preferences/proposals/prop_0000000000000001")[0]?.body).toEqual({
      decision: "accept",
    });
    expect(proposalRows(list)).toHaveLength(1);
    // The button went with its proposal, so the list takes the focus.
    expect(document.activeElement).toBe(list);
    expect(within(scopes()).getByRole("button", { name: "Suggestions, 2 waiting" })).toBeTruthy();
  });

  it("dismisses a proposal for good, and the section goes with the last one", async () => {
    const { sent } = renderPage({ path: SHOP });
    const section = await panel("acme/shop");
    await userEvent.click(within(section).getByRole("button", { name: /^Dismiss suggestion: / }));
    await waitFor(() =>
      expect(within(section).queryByRole("region", { name: /^Suggestions from/ })).toBeNull(),
    );
    expect(sent("PUT", "/api/preferences/proposals/prop_0000000000000001")[0]?.body).toEqual({
      decision: "reject",
    });
    expect(document.activeElement).toBe(within(section).getByRole("heading", { level: 2 }));
  });

  it("opens a proposal too long to add as it reads in the form, cut to fit there", async () => {
    const [proposal] = fixturePreferencesView.proposals;
    if (proposal === undefined) throw new Error("the fixture has proposals");
    const { sent } = renderPage({
      path: SHOP,
      preferences: {
        ...fixturePreferencesView,
        proposals: [{ ...proposal, text: "x".repeat(310) }],
      },
    });
    const section = await panel("acme/shop");
    const add = () => within(section).getByRole("button", { name: /^Add suggestion: / });
    // Cancel leaves it waiting, with the focus back where it was.
    await userEvent.click(add());
    await userEvent.click(within(section).getByRole("button", { name: "Cancel" }));
    expect(add()).toBeTruthy();

    await userEvent.click(add());
    const form = within(section).getByRole("form", { name: /^Cut the suggestion to fit/ });
    expect(within(form).getByRole("status").textContent).toBe(tooLong(10));
    expect(sent("PUT", `/api/preferences/proposals/${proposal.id}`)).toHaveLength(0);
    const field = within(form).getByRole("textbox");
    expect(document.activeElement).toBe(field);
    await userEvent.clear(field);
    await userEvent.type(field, "JSDoc on helpers");
    await userEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(rows(section)).toHaveLength(3));
    expect(sent("PUT", `/api/preferences/proposals/${proposal.id}`)[0]?.body).toEqual({
      decision: "accept",
      kind: "dont-flag",
      text: "JSDoc on helpers",
      scope: { kind: "repo", repo: { host: "github", owner: "acme", repo: "shop" } },
    });
  });

  it("says why a decision failed, and keeps the proposal", async () => {
    renderPage({
      path: SHOP,
      overrides: {
        "PUT /api/preferences/proposals/prop_0000000000000001": () =>
          failure(400, "bad-request", "The proposal is already accepted"),
      },
    });
    const section = await panel("acme/shop");
    await userEvent.click(within(section).getByRole("button", { name: /^Add suggestion: / }));
    expect((await within(section).findByRole("alert")).textContent).toBe(
      "The proposal is already accepted.",
    );
    expect(proposalRows(section)).toHaveLength(1);
  });
});

describe("PreferencesPage's Suggest from my reviews", () => {
  const suggest = () => screen.getByRole("button", { name: "Suggest from my reviews" });
  const withoutProposals = { ...fixturePreferencesView, proposals: [] };
  const ready = async (path = SHOP) => {
    const section = await panel(path === SHOP ? "acme/shop" : "acme/api");
    await waitFor(() => expect(suggest().getAttribute("aria-disabled")).not.toBe("true"));
    return section;
  };

  it("says what it reads, which model runs it and who pays, and nothing under it before a run", async () => {
    renderPage({ preferences: withoutProposals, path: SHOP });
    const section = await ready();
    expect(description(suggest())).toBe(
      "Reads what you did on its pull requests here and your comments on GitHub, then runs Sonnet 5.5 through Claude Code, on your Pro plan",
    );
    expect(section.querySelector("[data-slot=model-action-status]")).toBeNull();
  });

  it("says it's running and how long, can't run twice, then what it read and where its suggestions went", async () => {
    const pending = held();
    let nowMs = 1_000_000;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sent } = renderPage({
      preferences: withoutProposals,
      path: SHOP,
      overrides: { "POST /api/preferences/suggestions": pending.respond },
      now: () => nowMs,
    });
    const section = await ready();
    await userEvent.click(suggest());
    expect(suggest().getAttribute("aria-busy")).toBe("true");
    expect(suggest().getAttribute("aria-disabled")).toBe("true");
    const status = () => section.querySelector("[data-slot=model-action-status]") ?? section;
    expect(status().textContent).toBe("Reading your reviews of acme/shop… 0:00");
    nowMs += 12_000;
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(status().textContent).toBe("Reading your reviews of acme/shop… 0:12");
    await userEvent.click(suggest());
    expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(1);
    expect(sent("POST", "/api/preferences/suggestions")[0]?.body).toEqual({
      repo: { host: "github", owner: "acme", repo: "shop" },
      optionId: fixtureStatus.model.defaultId,
    });

    await act(async () =>
      pending.release(
        jsonResponse(200, {
          proposals: fixturePreferencesView.proposals,
          signals: 14,
          comments: 92,
          pullRequests: 30,
        }),
      ),
    );
    expect(
      await within(section).findByText(
        "Read 92 comments from 30 pull requests and 14 actions recorded here: 2 suggestions, 1 for Everywhere and 1 for acme/shop.",
      ),
    ).toBeTruthy();
    expect(proposalRows(section)).toHaveLength(1);
    expect(within(scopes()).getByRole("button", { name: "Suggestions, 2 waiting" })).toBeTruthy();
    expect(suggest().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("keeps what a run came to on its repository's panel, and only there", async () => {
    renderPage({ preferences: withoutProposals, path: SHOP });
    await ready();
    await userEvent.click(suggest());
    const said = /^Read 92 comments from 30 pull requests: 3 suggestions, /;
    expect(await screen.findByText(said)).toBeTruthy();
    await userEvent.click(within(scopes()).getByRole("button", { name: /^acme\/api/ }));
    await panel("acme/api");
    expect(screen.queryByText(said)).toBeNull();
    await userEvent.click(within(scopes()).getByRole("button", { name: /^acme\/shop/ }));
    await panel("acme/shop");
    expect(screen.getByText(said)).toBeTruthy();
  });

  it("says when there was nothing to suggest from", async () => {
    renderPage({ preferences: withoutProposals, path: API });
    await ready(API);
    await userEvent.click(suggest());
    expect(
      await screen.findByText(
        "Found nothing to suggest from: no comment of yours on its pull requests, and nothing you did here.",
      ),
    ).toBeTruthy();
  });

  it("runs on the model chosen beside it, which Request AI review shares", async () => {
    const { sent } = renderPage({ preferences: withoutProposals, path: SHOP });
    const section = await ready();
    await userEvent.click(within(section).getByRole("button", { name: "Model: Sonnet 5.5" }));
    await userEvent.click(
      within(await screen.findByRole("menu")).getAllByRole("menuitemradio", {
        name: "Opus 5.5",
      })[0] as HTMLElement,
    );
    await waitFor(() =>
      expect(description(suggest())).toMatch(/runs Opus 5\.5 through Claude Code/),
    );
    await userEvent.click(suggest());
    await waitFor(() => expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(1));
    expect(sent("POST", "/api/preferences/suggestions")[0]?.body).toMatchObject({
      optionId: "claude-code/claude-opus-5-5",
    });
    // The same per-browser choice as Request AI review's.
    expect(window.localStorage.getItem("megareviewer:model-option")).toBe(
      JSON.stringify("claude-code/claude-opus-5-5"),
    );
  });

  it("says why no model can run it, in its description and nowhere else", async () => {
    const locked: StatusResponse = { ...fixtureStatus, model: lockedModelOptions };
    const { sent } = renderPage({
      preferences: withoutProposals,
      path: SHOP,
      overrides: { "GET /api/status": () => jsonResponse(200, locked) },
    });
    const section = await panel("acme/shop");
    await waitFor(() => expect(description(suggest())).toMatch(/Claude Code isn't signed in/));
    expect(suggest().getAttribute("aria-disabled")).toBe("true");
    expect(suggest().hasAttribute("disabled")).toBe(false);
    expect(section.querySelector("[data-slot=model-action-status]")).toBeNull();
    await userEvent.click(suggest());
    expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(0);
  });

  it("shows the reason under the title when it fails, with Try again", async () => {
    let fail = true;
    const { sent } = renderPage({
      preferences: withoutProposals,
      path: SHOP,
      overrides: {
        "POST /api/preferences/suggestions": () =>
          fail
            ? failure(502, "host-error", "GitHub is down")
            : jsonResponse(200, { proposals: [], signals: 2, comments: 0, pullRequests: 0 }),
      },
    });
    await ready();
    await userEvent.click(suggest());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("GitHub is down");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Read 2 actions recorded here: nothing new to suggest."),
    ).toBeTruthy();
    expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(2);
  });
});

describe("PreferencesPage's repositories", () => {
  const files = (section: HTMLElement) =>
    [...section.querySelectorAll("[data-slot=guideline-file]")].map((file) => file.textContent);

  it("lists a repository's guideline files with their size and state, one too large without a switch", async () => {
    renderPage({ path: SHOP });
    const section = await panel("acme/shop");
    const guidelines = within(section).getByRole("region", { name: "Guideline files" });
    expect(guidelines.textContent).toContain("read at each pull request's base commit");
    expect(files(guidelines)).toEqual([
      "REVIEW.md1.2 KBFollowed by AI reviews",
      "CLAUDE.md48 KBToo large to send: a guideline file can be 32 KB",
      "CONTRIBUTING.md5.9 KBIgnored",
    ]);
    const switches = within(guidelines).getAllByRole("switch");
    expect(switches.map((one) => one.getAttribute("aria-label"))).toEqual([
      "Use REVIEW.md in AI reviews",
      "Use CONTRIBUTING.md in AI reviews",
    ]);
  });

  it("switches a guideline file, and says its new state", async () => {
    const { sent } = renderPage({ path: SHOP });
    const section = await panel("acme/shop");
    const review = within(section).getByRole("switch", { name: "Use REVIEW.md in AI reviews" });
    await userEvent.click(review);
    await waitFor(() => expect(review.getAttribute("aria-checked")).toBe("false"));
    expect(files(section)[0]).toBe("REVIEW.md1.2 KBIgnored");
    expect(sent("PUT", "/api/preferences/guidelines")[0]?.body).toEqual({
      repo: { host: "github", owner: "acme", repo: "shop" },
      path: "REVIEW.md",
      enabled: false,
    });
  });

  it("says why a guideline switch failed, and leaves it as it was", async () => {
    renderPage({
      path: SHOP,
      overrides: {
        "PUT /api/preferences/guidelines": () => failure(500, "internal", "The store is locked"),
      },
    });
    const section = await panel("acme/shop");
    const review = within(section).getByRole("switch", { name: "Use REVIEW.md in AI reviews" });
    await userEvent.click(review);
    expect((await within(section).findByRole("alert")).textContent).toBe("The store is locked.");
    expect(review.getAttribute("aria-checked")).toBe("true");
  });

  it("says that a repository has no guideline files, or why they weren't read", async () => {
    const [first] = fixturePreferencesView.repositories;
    if (first === undefined) throw new Error("the fixture has repositories");
    renderPage({
      path: SHOP,
      preferences: {
        ...fixturePreferencesView,
        repositories: [
          { ...first, guidelineFiles: [] },
          ...fixturePreferencesView.repositories.slice(1),
        ],
      },
    });
    const section = await panel("acme/shop");
    expect(section.textContent).toContain(
      "None at the repository's root. megareviewer looks for REVIEW.md, AGENTS.md, CLAUDE.md, CONTRIBUTING.md, or .github/copilot-instructions.md.",
    );
    await userEvent.click(within(scopes()).getByRole("button", { name: /^acme\/api/ }));
    const api = await panel("acme/api");
    expect(api.textContent).toContain("Bitbucket");
    expect(api.textContent).toContain("No pull request of this repository has been analyzed yet.");
  });

  it("says what a preference is on a repository with nothing yet", async () => {
    const ledger: RepoRef = { host: "github", owner: "acme", repo: "ledger" };
    renderPage({
      path: "/preferences?scope=github/acme/ledger",
      preferences: {
        ...fixturePreferencesView,
        repositories: [
          ...fixturePreferencesView.repositories,
          { repo: ledger, guidelineFiles: [], guidelineNote: null },
        ],
      },
    });
    const section = await panel("acme/ledger");
    expect(section.textContent).toContain(
      "No preferences for this repository yet. A preference is one rule for AI reviews here: Look for something to look for, or Don't flag something not to flag. Rules for Everywhere still apply.",
    );
    expect(
      within(section).getAllByRole("button", { name: "Suggest from my reviews" }),
    ).toHaveLength(1);
    expect(within(section).getByRole("form", { name: "Add a preference" })).toBeTruthy();
    // Its first preference ends the first run.
    await userEvent.type(within(section).getByRole("textbox"), "Ledger entries balance{Enter}");
    await waitFor(() => expect(section.textContent).not.toContain("No preferences for"));
    expect(
      within(section).getAllByRole("button", { name: "Suggest from my reviews" }),
    ).toHaveLength(1);
  });
});
