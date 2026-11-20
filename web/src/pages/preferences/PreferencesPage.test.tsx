import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreferencesView, StatusResponse } from "../../../../contracts/index.ts";
import {
  emptyPreferencesView,
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
import { NOTHING_RECORDED, PreferencesPage } from "./PreferencesPage.tsx";

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

/** The page over the mock API, with some routes answered otherwise, by "METHOD /path". */
const renderPage = (
  options: {
    readonly preferences?: PreferencesView;
    readonly overrides?: Readonly<Record<string, Respond>>;
    readonly now?: () => number;
  } = {},
) => {
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

const everywhere = () => screen.findByRole("region", { name: "Everywhere" });
const shop = () => screen.getByRole("region", { name: /^acme\/shop/ });
const suggested = () => screen.getByRole("region", { name: "Suggested" });
const rows = (section: HTMLElement) =>
  [...section.querySelectorAll("[data-slot=preference]")].map((row) => row.textContent);

/** The text an element's aria-describedby points to. */
const description = (element: Element): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();

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

  it("says what a preference is, with two examples and the form, when there's none", async () => {
    const { sent } = renderPage({ preferences: emptyPreferencesView });
    const section = await everywhere();
    expect(section.textContent).toContain("A preference is one rule for AI reviews");
    expect(section.textContent).toContain("Tenant isolation: every query filters by tenant ID");
    expect(section.textContent).toContain("“Naming”");
    expect(screen.queryByRole("region", { name: "Suggested" })).toBeNull();
    // The form is there already, so there's no button to open it and nothing to cancel.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await userEvent.type(within(section).getByRole("textbox"), "Unbounded retries");
    await userEvent.click(within(section).getByRole("button", { name: "Add preference" }));
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    expect(sent("POST", "/api/preferences")[0]?.body).toEqual({
      kind: "look-for",
      text: "Unbounded retries",
      scope: { kind: "global" },
    });
    expect(section.textContent).not.toContain("A preference is one rule");
  });

  it("lists each scope's preferences with their kind, source and switch", async () => {
    renderPage();
    const section = await everywhere();
    expect(rows(section)).toEqual([
      "Look forTenant isolation: every query filters by tenant IDwritten",
      "Don't flagNaminglearned",
    ]);
    expect(within(section).getByText("2 preferences")).toBeTruthy();
    expect(rows(shop())).toEqual([
      "Look forMigrations that lock a tableimported",
      "Don't flagMissing tests for changes that only add loggingwritten · off",
    ]);
    const switches = within(shop()).getAllByRole("switch", { name: /^Use in AI reviews: / });
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
    const off = within(shop()).getByRole("switch", { name: /Missing tests/ });
    await userEvent.click(off);
    expect((await within(shop()).findByRole("alert")).textContent).toBe(
      "50 preferences are already enabled for acme/shop: switch one off or delete it first.",
    );
    expect(off.getAttribute("aria-checked")).toBe("false");
  });

  it("adds a preference from a repository's section, on that repository", async () => {
    const { sent } = renderPage();
    await everywhere();
    const open = within(shop()).getByRole("button", { name: "Add preference for acme/shop" });
    await userEvent.click(open);
    const form = within(shop()).getByRole("form", { name: "Add a preference" });
    expect(document.activeElement).toBe(within(form).getByRole("textbox"));
    expect(within(form).getByRole("combobox", { name: "Applies to" }).textContent).toContain(
      "acme/shop",
    );
    await userEvent.type(within(form).getByRole("textbox"), "Money as floats{Enter}");
    await waitFor(() => expect(rows(shop())).toHaveLength(3));
    expect(sent("POST", "/api/preferences")[0]?.body).toMatchObject({
      text: "Money as floats",
      scope: { kind: "repo", repo: { host: "github", owner: "acme", repo: "shop" } },
    });
    // The form closes, and the focus is back where it was opened from.
    expect(within(shop()).queryByRole("form")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("edits a preference in place, from its menu", async () => {
    const { sent } = renderPage();
    const section = await everywhere();
    await userEvent.click(within(section).getByRole("button", { name: "More for: Naming" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const form = within(section).getByRole("form", { name: "Edit: Naming" });
    const field = within(form).getByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "Names of locals");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rows(section)[1]).toBe("Don't flagNames of localslearned"));
    expect(sent("PUT", "/api/preferences/pref_0000000000000002")[0]?.body).toEqual({
      kind: "dont-flag",
      text: "Names of locals",
      scope: { kind: "global" },
    });
    // The form went, so the focus is back on the menu it was opened from.
    expect(document.activeElement).toBe(
      within(section).getByRole("button", { name: "More for: Names of locals" }),
    );
  });

  it("asks before deleting a preference", async () => {
    const { sent } = renderPage();
    const section = await everywhere();
    await userEvent.click(within(section).getByRole("button", { name: "More for: Naming" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete preference" });
    expect(dialog.textContent).toContain("Naming");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(rows(section)).toHaveLength(2);
    expect(sent("DELETE", "/api/preferences/pref_0000000000000002")).toHaveLength(0);

    await userEvent.click(within(section).getByRole("button", { name: "More for: Naming" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    expect(sent("DELETE", "/api/preferences/pref_0000000000000002")).toHaveLength(1);
  });
});

describe("PreferencesPage's suggestions", () => {
  it("shows what a proposal would add, where, and what it's based on", async () => {
    renderPage();
    await everywhere();
    const proposals = [...suggested().querySelectorAll("[data-slot=proposal]")];
    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.textContent).toContain("Don't flagMissing JSDoc on internal helpers");
    expect(proposals[0]?.textContent).toContain("acme/shop, from what you did in reviews");
    expect(proposals[0]?.textContent).toContain(
      "Based on:Dismissed: Missing JSDoc on `parseConfig`, acme/shop #121",
    );
    expect(within(suggested()).getByText("2 suggestions")).toBeTruthy();
  });

  it("accepts a proposal as it reads, which makes it a preference", async () => {
    const { sent } = renderPage();
    await everywhere();
    await userEvent.click(
      within(suggested()).getByRole("button", {
        name: "Accept: Missing JSDoc on internal helpers",
      }),
    );
    await waitFor(() => expect(rows(shop())).toHaveLength(3));
    expect(rows(shop())[2]).toBe("Don't flagMissing JSDoc on internal helperslearned");
    expect(sent("PUT", "/api/preferences/proposals/prop_0000000000000001")[0]?.body).toEqual({
      decision: "accept",
    });
    expect(suggested().querySelectorAll("[data-slot=proposal]")).toHaveLength(1);
    // The button went with its proposal, so the card takes the focus.
    expect(document.activeElement).toBe(suggested());
  });

  it("opens a proposal in the form first, and accepts it as edited", async () => {
    const { sent } = renderPage();
    const section = await everywhere();
    const edit = () => within(suggested()).getByRole("button", { name: /^Edit: Cached data/ });
    // Cancel leaves the proposal waiting, with the focus back on Edit.
    await userEvent.click(edit());
    await userEvent.click(within(suggested()).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(edit());
    expect(sent("PUT", "/api/preferences/proposals/prop_0000000000000002")).toHaveLength(0);

    await userEvent.click(edit());
    const form = within(suggested()).getByRole("form", { name: /^Edit the suggestion/ });
    const field = within(form).getByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "Caches with no invalidation");
    await userEvent.click(within(form).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(rows(section)).toHaveLength(3));
    expect(sent("PUT", "/api/preferences/proposals/prop_0000000000000002")[0]?.body).toEqual({
      decision: "accept",
      kind: "look-for",
      text: "Caches with no invalidation",
      scope: { kind: "global" },
    });
  });

  it("rejects a proposal, and the card goes with the last one", async () => {
    const { sent } = renderPage({
      preferences: {
        ...fixturePreferencesView,
        proposals: fixturePreferencesView.proposals.slice(0, 1),
      },
    });
    await everywhere();
    await userEvent.click(within(suggested()).getByRole("button", { name: /^Reject: / }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Suggested" })).toBeNull());
    expect(sent("PUT", "/api/preferences/proposals/prop_0000000000000001")[0]?.body).toEqual({
      decision: "reject",
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("opens the form on a proposal too long to accept as it reads", async () => {
    const [proposal] = fixturePreferencesView.proposals;
    if (proposal === undefined) throw new Error("the fixture has proposals");
    const { sent } = renderPage({
      preferences: {
        ...fixturePreferencesView,
        proposals: [{ ...proposal, text: "x".repeat(310) }],
      },
    });
    await everywhere();
    await userEvent.click(within(suggested()).getByRole("button", { name: /^Accept: / }));
    const form = within(suggested()).getByRole("form");
    expect(within(form).getByRole("status").textContent).toContain("this is 10 too many");
    expect(sent("PUT", `/api/preferences/proposals/${proposal.id}`)).toHaveLength(0);
  });

  it("says why a decision failed, and keeps the proposal", async () => {
    renderPage({
      overrides: {
        "PUT /api/preferences/proposals/prop_0000000000000001": () =>
          failure(400, "bad-request", "The proposal is already accepted"),
      },
    });
    await everywhere();
    await userEvent.click(
      within(suggested()).getByRole("button", { name: /^Accept: Missing JSDoc/ }),
    );
    expect((await within(suggested()).findByRole("alert")).textContent).toBe(
      "The proposal is already accepted.",
    );
    expect(suggested().querySelectorAll("[data-slot=proposal]")).toHaveLength(2);
  });
});

describe("PreferencesPage's Suggest from my reviews", () => {
  const suggest = () => screen.getByRole("button", { name: "Suggest from my reviews" });
  const withoutProposals = { ...fixturePreferencesView, proposals: [] };

  it("says which model runs it and who pays, and what's recorded", async () => {
    renderPage({ preferences: withoutProposals });
    await everywhere();
    await waitFor(() =>
      expect(description(suggest())).toBe("Runs Sonnet 5.5 through Claude Code, on your Pro plan"),
    );
    expect(screen.getByText("14 actions recorded since the last suggestions")).toBeTruthy();
  });

  it("says it's running and how long, can't run twice, then says what it proposed", async () => {
    const pending = held();
    let nowMs = 1_000_000;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sent } = renderPage({
      preferences: withoutProposals,
      overrides: { "POST /api/preferences/suggestions": pending.respond },
      now: () => nowMs,
    });
    await everywhere();
    await waitFor(() => expect(suggest().getAttribute("aria-disabled")).not.toBe("true"));
    await userEvent.click(suggest());
    expect(suggest().getAttribute("aria-busy")).toBe("true");
    expect(suggest().getAttribute("aria-disabled")).toBe("true");
    const status = within(suggest().closest("[data-slot=model-action]") as HTMLElement).getByRole(
      "status",
    );
    expect(status.textContent).toBe("Reading what you did in reviews… 0:00");
    nowMs += 12_000;
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(status.textContent).toBe("Reading what you did in reviews… 0:12");
    await userEvent.click(suggest());
    expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(1);
    expect(sent("POST", "/api/preferences/suggestions")[0]?.body).toEqual({
      optionId: fixtureStatus.model.defaultId,
    });

    await act(async () =>
      pending.release(
        jsonResponse(200, { proposals: fixturePreferencesView.proposals, signals: 14 }),
      ),
    );
    expect(await screen.findByText("2 suggestions from 14 actions, above.")).toBeTruthy();
    expect(suggested().querySelectorAll("[data-slot=proposal]")).toHaveLength(2);
    // Nothing's new since, so it can't run again until something is recorded.
    expect(suggest().getAttribute("aria-disabled")).toBe("true");
    expect(description(suggest())).toBe(NOTHING_RECORDED);
  });

  it("runs on the model chosen beside it, which every model button shares", async () => {
    const { sent } = renderPage({ preferences: withoutProposals });
    await everywhere();
    const action = suggest().closest("[data-slot=model-action]") as HTMLElement;
    await userEvent.click(await within(action).findByRole("button", { name: "Model: Sonnet 5.5" }));
    await userEvent.click(
      within(await screen.findByRole("menu")).getAllByRole("menuitemradio", {
        name: "Opus 5.5",
      })[0] as HTMLElement,
    );
    await waitFor(() =>
      expect(description(suggest())).toBe("Runs Opus 5.5 through Claude Code, on your Pro plan"),
    );
    expect(within(shop()).getByRole("button", { name: "Model: Opus 5.5" })).toBeTruthy();
    await userEvent.click(suggest());
    await waitFor(() => expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(1));
    expect(sent("POST", "/api/preferences/suggestions")[0]?.body).toEqual({
      optionId: "claude-code/claude-opus-5-5",
    });
    // The same per-browser choice as Request AI review's.
    expect(window.localStorage.getItem("megareviewer:model-option")).toBe(
      JSON.stringify("claude-code/claude-opus-5-5"),
    );
  });

  it("keeps the model's arrow when nothing is recorded, for Import", async () => {
    renderPage({ preferences: { ...withoutProposals, signalsSinceSuggestion: 0 } });
    await everywhere();
    const action = suggest().closest("[data-slot=model-action]") as HTMLElement;
    const arrow = await within(action).findByRole("button", { name: "Model: Sonnet 5.5" });
    expect(arrow.hasAttribute("disabled")).toBe(false);
  });

  it("is disabled but focusable with nothing recorded, and says what's recorded", async () => {
    const { sent } = renderPage({
      preferences: { ...withoutProposals, signalsSinceSuggestion: 0 },
    });
    await everywhere();
    expect(suggest().getAttribute("aria-disabled")).toBe("true");
    expect(suggest().hasAttribute("disabled")).toBe(false);
    expect(description(suggest())).toBe(NOTHING_RECORDED);
    expect(screen.getByText(NOTHING_RECORDED, { selector: "[role=status]" })).toBeTruthy();
    suggest().focus();
    expect(document.activeElement).toBe(suggest());
    await userEvent.click(suggest());
    expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(0);
  });

  it("says why no model can run it", async () => {
    const locked: StatusResponse = { ...fixtureStatus, model: lockedModelOptions };
    renderPage({
      preferences: withoutProposals,
      overrides: { "GET /api/status": () => jsonResponse(200, locked) },
    });
    await everywhere();
    await waitFor(() => expect(description(suggest())).toMatch(/Claude Code isn't signed in/));
    expect(suggest().getAttribute("aria-disabled")).toBe("true");
  });

  it("shows the reason beside it when it fails, with Try again", async () => {
    let fail = true;
    const { sent } = renderPage({
      preferences: withoutProposals,
      overrides: {
        "POST /api/preferences/suggestions": () =>
          fail
            ? failure(502, "model-error", "The model is overloaded")
            : jsonResponse(200, { proposals: [], signals: 14 }),
      },
    });
    await everywhere();
    await waitFor(() => expect(suggest().getAttribute("aria-disabled")).not.toBe("true"));
    await userEvent.click(suggest());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The model call failed: The model is overloaded.");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing new to suggest from 14 actions.")).toBeTruthy();
    expect(sent("POST", "/api/preferences/suggestions")).toHaveLength(2);
  });
});

describe("PreferencesPage's repositories", () => {
  const files = (section: HTMLElement) =>
    [...section.querySelectorAll("[data-slot=guideline-file]")].map((file) => file.textContent);

  it("lists a repository's guideline files with their size, one too large without a switch", async () => {
    renderPage();
    await everywhere();
    expect(shop().textContent).toContain(
      "Guideline files, read at the base commit of the pull request",
    );
    expect(files(shop())).toEqual([
      "REVIEW.md1.2 KB",
      "CLAUDE.md48 KBtoo large to send: a guideline file can be 32 KB",
      "CONTRIBUTING.md5.9 KB",
    ]);
    const switches = within(shop()).getAllByRole("switch", { name: /^Read / });
    expect(switches.map((one) => one.getAttribute("aria-label"))).toEqual([
      "Read REVIEW.md in AI reviews of acme/shop",
      "Read CONTRIBUTING.md in AI reviews of acme/shop",
    ]);
  });

  it("switches a guideline file", async () => {
    const { sent } = renderPage();
    await everywhere();
    const review = within(shop()).getByRole("switch", { name: /^Read REVIEW\.md/ });
    await userEvent.click(review);
    await waitFor(() => expect(review.getAttribute("aria-checked")).toBe("false"));
    expect(sent("PUT", "/api/preferences/guidelines")[0]?.body).toEqual({
      repo: { host: "github", owner: "acme", repo: "shop" },
      path: "REVIEW.md",
      enabled: false,
    });
  });

  it("says why a guideline switch failed, and leaves it as it was", async () => {
    renderPage({
      overrides: {
        "PUT /api/preferences/guidelines": () => failure(500, "internal", "The store is locked"),
      },
    });
    await everywhere();
    const review = within(shop()).getByRole("switch", { name: /^Read REVIEW\.md/ });
    await userEvent.click(review);
    expect((await within(shop()).findByRole("alert")).textContent).toBe("The store is locked.");
    expect(review.getAttribute("aria-checked")).toBe("true");
  });

  it("says why a repository's guideline files weren't read, or that it has none", async () => {
    const [first] = fixturePreferencesView.repositories;
    if (first === undefined) throw new Error("the fixture has repositories");
    renderPage({
      preferences: {
        ...fixturePreferencesView,
        repositories: [
          { ...first, guidelineFiles: [] },
          ...fixturePreferencesView.repositories.slice(1),
        ],
      },
    });
    await everywhere();
    expect(shop().textContent).toContain(
      "None at the repository's root, where megareviewer looks for REVIEW.md, AGENTS.md, CLAUDE.md, CONTRIBUTING.md, or .github/copilot-instructions.md.",
    );
    const api = screen.getByRole("region", { name: /^acme\/api/ });
    expect(api.textContent).toContain("Bitbucket");
    expect(api.textContent).toContain("No pull request of this repository has been analyzed yet.");
  });

  it("imports from past reviews, and says what it read", async () => {
    const { sent } = renderPage();
    await everywhere();
    const button = within(shop()).getByRole("button", { name: "Import from my past reviews" });
    await waitFor(() =>
      expect(description(button)).toBe(
        "Reads your own comments on its recent pull requests on GitHub, then runs Sonnet 5.5 through Claude Code, on your Pro plan",
      ),
    );
    await userEvent.click(button);
    expect(
      await within(shop()).findByText(
        "Read 92 comments from 30 pull requests: 1 suggestion, above.",
      ),
    ).toBeTruthy();
    expect(sent("POST", "/api/preferences/imports")[0]?.body).toEqual({
      repo: { host: "github", owner: "acme", repo: "shop" },
      optionId: fixtureStatus.model.defaultId,
    });
    expect(suggested().querySelectorAll("[data-slot=proposal]")).toHaveLength(3);
    expect(suggested().textContent).toContain("acme/shop, from your past reviews");

    // Again, there's nothing it hasn't proposed already.
    await userEvent.click(button);
    expect(
      await within(shop()).findByText(
        "Read 92 comments from 30 pull requests: nothing new to suggest.",
      ),
    ).toBeTruthy();
  });

  it("says when an import found no comments, and why one failed", async () => {
    renderPage({
      overrides: {
        "POST /api/preferences/imports": (request) =>
          JSON.stringify(request.body).includes("bitbucket")
            ? failure(400, "bad-request", "megareviewer can't read past reviews from Bitbucket")
            : jsonResponse(200, { proposals: [], comments: 0, pullRequests: 30 }),
      },
    });
    await everywhere();
    const button = within(shop()).getByRole("button", { name: "Import from my past reviews" });
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
    await userEvent.click(button);
    expect(
      await within(shop()).findByText("Found no comment of yours on its last 30 pull requests."),
    ).toBeTruthy();
    const api = screen.getByRole("region", { name: /^acme\/api/ });
    await userEvent.click(within(api).getByRole("button", { name: /^Import/ }));
    expect((await within(api).findByRole("alert")).textContent).toContain(
      "megareviewer can't read past reviews from Bitbucket.",
    );
  });
});
