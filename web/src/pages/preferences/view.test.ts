import { describe, expect, it } from "vitest";
import { PreferenceId, type RepoRef } from "../../../../src/domain/review/index.ts";
import {
  emptyPreferencesView,
  fixtureImport,
  fixturePreferencesView as view,
} from "../../../dev/fixtures/index.ts";
import { GLOBAL, scopeOptions } from "./rule.tsx";
import {
  formatBytes,
  isFirstRun,
  listName,
  panelFor,
  plural,
  preferencesIn,
  proposalGroups,
  proposalsIn,
  repositoriesOf,
  SUGGESTIONS,
  sentence,
  suggestionSaid,
  whereAdded,
  withGuidelineSwitch,
  withoutPreference,
  withoutProposal,
  withPreference,
  withProposals,
} from "./view.ts";

const [first] = view.preferences;
const [shop] = view.repositories;
if (first === undefined || shop === undefined) throw new Error("the fixture has both");

describe("the preferences view", () => {
  it("replaces a saved preference in place, and puts a new one last", () => {
    const edited = { ...first, text: "Tenant isolation" };
    expect(withPreference(view, edited).preferences[0]).toBe(edited);
    const added = { ...first, id: PreferenceId.parse("pref_00000000000000ff") };
    expect(withPreference(view, added).preferences.at(-1)).toBe(added);
    expect(withPreference(view, added).preferences).toHaveLength(view.preferences.length + 1);
  });

  it("takes out a deleted preference and a decided proposal", () => {
    expect(withoutPreference(view, first.id).preferences).not.toContain(first);
    const [proposal] = view.proposals;
    if (proposal === undefined) throw new Error("the fixture has proposals");
    expect(withoutProposal(view, proposal.id).proposals).toEqual(view.proposals.slice(1));
  });

  it("adds new proposals after the ones waiting, each once", () => {
    const added = withProposals(view, [fixtureImport, ...view.proposals]);
    expect(added.proposals).toEqual([...view.proposals, fixtureImport]);
  });

  it("switches one guideline file of one repository", () => {
    const switched = withGuidelineSwitch(view, shop.repo, "CONTRIBUTING.md", true);
    expect(switched.repositories[0]?.guidelineFiles?.map((file) => file.enabled)).toEqual([
      true,
      false,
      true,
    ]);
    expect(switched.repositories[1]).toBe(view.repositories[1]);
  });

  it("lists a scope's preferences", () => {
    expect(preferencesIn(view, GLOBAL).map((one) => one.text)).toEqual([
      "Tenant isolation: every query filters by tenant ID",
      "Naming",
    ]);
    expect(preferencesIn(view, { kind: "repo", repo: shop.repo })).toHaveLength(2);
  });

  it("lists a scope's proposals, and groups them by scope in the scopes' order", () => {
    const options = scopeOptions(repositoriesOf(view).map((one) => one.repo));
    expect(proposalsIn(view, GLOBAL).map((one) => one.text)).toEqual([
      "Cached data that outlives a change to what it was made from",
    ]);
    expect(
      proposalGroups(view, options).map(({ option, proposals }) => [
        option.label,
        proposals.length,
      ]),
    ).toEqual([
      ["Everywhere", 1],
      ["acme/shop", 1],
    ]);
  });

  it("calls a repository with nothing for it yet a first run, and nothing else", () => {
    const ledger: RepoRef = { host: "github", owner: "acme", repo: "ledger" };
    expect(isFirstRun(view, { kind: "repo", repo: ledger })).toBe(true);
    // acme/api has a preference, acme/shop a proposal too.
    expect(
      isFirstRun(view, { kind: "repo", repo: { ...ledger, repo: "api", host: "bitbucket" } }),
    ).toBe(false);
    expect(isFirstRun(withoutProposalsOf(view), { kind: "repo", repo: shop.repo })).toBe(false);
    expect(isFirstRun(emptyPreferencesView, GLOBAL)).toBe(false);
  });

  it("gives a panel to a repository only a preference names", () => {
    const repo: RepoRef = { host: "github", owner: "acme", repo: "ledger" };
    const named = withPreference(emptyPreferencesView, { ...first, scope: { kind: "repo", repo } });
    expect(repositoriesOf(named)).toEqual([
      {
        repo,
        guidelineFiles: null,
        guidelineNote: "No pull request of this repository has been analyzed yet",
      },
    ]);
    expect(repositoriesOf(view)).toEqual(view.repositories);
  });
});

