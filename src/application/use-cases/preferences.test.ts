import { describe, expect, it } from "vitest";
import {
  type Analysis,
  type AnalysisKey,
  analysisId,
  type HostError,
  MAX_ENABLED_PREFERENCES,
  type ModelOption,
  type PastComment,
  PreferenceId,
  ProposalId,
  type RepoRef,
  type ReviewSignal,
  SignalKey,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { createAnalysisEvents } from "../events/index.ts";
import type { PreferenceSuggester, ProposalDraft } from "../ports/index.ts";
import {
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakePreferenceSuggester,
  FakeReviewHistory,
  FakeTicketSource,
  FixedClock,
  fakeModelOption,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  InMemoryPreferenceStore,
  type PullRequestFixture,
  RecordingLogger,
  smallFeature,
  smallFeatureAnalysis,
} from "../testing/index.ts";
import { createUseCases } from "./index.ts";
import { SUGGESTION_PULL_REQUESTS, SUGGESTION_SIGNALS } from "./preferences.ts";

const shop: RepoRef = smallFeature.pullRequest.ref.repo;
const api: RepoRef = { host: "github", owner: "acme", repo: "api" };
const network: HostError = { kind: "network", message: "socket hang up", retryAfterSeconds: null };

/** small-feature, in a repository with guideline files at its base commit. */
const withGuidelines: PullRequestFixture = {
  ...smallFeature,
  baseFiles: {
    ...smallFeature.baseFiles,
    "REVIEW.md": "Migrations must be reversible.\n",
    "CLAUDE.md": "x".repeat(40_000),
    ".github/copilot-instructions.md": "Prefer early returns.\n",
  },
};

const analysisOf = (repo: RepoRef, updatedAt: string, overrides: Partial<Analysis> = {}) => {
  const key: AnalysisKey = { ...smallFeatureAnalysis.key, ref: { repo, number: 7 } };
  return { ...smallFeatureAnalysis, id: analysisId(key), key, updatedAt, ...overrides };
};

const signal = (overrides: Partial<ReviewSignal> = {}): ReviewSignal => ({
  kind: "dismissed",
  at: "2026-11-03T10:00:00.000Z",
  pullRequest: { repo: shop, number: 12 },
  pointKind: "finding",
  title: "Missing JSDoc on `parseConfig`",
  text: "The exported helper has no doc comment.",
  path: "src/config.ts",
  ...overrides,
});

const jsdoc: ProposalDraft = {
  kind: "dont-flag",
  text: "Missing JSDoc on internal helpers",
  scope: "repo",
  evidence: ["Dismissed: Missing JSDoc on `parseConfig`, acme/shop #12"],
};
const tenant: ProposalDraft = {
  kind: "look-for",
  text: "Tenant isolation: every query filters by tenant ID",
  scope: "global",
  evidence: [],
};

const pastComment = (number: number, body: string): PastComment => ({
  pullRequest: { repo: shop, number },
  path: "src/orders.ts",
  body,
  at: `2026-10-0${number}T10:00:00.000Z`,
});

const setup = (
  options: {
    drafts?: readonly ProposalDraft[];
    suggester?: PreferenceSuggester | null;
    modelOptions?: readonly ModelOption[];
    comments?: readonly PastComment[];
    noHistory?: boolean;
    noHosts?: boolean;
  } = {},
) => {
  const clock = new FixedClock("2026-11-10T10:00:00.000Z");
  const github = new FakeGitHost({ host: "github", fixtures: [withGuidelines], clock });
  const store = new InMemoryAnalysisStore(clock);
  const preferences = new InMemoryPreferenceStore();
  const suggester = new FakePreferenceSuggester({ drafts: options.drafts ?? [jsdoc, tenant] });
  const history = new FakeReviewHistory({ host: "github", comments: options.comments ?? [] });
  const logger = new RecordingLogger();
  const useCases = createUseCases(
    {
      hosts: options.noHosts ? {} : { github },
      threads: {},
      statuses: {},
      tickets: new FakeTicketSource(),
      models: new FakeModelCatalog({
        suggester: options.suggester === undefined ? suggester : options.suggester,
        ...(options.modelOptions ? { options: options.modelOptions } : {}),
      }),
      store,
      fileCache: new InMemoryFileCache(),
      preferences,
      history: options.noHistory ? {} : { github: history },
      checkouts: new FakeLocalCheckouts(),
      parser: new FakeCodeParser(),
      events: createAnalysisEvents(),
      clock,
      logger,
    },
    { version: "1.2.3" },
  );
  const add = async (text: string, scope: "global" | RepoRef = "global") => {
    const added = await useCases.addPreference({
      kind: "look-for",
      text,
      scope: scope === "global" ? { kind: "global" } : { kind: "repo", repo: scope },
    });
    if (!added.ok) throw new Error(added.error.message);
    return added.value;
  };
  let recorded = 0;
  const record = async (...signals: ReviewSignal[]) => {
    for (const one of signals) {
      recorded += 1;
      await preferences.recordSignal(SignalKey.parse(`point:a:f${recorded}`), one);
    }
  };
  return { clock, github, store, preferences, suggester, history, logger, useCases, add, record };
};

const badRequest = (message: RegExp | string) => ({
  ok: false,
  error: { code: "bad-request", message: expect.stringMatching(message) },
});

describe("getPreferences", () => {
  it("is empty before the reviewer has written or done anything", async () => {
    expect(await setup().useCases.getPreferences()).toEqual({
      preferences: [],
      proposals: [],
      repositories: [],
    });
  });

  it("lists a repository analyzed here with the guideline files at its latest analysis's base commit", async () => {
    const { useCases, store, preferences, github } = setup();
    await store.saveAnalysis(smallFeatureAnalysis);
    await preferences.setGuidelineSwitch(shop, ".github/copilot-instructions.md", true);

    const view = await useCases.getPreferences();

    expect(view.repositories).toEqual([
      {
        repo: shop,
        guidelineFiles: [
          { path: "REVIEW.md", bytes: 31, enabled: true, tooLarge: false },
          { path: "CLAUDE.md", bytes: 40_000, enabled: false, tooLarge: true },
          { path: ".github/copilot-instructions.md", bytes: 22, enabled: true, tooLarge: false },
        ],
        guidelineNote: null,
      },
    ]);
    expect(github.getFilesCalls).toEqual([
      [
        "REVIEW.md",
        "AGENTS.md",
        "CLAUDE.md",
        "CONTRIBUTING.md",
        ".github/copilot-instructions.md",
      ].map((path) => ({ sha: smallFeature.pullRequest.baseSha, path })),
    ]);
  });

  it("reads the guideline files from the file cache the next time, the absent ones too", async () => {
    const { useCases, store, github } = setup();
    await store.saveAnalysis(smallFeatureAnalysis);
    const first = await useCases.getPreferences();
    const second = await useCases.getPreferences();

    expect(second).toEqual(first);
    expect(github.getFilesCalls).toHaveLength(1);
  });

  it("says why a repository's guideline files couldn't be looked for", async () => {
    const { useCases, store, github, add } = setup();
    await store.saveAnalysis(smallFeatureAnalysis);
    await store.saveAnalysis(
      analysisOf({ ...shop, host: "bitbucket" }, "2026-10-01T10:00:00.000Z"),
    );
    await add("Tenant isolation", api);
    github.failNext("getFiles", network);

    const view = await useCases.getPreferences();

    expect(view.repositories).toEqual([
      {
        repo: shop,
        guidelineFiles: null,
        guidelineNote: "Couldn't read its guideline files: socket hang up",
      },
      {
        repo: { ...shop, host: "bitbucket" },
        guidelineFiles: null,
        guidelineNote: "Couldn't read its guideline files: Bitbucket Cloud isn't configured",
      },
      {
        repo: api,
        guidelineFiles: null,
        guidelineNote: "No pull request of this repository has been analyzed yet",
      },
    ]);
  });

  it("orders repositories by their latest analysis, then the ones that only have a preference", async () => {
    const { useCases, store, add } = setup();
    const zeta: RepoRef = { ...shop, repo: "zeta" };
    await add("Naming", zeta);
    await add("Tenant isolation", api);
    await add("Retries", shop);
    await store.saveAnalysis(analysisOf(shop, "2026-10-02T10:00:00.000Z"));
    await store.saveAnalysis(analysisOf({ ...shop, repo: "web" }, "2026-10-03T10:00:00.000Z"));

    const view = await useCases.getPreferences();

    expect(view.repositories.map((one) => one.repo.repo)).toEqual(["web", "shop", "api", "zeta"]);
  });

  it("takes the base commit of a repository's latest analysis that has its pull request", async () => {
    const { useCases, store } = setup();
    const older: AnalysisKey = { ...smallFeatureAnalysis.key, headSha: "c".repeat(40) };
    await store.saveAnalysis({
      ...smallFeatureAnalysis,
      id: analysisId(older),
      key: older,
      pullRequest: null,
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
    expect((await useCases.getPreferences()).repositories).toEqual([
      {
        repo: shop,
        guidelineFiles: null,
        guidelineNote: "No pull request of this repository has been analyzed yet",
      },
    ]);

    await store.saveAnalysis({ ...smallFeatureAnalysis, updatedAt: "2026-10-21T10:00:00.000Z" });
    const [repository] = (await useCases.getPreferences()).repositories;
    expect(repository?.guidelineFiles?.map((file) => file.path)).toContain("REVIEW.md");
  });

  it("lists the preferences as made and only the proposals not decided yet", async () => {
    const { useCases, add, record, clock } = setup();
    const first = await add("Tenant isolation");
    clock.advance(1000);
    const second = await add("Retries", shop);
    await record(signal());
    const suggested = await useCases.suggestPreferences(shop);
    if (!suggested.ok) throw new Error(suggested.error.message);
    const [rejected, pending] = suggested.value.proposals;
    if (rejected === undefined) throw new Error("the fake suggests two");
    await useCases.decideProposal(rejected.id, { decision: "reject" });

    const view = await useCases.getPreferences();

    expect(view.preferences).toEqual([first, second]);
    expect(view.proposals).toEqual([pending]);
  });
});

describe("addPreference", () => {
  it("adds a written preference, enabled, stamped by the clock", async () => {
    const { useCases, preferences } = setup();

    const added = await useCases.addPreference({
      kind: "dont-flag",
      text: "  Naming of test helpers ",
      scope: { kind: "repo", repo: shop },
    });

    expect(added).toEqual(
      ok({
        id: expect.stringMatching(/^pref_[0-9a-f]{16}$/),
        kind: "dont-flag",
        text: "Naming of test helpers",
        scope: { kind: "repo", repo: shop },
        source: "written",
        enabled: true,
        createdAt: "2026-11-10T10:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z",
      }),
    );
    expect(await preferences.listPreferences()).toEqual([added.ok && added.value]);
  });

  it("adds a rule saved from a point as learned", async () => {
    const added = await setup().useCases.addPreference({
      kind: "dont-flag",
      text: "Naming",
      scope: { kind: "global" },
      source: "learned",
    });
    expect(added.ok && added.value.source).toBe("learned");
  });

  it("gives two preferences that say the same at the same time an id each", async () => {
    const { add } = setup();
    expect((await add("Naming")).id).not.toBe((await add("Naming")).id);
  });

  it("refuses an empty text and one over 300 characters", async () => {
    const { useCases, preferences } = setup();
    const scope = { kind: "global" } as const;

    expect(await useCases.addPreference({ kind: "look-for", text: "  ", scope })).toEqual(
      badRequest(/at most 300 characters/),
    );
    expect(
      await useCases.addPreference({ kind: "look-for", text: "x".repeat(301), scope }),
    ).toEqual(badRequest(/at most 300 characters/));
    expect(await preferences.listPreferences()).toEqual([]);
  });

  it("refuses the 51st enabled preference of a scope, and says so", async () => {
    const { useCases, add, preferences } = setup();
    for (let n = 0; n < MAX_ENABLED_PREFERENCES; n += 1) await add(`Rule ${n}`);

    expect(
      await useCases.addPreference({
        kind: "look-for",
        text: "One more",
        scope: { kind: "global" },
      }),
    ).toEqual(
      badRequest(
        "50 preferences are already enabled for every repository: switch one off or delete it first",
      ),
    );
    expect(await preferences.listPreferences()).toHaveLength(50);
    expect((await add("For one repository", shop)).scope).toEqual({ kind: "repo", repo: shop });
  });
});

describe("updatePreference", () => {
  it("changes what it's given and keeps the rest, stamping the change", async () => {
    const { useCases, add, clock } = setup();
    const made = await add("Tenant isolation");
    clock.advance(5000);

    const changed = await useCases.updatePreference(made.id, { kind: "dont-flag", text: "Naming" });
    expect(changed).toEqual(
      ok({ ...made, kind: "dont-flag", text: "Naming", updatedAt: "2026-11-10T10:00:05.000Z" }),
    );
    const moved = await useCases.updatePreference(made.id, {
      scope: { kind: "repo", repo: shop },
      enabled: false,
    });
    expect(moved).toMatchObject({
      ok: true,
      value: { text: "Naming", scope: { kind: "repo", repo: shop }, enabled: false },
    });
  });

  it("doesn't know a preference that isn't there", async () => {
    const missing = PreferenceId.parse("pref_00000000000000ff");
    expect(await setup().useCases.updatePreference(missing, { enabled: false })).toEqual(
      err({ code: "not-found", message: "No preference pref_00000000000000ff" }),
    );
  });

  it("refuses a text that isn't one", async () => {
    const { useCases, add } = setup();
    const made = await add("Tenant isolation");
    expect(await useCases.updatePreference(made.id, { text: "" })).toEqual(
      badRequest(/at most 300 characters/),
    );
  });

  it("refuses to enable or move one into a scope that has 50 enabled, and lets one of them change", async () => {
    const { useCases, add } = setup();
    const full = [];
    for (let n = 0; n < MAX_ENABLED_PREFERENCES; n += 1) full.push(await add(`Rule ${n}`));
    const [first] = full;
    if (first === undefined) throw new Error("added 50");
    const elsewhere = await add("For one repository", shop);
    const off = await useCases.updatePreference(first.id, { enabled: false });
    const another = await add("Rule 50");

    expect(await useCases.updatePreference(first.id, { enabled: true })).toEqual(
      badRequest(/already enabled for every repository/),
    );
    expect(await useCases.updatePreference(elsewhere.id, { scope: { kind: "global" } })).toEqual(
      badRequest(/already enabled for every repository/),
    );
    expect(off.ok && off.value.enabled).toBe(false);
    expect(await useCases.updatePreference(another.id, { text: "Reworded" })).toMatchObject({
      ok: true,
      value: { text: "Reworded", enabled: true },
    });
    expect(
      await useCases.updatePreference(first.id, {
        scope: { kind: "repo", repo: shop },
        enabled: true,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("deletePreference", () => {
  it("deletes a preference, once", async () => {
    const { useCases, add, preferences } = setup();
    const made = await add("Tenant isolation");

    expect(await useCases.deletePreference(made.id)).toEqual(ok(null));
    expect(await preferences.listPreferences()).toEqual([]);
    expect(await useCases.deletePreference(made.id)).toEqual(
      err({ code: "not-found", message: `No preference ${made.id}` }),
    );
  });
});

describe("suggestPreferences", () => {
  const comments = [
    pastComment(7, "Filter by tenant here."),
    pastComment(9, "This query isn't scoped to the tenant."),
  ];

  it("proposes the model's drafts as learned and pending, for the repository unless a draft says everywhere", async () => {
    const { useCases, suggester, history, preferences, add, record } = setup({ comments });
    const existing = await add("Retries");
    await record(signal(), signal({ kind: "raised", at: "2026-11-04T10:00:00.000Z" }));

    const suggested = await useCases.suggestPreferences(shop);

    expect(suggested).toEqual(
      ok({
        proposals: [
          {
            id: expect.stringMatching(/^prop_[0-9a-f]{16}$/),
            kind: "dont-flag",
            text: "Missing JSDoc on internal helpers",
            scope: { kind: "repo", repo: shop },
            source: "learned",
            evidence: ["Dismissed: Missing JSDoc on `parseConfig`, acme/shop #12"],
            status: "pending",
            createdAt: "2026-11-10T10:00:00.000Z",
          },
          {
            id: expect.stringMatching(/^prop_[0-9a-f]{16}$/),
            kind: "look-for",
            text: "Tenant isolation: every query filters by tenant ID",
            scope: { kind: "global" },
            source: "learned",
            evidence: [],
            status: "pending",
            createdAt: "2026-11-10T10:00:00.000Z",
          },
        ],
        signals: 2,
        comments: 2,
        pullRequests: 2,
      }),
    );
    expect(history.calls).toEqual([{ repo: shop, pullRequests: SUGGESTION_PULL_REQUESTS }]);
    expect(suggester.calls).toEqual([
      {
        signals: [signal({ kind: "raised", at: "2026-11-04T10:00:00.000Z" }), signal()],
        comments: [comments[1], comments[0]],
        preferences: [existing],
        rejected: [],
        repo: shop,
      },
    ]);
    expect(await preferences.listProposals()).toEqual(suggested.ok && suggested.value.proposals);
    expect(await preferences.listPreferences()).toEqual([existing]);
  });

  it("reads only the repository's signals, the 200 newest", async () => {
    const { useCases, suggester, record } = setup();
    const many = Array.from({ length: SUGGESTION_SIGNALS + 5 }, (_, n) =>
      signal({ at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), title: `Point ${n}` }),
    );
    await record(...many, signal({ pullRequest: { repo: api, number: 3 }, title: "Elsewhere" }));

    const suggested = await useCases.suggestPreferences(shop);

    expect(suggested.ok && suggested.value.signals).toBe(200);
    expect(suggester.calls[0]?.signals.map((one) => one.title)).toEqual(
      many
        .slice(5)
        .reverse()
        .map((one) => one.title),
    );
  });

  it("sends a comment posted from here once, as the host has it", async () => {
    const { useCases, suggester, record } = setup({ comments });
    const posted = signal({
      kind: "comment",
      pointKind: null,
      title: "",
      text: "Filter by tenant  here.",
      pullRequest: { repo: shop, number: 7 },
    });
    const older = signal({
      ...posted,
      text: "Name the unit.",
      pullRequest: { repo: shop, number: 2 },
    });
    await record(posted, older);

    const suggested = await useCases.suggestPreferences(shop);

    expect(suggested).toMatchObject({ ok: true, value: { signals: 1, comments: 2 } });
    expect(suggester.calls[0]?.signals).toEqual([older]);
  });

  it("reads the signals alone where the host has no past reviews to read", async () => {
    const { useCases, suggester, history, record } = setup({ comments, noHistory: true });
    await record(signal());

    expect(await useCases.suggestPreferences(shop)).toMatchObject({
      ok: true,
      value: { signals: 1, comments: 0, pullRequests: 0 },
    });
    expect(history.calls).toEqual([]);
    expect(suggester.calls).toHaveLength(1);
  });

  it("answers no proposals with nothing to read, without a model call", async () => {
    const { useCases, suggester, record } = setup({ comments });
    await record(signal());

    expect(await useCases.suggestPreferences(api)).toEqual(
      ok({ proposals: [], signals: 0, comments: 0, pullRequests: 0 }),
    );
    expect(suggester.calls).toEqual([]);
  });

  it("keeps 5 lines of evidence, without the blank ones", async () => {
    const evidence = ["  one ", "", "two", "three", "   ", "four", "five", "six"];
    const { useCases, record } = setup({ drafts: [{ ...tenant, evidence }] });
    await record(signal());

    const suggested = await useCases.suggestPreferences(shop);

    expect(suggested.ok && suggested.value.proposals[0]?.evidence).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
  });

  it("leaves out a blank draft and one that says what's already said or waiting", async () => {
    const drafts: ProposalDraft[] = [
      { ...tenant, text: "   " },
      { ...tenant, text: "retries" },
      jsdoc,
      { ...jsdoc, text: "missing JSDoc  on internal helpers", scope: "global" },
      tenant,
    ];
    const { useCases, add, record, logger, preferences } = setup({ drafts });
    await add("Retries");
    await record(signal());

    const first = await useCases.suggestPreferences(shop);
    const again = await useCases.suggestPreferences(shop);

    expect(first.ok && first.value.proposals.map((one) => one.text)).toEqual([
      "Missing JSDoc on internal helpers",
      "Tenant isolation: every query filters by tenant ID",
    ]);
    expect(again).toEqual(ok({ proposals: [], signals: 1, comments: 0, pullRequests: 0 }));
    expect(await preferences.listProposals()).toHaveLength(2);
    expect(
      logger.entries.filter((entry) => entry.message.startsWith("Left out")).map((e) => e.fields),
    ).toEqual([{ count: 3 }, { count: 5 }]);
  });

  it("never proposes again what the reviewer rejected, and tells the model what that was", async () => {
    const { useCases, suggester, record } = setup({ drafts: [jsdoc] });
    await record(signal());
    const first = await useCases.suggestPreferences(shop);
    const proposal = first.ok ? first.value.proposals[0] : undefined;
    if (proposal === undefined) throw new Error("the fake suggests one");
    await useCases.decideProposal(proposal.id, { decision: "reject" });

    expect(await useCases.suggestPreferences(shop)).toMatchObject({
      ok: true,
      value: { proposals: [] },
    });
    expect(suggester.calls[1]?.rejected).toEqual([{ ...proposal, status: "rejected" }]);
  });

  it("proposes again a rule the reviewer accepted and then deleted", async () => {
    const { useCases, record } = setup({ drafts: [tenant] });
    await record(signal());
    const first = await useCases.suggestPreferences(shop);
    const proposal = first.ok ? first.value.proposals[0] : undefined;
    if (proposal === undefined) throw new Error("the fake suggests one");
    const accepted = await useCases.decideProposal(proposal.id, { decision: "accept" });
    if (!accepted.ok || accepted.value.preference === null) throw new Error("accepted");
    expect(await useCases.suggestPreferences(shop)).toMatchObject({
      ok: true,
      value: { proposals: [] },
    });

    await useCases.deletePreference(accepted.value.preference.id);
    const again = await useCases.suggestPreferences(shop);

    expect(again.ok && again.value.proposals.map((one) => one.text)).toEqual([tenant.text]);
    expect(again.ok && again.value.proposals[0]?.id).not.toBe(proposal.id);
  });

  it("runs on the option asked for, and refuses one megareviewer doesn't know", async () => {
    const opus = fakeModelOption({ model: "claude-opus-5-5", modelName: "Opus 5.5" });
    const { useCases, record, suggester } = setup({ modelOptions: [fakeModelOption(), opus] });
    await record(signal());

    expect((await useCases.suggestPreferences(shop, opus.id)).ok).toBe(true);
    expect(suggester.calls).toHaveLength(1);
    expect(await useCases.suggestPreferences(shop, "claude-code/claude-unknown")).toEqual(
      badRequest("No model option claude-code/claude-unknown"),
    );
  });

  it("says why before reading anything when the option can't run, or can't make the call", async () => {
    const down = fakeModelOption({ available: false, reason: "Claude Code isn't signed in" });
    const signedOut = setup({ comments, modelOptions: [down] });
    await signedOut.record(signal());
    const cantSuggest = setup({ suggester: null });
    await cantSuggest.record(signal());

    expect(await signedOut.useCases.suggestPreferences(shop)).toEqual(
      err({
        code: "model-unavailable",
        message: "Sonnet 5.5 through Claude Code can't run: Claude Code isn't signed in",
      }),
    );
    expect(signedOut.suggester.calls).toEqual([]);
    expect(signedOut.history.calls).toEqual([]);
    expect(await cantSuggest.useCases.suggestPreferences(shop)).toEqual(
      err({
        code: "model-unavailable",
        message: "Sonnet 5.5 through Claude Code can't run: it can't run",
      }),
    );
  });

  it("fails as the host's error, and as the model's, proposing nothing", async () => {
    const { useCases, history, suggester, record, preferences } = setup({ comments });
    await record(signal());
    history.failWith(network);
    expect(await useCases.suggestPreferences(shop)).toEqual(
      err({ code: "host-error", message: "socket hang up" }),
    );
    expect(suggester.calls).toEqual([]);

    const fresh = setup({ comments });
    fresh.suggester.script(
      err({ kind: "overloaded", message: "The model is overloaded. Try again." }),
    );
    expect(await fresh.useCases.suggestPreferences(shop)).toEqual(
      err({ code: "model-error", message: "The model is overloaded. Try again." }),
    );
    expect(await preferences.listProposals()).toEqual([]);
    expect((await fresh.useCases.suggestPreferences(shop)).ok).toBe(true);
  });

  it("makes one read and one model call for two requests for a repository at once", async () => {
    const { useCases, history, suggester } = setup({ comments });

    const [first, second, other] = await Promise.all([
      useCases.suggestPreferences(shop),
      useCases.suggestPreferences(shop),
      useCases.suggestPreferences(api),
    ]);

    expect(second).toEqual(first);
    expect(other).toEqual(ok({ proposals: [], signals: 0, comments: 0, pullRequests: 0 }));
    expect(history.calls).toHaveLength(2);
    expect(suggester.calls).toHaveLength(1);
  });
});

describe("decideProposal", () => {
  const proposed = async (drafts: readonly ProposalDraft[] = [jsdoc]) => {
    const made = setup({ drafts });
    await made.record(signal());
    const suggested = await made.useCases.suggestPreferences(shop);
    const proposal = suggested.ok ? suggested.value.proposals[0] : undefined;
    if (proposal === undefined) throw new Error("the fake suggests one");
    made.clock.advance(60_000);
    return { ...made, proposal };
  };

  it("accepts a proposal as it reads: an enabled preference of the proposal's source", async () => {
    const { useCases, preferences, proposal } = await proposed();

    const decided = await useCases.decideProposal(proposal.id, { decision: "accept" });

    const preference = {
      id: expect.stringMatching(/^pref_[0-9a-f]{16}$/),
      kind: "dont-flag",
      text: "Missing JSDoc on internal helpers",
      scope: { kind: "repo", repo: shop },
      source: "learned",
      enabled: true,
      createdAt: "2026-11-10T10:01:00.000Z",
      updatedAt: "2026-11-10T10:01:00.000Z",
    };
    expect(decided).toEqual(ok({ preference }));
    expect(await preferences.listPreferences()).toEqual([preference]);
    expect(await preferences.listProposals()).toEqual([{ ...proposal, status: "accepted" }]);
  });

  it("accepts a proposal with what the reviewer changed in it", async () => {
    const { useCases, proposal } = await proposed();

    const decided = await useCases.decideProposal(proposal.id, {
      decision: "accept",
      kind: "look-for",
      text: "JSDoc on exported functions",
      scope: { kind: "global" },
    });

    expect(decided).toMatchObject({
      ok: true,
      value: {
        preference: {
          kind: "look-for",
          text: "JSDoc on exported functions",
          scope: { kind: "global" },
          source: "learned",
        },
      },
    });
  });

  it("rejects a proposal: no preference, and it's no longer waiting", async () => {
    const { useCases, preferences, proposal } = await proposed();

    expect(await useCases.decideProposal(proposal.id, { decision: "reject" })).toEqual(
      ok({ preference: null }),
    );
    expect(await preferences.listPreferences()).toEqual([]);
    expect(await preferences.listProposals()).toEqual([{ ...proposal, status: "rejected" }]);
    expect((await useCases.getPreferences()).proposals).toEqual([]);
  });

  it("decides a proposal once", async () => {
    const { useCases, proposal } = await proposed();
    await useCases.decideProposal(proposal.id, { decision: "accept" });

    expect(await useCases.decideProposal(proposal.id, { decision: "reject" })).toEqual(
      badRequest("The proposal is already accepted"),
    );
    expect(
      await useCases.decideProposal(ProposalId.parse("prop_00000000000000ff"), {
        decision: "accept",
      }),
    ).toEqual(err({ code: "not-found", message: "No proposal prop_00000000000000ff" }));
  });

  it("leaves a proposal waiting when it's too long to accept as it reads", async () => {
    const { useCases, preferences, proposal } = await proposed([
      { ...tenant, text: "x".repeat(320) },
    ]);

    expect(await useCases.decideProposal(proposal.id, { decision: "accept" })).toEqual(
      badRequest(/at most 300 characters/),
    );
    expect(await preferences.listProposals()).toEqual([proposal]);
    expect(
      await useCases.decideProposal(proposal.id, { decision: "accept", text: "Shorter" }),
    ).toMatchObject({ ok: true, value: { preference: { text: "Shorter" } } });
  });

  it("leaves a proposal waiting when its scope already has 50 enabled", async () => {
    const { useCases, add, preferences, proposal } = await proposed([tenant]);
    for (let n = 0; n < MAX_ENABLED_PREFERENCES; n += 1) await add(`Rule ${n}`);

    expect(await useCases.decideProposal(proposal.id, { decision: "accept" })).toEqual(
      badRequest(/already enabled for every repository/),
    );
    expect(await preferences.listProposals()).toEqual([proposal]);
    expect(
      await useCases.decideProposal(proposal.id, {
        decision: "accept",
        scope: { kind: "repo", repo: shop },
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("setGuidelineSwitch", () => {
  it("switches a guideline file on or off for a repository", async () => {
    const { useCases, preferences, store } = setup();
    await store.saveAnalysis(smallFeatureAnalysis);

    expect(await useCases.setGuidelineSwitch(shop, "REVIEW.md", false)).toEqual(ok(null));
    expect(await useCases.setGuidelineSwitch(shop, "CLAUDE.md", true)).toEqual(ok(null));

    expect(await preferences.getGuidelineSwitches(shop)).toEqual(
      new Map([
        ["REVIEW.md", false],
        ["CLAUDE.md", true],
      ]),
    );
    const [repository] = (await useCases.getPreferences()).repositories;
    expect(repository?.guidelineFiles?.map((file) => [file.path, file.enabled])).toEqual([
      ["REVIEW.md", false],
      ["CLAUDE.md", true],
      [".github/copilot-instructions.md", false],
    ]);
  });

  it("refuses a path megareviewer doesn't read", async () => {
    const { useCases, preferences } = setup();

    expect(await useCases.setGuidelineSwitch(shop, "docs/STYLE.md", true)).toEqual(
      badRequest(/^docs\/STYLE\.md isn't a guideline file megareviewer reads: REVIEW\.md, /),
    );
    expect(await preferences.getGuidelineSwitches(shop)).toEqual(new Map());
  });
});
