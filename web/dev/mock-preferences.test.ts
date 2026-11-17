import { describe, expect, it } from "vitest";
import {
  ErrorResponse,
  ImportedPreferences,
  PreferencesView,
  ProposalDecided,
  SuggestedPreferences,
  TOKEN_HEADER,
} from "../../contracts/index.ts";
import { Preference } from "../../src/domain/review/index.ts";
import {
  emptyPreferencesView,
  fixtureAnalysisView,
  fixturePreferencesView,
} from "./fixtures/index.ts";
import { createMockApi, MOCK_TOKEN, type MockRequest } from "./mock-routes.ts";

const NOW = "2026-10-22T10:00:00Z";
const shop = fixtureAnalysisView.analysis.key.ref.repo;

const request = (method: string, path: string, body?: unknown): MockRequest => ({
  method,
  path,
  query: new URLSearchParams(),
  headers: { [TOKEN_HEADER]: MOCK_TOKEN },
  body,
});

const mock = (preferences = fixturePreferencesView) => {
  const api = createMockApi({ now: () => NOW, preferences });
  const send = (method: string, path: string, body?: unknown) =>
    api.handle(request(method, path, body));
  const view = () => PreferencesView.parse(send("GET", "/api/preferences").body);
  return { send, view };
};

const message = (response: { body: unknown }) => ErrorResponse.parse(response.body).error.message;

describe("the mock API's preferences", () => {
  it("starts with the fixture's, or the ones it's given", () => {
    expect(mock().view()).toEqual(fixturePreferencesView);
    expect(mock(emptyPreferencesView).view()).toEqual(emptyPreferencesView);
  });

  it("adds, changes and deletes a preference", () => {
    const { send, view } = mock(emptyPreferencesView);
    const added = Preference.parse(
      send("POST", "/api/preferences", {
        kind: "dont-flag",
        text: " Naming ",
        scope: { kind: "global" },
        source: "learned",
      }).body,
    );
    expect(added).toMatchObject({ text: "Naming", source: "learned", enabled: true });
    const changed = send("PUT", `/api/preferences/${added.id}`, { enabled: false });
    expect(Preference.parse(changed.body).enabled).toBe(false);
    expect(view().preferences).toEqual([{ ...added, enabled: false }]);
    expect(send("DELETE", `/api/preferences/${added.id}`).status).toBe(200);
    expect(view().preferences).toEqual([]);
    expect(send("DELETE", `/api/preferences/${added.id}`).status).toBe(404);
    expect(send("PUT", `/api/preferences/${added.id}`, {}).status).toBe(404);
  });

  it("refuses a rule without text, and the 51st enabled in a scope", () => {
    const { send } = mock(emptyPreferencesView);
    const rule = (text: string) => ({ kind: "look-for", text, scope: { kind: "global" } });
    expect(send("POST", "/api/preferences", rule(" ")).status).toBe(400);
    for (let n = 1; n <= 50; n += 1) {
      expect(send("POST", "/api/preferences", rule(`Rule ${n}`)).status).toBe(200);
    }
    expect(message(send("POST", "/api/preferences", rule("One more")))).toBe(
      "50 preferences are already enabled for every repository: switch one off or delete it first",
    );
  });

  it("proposes from what the reviewer did, once, and only with something recorded", () => {
    const { send, view } = mock({ ...emptyPreferencesView, signalsSinceSuggestion: 3 });
    const first = SuggestedPreferences.parse(send("POST", "/api/preferences/suggestions").body);
    expect(first).toMatchObject({ signals: 3 });
    expect(first.proposals).toHaveLength(2);
    expect(view()).toMatchObject({ proposals: first.proposals, signalsSinceSuggestion: 0 });
    expect(message(send("POST", "/api/preferences/suggestions"))).toMatch(/^Nothing to suggest/);

    // A dismissed point is something to suggest from; what's waiting isn't proposed again.
    const id = fixtureAnalysisView.analysis.id;
    send("PUT", `/api/analyses/${id}/points/f1`, { state: "dismissed" });
    send("PUT", `/api/analyses/${id}/points/f1`, { state: "open" });
    expect(view().signalsSinceSuggestion).toBe(1);
    const again = SuggestedPreferences.parse(send("POST", "/api/preferences/suggestions").body);
    expect(again).toEqual({ proposals: [], signals: 1 });
  });

  it("imports from a repository's past reviews on GitHub", () => {
    const { send } = mock();
    const imported = ImportedPreferences.parse(
      send("POST", "/api/preferences/imports", { repo: shop }).body,
    );
    expect(imported).toMatchObject({ comments: 92, pullRequests: 30 });
    expect(imported.proposals[0]).toMatchObject({ source: "imported", scope: { repo: shop } });
    const bitbucket = { host: "bitbucket", owner: "acme", repo: "api" };
    expect(message(send("POST", "/api/preferences/imports", { repo: bitbucket }))).toBe(
      "megareviewer can't read past reviews from Bitbucket",
    );
    expect(send("POST", "/api/preferences/imports", {}).status).toBe(400);
  });

  it("accepts a proposal as a preference, with the reviewer's changes, or rejects it for good", () => {
    const { send, view } = mock();
    const [first, second] = fixturePreferencesView.proposals;
    if (first === undefined || second === undefined) throw new Error("the fixture has two");
    const accepted = ProposalDecided.parse(
      send("PUT", `/api/preferences/proposals/${first.id}`, {
        decision: "accept",
        text: "JSDoc on helpers",
      }).body,
    );
    expect(accepted.preference).toMatchObject({
      kind: first.kind,
      text: "JSDoc on helpers",
      scope: first.scope,
      source: "learned",
    });
    expect(view().preferences.at(-1)).toEqual(accepted.preference);
    expect(
      send("PUT", `/api/preferences/proposals/${first.id}`, { decision: "accept" }).status,
    ).toBe(404);

    const rejected = send("PUT", `/api/preferences/proposals/${second.id}`, { decision: "reject" });
    expect(ProposalDecided.parse(rejected.body).preference).toBeNull();
    expect(view().proposals).toEqual([]);
    const again = SuggestedPreferences.parse(send("POST", "/api/preferences/suggestions").body);
    expect(again.proposals.map((proposal) => proposal.text)).toEqual([first.text]);
  });

  it("leaves a proposal too long for a preference until it's edited", () => {
    const [first] = fixturePreferencesView.proposals;
    if (first === undefined) throw new Error("the fixture has proposals");
    const { send, view } = mock({
      ...fixturePreferencesView,
      proposals: [{ ...first, text: "x".repeat(301) }],
    });
    const refused = send("PUT", `/api/preferences/proposals/${first.id}`, { decision: "accept" });
    expect(message(refused)).toBe("A preference is one sentence of at most 300 characters");
    expect(view().proposals).toHaveLength(1);
  });

  it("switches a repository's guideline file", () => {
    const { send, view } = mock();
    const switched = send("PUT", "/api/preferences/guidelines", {
      repo: shop,
      path: "REVIEW.md",
      enabled: false,
    });
    expect(switched.status).toBe(200);
    expect(view().repositories[0]?.guidelineFiles?.[0]).toMatchObject({
      path: "REVIEW.md",
      enabled: false,
    });
    expect(
      send("PUT", "/api/preferences/guidelines", { repo: shop, path: "README.md" }).status,
    ).toBe(400);
  });
});
