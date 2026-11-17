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
  plural,
  preferencesIn,
  repositoriesOf,
  sentence,
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

  it("gives a section to a repository only a preference names", () => {
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
