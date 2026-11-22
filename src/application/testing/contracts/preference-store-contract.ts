import { beforeEach, describe, expect, it } from "vitest";
import {
  type Preference,
  PreferenceId,
  type PreferenceProposal,
  ProposalId,
  type RepoRef,
  type ReviewSignal,
  SignalKey,
} from "../../../domain/review/index.ts";
import type { PreferenceStore } from "../../ports/index.ts";

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const otherRepo: RepoRef = { host: "github", owner: "acme", repo: "api" };

const preference = (overrides: Partial<Preference> = {}): Preference => ({
  id: PreferenceId.parse("pref_00000000000000a1"),
  kind: "look-for",
  text: "Tenant isolation: every query filters by tenant ID",
  scope: { kind: "global" },
  source: "written",
  enabled: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const proposal = (overrides: Partial<PreferenceProposal> = {}): PreferenceProposal => ({
  id: ProposalId.parse("prop_00000000000000b1"),
  kind: "dont-flag",
  text: "Missing JSDoc on internal helpers",
  scope: { kind: "repo", repo },
  source: "learned",
  evidence: ["Dismissed: Missing JSDoc on `parseConfig`, acme/shop #12"],
  status: "pending",
  createdAt: "2026-11-02T10:00:00.000Z",
  ...overrides,
});

const signal = (overrides: Partial<ReviewSignal> = {}): ReviewSignal => ({
  kind: "dismissed",
  at: "2026-11-03T10:00:00.000Z",
  pullRequest: { repo, number: 12 },
  pointKind: "finding",
  title: "Missing JSDoc on `parseConfig`",
  text: "The exported helper has no doc comment.",
  path: "src/config.ts",
  ...overrides,
});

const key = (text: string): SignalKey => SignalKey.parse(text);

export const describePreferenceStoreContract = (
  name: string,
  setup: () => PreferenceStore,
): void => {
  describe(`PreferenceStore contract: ${name}`, () => {
    let store: PreferenceStore;
    beforeEach(() => {
      store = setup();
    });

    it("starts empty", async () => {
      expect(await store.listPreferences()).toEqual([]);
      expect(await store.listProposals()).toEqual([]);
      expect(await store.listSignals(10)).toEqual([]);
      expect(await store.getGuidelineSwitches(repo)).toEqual(new Map());
    });

    it("lists preferences in the order they were made, whatever order they were saved in", async () => {
      const scoped = preference({
        id: PreferenceId.parse("pref_00000000000000a2"),
        kind: "dont-flag",
        text: "Naming of test helpers",
        scope: { kind: "repo", repo },
        source: "imported",
        enabled: false,
        createdAt: "2026-11-01T11:00:00.000Z",
      });
      await store.savePreference(scoped);
      await store.savePreference(preference());

      expect(await store.listPreferences()).toEqual([preference(), scoped]);
    });

    it("lists ones made at the same time in the order first saved, also after one is saved again", async () => {
      const ids = ["pref_00000000000000c3", "pref_00000000000000c1", "pref_00000000000000c2"];
      const made = ids.map((id) => preference({ id: PreferenceId.parse(id), text: id }));
      for (const one of made) await store.savePreference(one);
      const [first, second, third] = made;
      if (first === undefined) throw new Error("made three");
      await store.savePreference({ ...first, enabled: false });

      expect(await store.listPreferences()).toEqual([{ ...first, enabled: false }, second, third]);
    });

    it("replaces a preference saved again under its id", async () => {
      await store.savePreference(preference());
      const edited = preference({
        kind: "dont-flag",
        text: "Naming",
        scope: { kind: "repo", repo },
        source: "learned",
        enabled: false,
        updatedAt: "2026-11-05T10:00:00.000Z",
      });
      await store.savePreference(edited);

      expect(await store.listPreferences()).toEqual([edited]);
    });

    it("deletes a preference, and nothing for an id it doesn't have", async () => {
      await store.savePreference(preference());
      await store.deletePreference(PreferenceId.parse("pref_00000000000000ff"));
      expect(await store.listPreferences()).toEqual([preference()]);

      await store.deletePreference(preference().id);
      expect(await store.listPreferences()).toEqual([]);
    });

    it("keeps proposals with their evidence, and a decided one under its id", async () => {
      const imported = proposal({
        id: ProposalId.parse("prop_00000000000000b2"),
        kind: "look-for",
        text: "Migrations that lock a table",
        scope: { kind: "global" },
        source: "imported",
        evidence: [],
        createdAt: "2026-11-02T11:00:00.000Z",
      });
      await store.saveProposal(imported);
      await store.saveProposal(proposal());
      expect(await store.listProposals()).toEqual([proposal(), imported]);

      await store.saveProposal(proposal({ status: "rejected" }));
      expect(await store.listProposals()).toEqual([proposal({ status: "rejected" }), imported]);
    });

    it("lists signals newest first, up to the limit", async () => {
      const comment = signal({
        kind: "comment",
        at: "2026-11-04T10:00:00.000Z",
        pullRequest: { repo: otherRepo, number: 3 },
        pointKind: null,
        title: "",
        text: "Say the charset.",
        path: null,
      });
      const raised = signal({ kind: "raised", at: "2026-11-05T10:00:00.000Z", pointKind: "risk" });
      await store.recordSignal(key("point:a:f1"), signal());
      await store.recordSignal(key("review:a:1:summary"), comment);
      await store.recordSignal(key("point:a:r1"), raised);

      expect(await store.listSignals(10)).toEqual([raised, comment, signal()]);
      expect(await store.listSignals(2)).toEqual([raised, comment]);
      // One repository's, newest first, as many as asked for.
      expect(await store.listSignals(10, otherRepo)).toEqual([comment]);
      expect(await store.listSignals(1, repo)).toEqual([raised]);
      expect(await store.listSignals(10, { ...repo, host: "bitbucket" })).toEqual([]);
    });

    it("writes a signal once per key, the latest standing", async () => {
      await store.recordSignal(key("point:a:f1"), signal());
      const raised = signal({ kind: "raised", at: "2026-11-06T10:00:00.000Z" });
      await store.recordSignal(key("point:a:f1"), raised);

      expect(await store.listSignals(10)).toEqual([raised]);
    });

    it("removes a signal by its key, and nothing for a key it doesn't have", async () => {
      await store.recordSignal(key("point:a:f1"), signal());
      await store.removeSignal(key("point:a:f2"));
      expect(await store.listSignals(10)).toHaveLength(1);

      await store.removeSignal(key("point:a:f1"));
      expect(await store.listSignals(10)).toEqual([]);
    });

    it("keeps guideline switches per repository and path, the latest standing", async () => {
      await store.setGuidelineSwitch(repo, "REVIEW.md", false);
      await store.setGuidelineSwitch(repo, "CLAUDE.md", true);
      await store.setGuidelineSwitch(repo, "CLAUDE.md", false);
      await store.setGuidelineSwitch(otherRepo, "AGENTS.md", true);

      expect(await store.getGuidelineSwitches(repo)).toEqual(
        new Map([
          ["REVIEW.md", false],
          ["CLAUDE.md", false],
        ]),
      );
      expect(await store.getGuidelineSwitches(otherRepo)).toEqual(new Map([["AGENTS.md", true]]));
      expect(await store.getGuidelineSwitches({ ...repo, host: "bitbucket" })).toEqual(new Map());
    });

    it("keeps what it was given, not the caller's own array", async () => {
      const evidence = ["Dismissed: Missing JSDoc on `parseConfig`, acme/shop #12"];
      await store.saveProposal(proposal({ evidence }));
      evidence.push("added after saving");

      expect(await store.listProposals()).toEqual([proposal()]);
    });
  });
};