const withoutProposalsOf = (from: typeof view) => ({ ...from, proposals: [] });

describe("the panels", () => {
  const options = scopeOptions(view.repositories.map((one) => one.repo));

  it("shows the panel a key names, and Everywhere's for any other", () => {
    expect(panelFor(SUGGESTIONS, options)).toEqual({ kind: "suggestions" });
    expect(panelFor("github/acme/shop", options)).toEqual({ kind: "scope", option: options[1] });
    for (const key of [null, "global", "github/acme/gone", ""]) {
      expect(panelFor(key, options)).toEqual({ kind: "scope", option: options[0] });
    }
  });

  it("says where new proposals went", () => {
    const [jsdoc, cached] = view.proposals;
    if (jsdoc === undefined || cached === undefined) throw new Error("the fixture has two");
    expect(whereAdded([jsdoc], options)).toBe("for acme/shop");
    expect(whereAdded([jsdoc, fixtureImport], options)).toBe("for acme/shop");
    expect(whereAdded([jsdoc, cached, fixtureImport], options)).toBe(
      "1 for Everywhere and 2 for acme/shop",
    );
  });

  it("says what a suggestion read, and what it came to", () => {
    const read = { signals: 14, comments: 92, pullRequests: 30 };
    expect(suggestionSaid(read, 2, "1 for Everywhere and 1 for acme/shop")).toBe(
      "Read 92 comments from 30 pull requests and 14 actions recorded here: 2 suggestions, 1 for Everywhere and 1 for acme/shop.",
    );
    expect(suggestionSaid({ ...read, comments: 0, pullRequests: 0 }, 0, "")).toBe(
      "Read 14 actions recorded here: nothing new to suggest.",
    );
    expect(suggestionSaid({ signals: 0, comments: 1, pullRequests: 1 }, 1, "for acme/shop")).toBe(
      "Read 1 comment from 1 pull request: 1 suggestion, for acme/shop.",
    );
    expect(suggestionSaid({ signals: 0, comments: 0, pullRequests: 30 }, 0, "")).toBe(
      "Found no comment of yours on its last 30 pull requests, and nothing you did here.",
    );
    expect(suggestionSaid({ signals: 0, comments: 0, pullRequests: 0 }, 0, "")).toMatch(
      /^Found nothing to suggest from/,
    );
  });

  it("names a repository's owner in the list only where another has its name", () => {
    const shopRepo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
    const fork: RepoRef = { ...shopRepo, owner: "tomkx" };
    const elsewhere: RepoRef = { ...shopRepo, host: "bitbucket" };
    const api: RepoRef = { ...shopRepo, repo: "api" };
    expect(listName(shopRepo, [shopRepo, api])).toEqual({ owner: null, name: "shop" });
    expect(listName(fork, [shopRepo, fork, api])).toEqual({ owner: "tomkx", name: "shop" });
    // The same repository on two hosts is told apart by its host's mark, and its full name says the host.
    expect(listName(elsewhere, [shopRepo, elsewhere])).toEqual({ owner: "acme", name: "shop" });
  });
});

describe("scopeOptions", () => {
  it("offers everywhere, then each repository, naming the host of two of one name", () => {
    const github: RepoRef = { host: "github", owner: "acme", repo: "api" };
    const bitbucket: RepoRef = { host: "bitbucket", owner: "acme", repo: "api" };
    expect(scopeOptions([shop.repo, github, bitbucket]).map((option) => option.label)).toEqual([
      "Everywhere",
      "acme/shop",
      "acme/api on GitHub",
      "acme/api on Bitbucket",
    ]);
  });
});

describe("the page's words", () => {
  it("says a size as a file listing does", () => {
    expect([812, 1_240, 10_240, 48_900].map(formatBytes)).toEqual([
      "812 B",
      "1.2 KB",
      "10 KB",
      "48 KB",
    ]);
  });

  it("counts in words, and ends a server's message once", () => {
    expect([plural(1, "action"), plural(14, "action"), plural(0, "action")]).toEqual([
      "1 action",
      "14 actions",
      "0 actions",
    ]);
    expect([sentence("No history"), sentence("Done. "), sentence("")]).toEqual([
      "No history.",
      "Done.",
      "",
    ]);
  });
});
