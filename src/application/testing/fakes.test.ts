import { describe, expect, it } from "vitest";
import {
  type CommentKey,
  type HostError,
  type PastComment,
  type Publication,
  type PullRequestRef,
  type RepoRef,
  validateRiskCoverage,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import type { AnalysisInput, ProposalDraft, SuggestionInput } from "../ports/index.ts";
import {
  allFixtures,
  bitbucketBugfix,
  CHECKOUT_CONTRACT_FILES,
  describeAnalysisModelContract,
  describeAnalysisStoreContract,
  describeFileCacheContract,
  describeGitHostContract,
  describeHarnessSourceContract,
  describeHarnessStoreContract,
  describeLocalCheckoutContract,
  describePreferenceStoreContract,
  describeReviewHistoryContract,
  describeTicketSourceContract,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeHarnessSource,
  FakeLocalCheckout,
  FakeModelCatalog,
  FakePreferenceSuggester,
  FakeReviewHistory,
  FakeTicketSource,
  FixedClock,
  fakeModelOption,
  gitBlobHash,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  InMemoryHarnessStore,
  InMemoryPreferenceStore,
  RecordingLogger,
  smallFeature,
  smallFeatureInput,
  smallFeaturePublication,
} from "./index.ts";

const unauthorized: HostError = {
  kind: "unauthorized",
  message: "Bad credentials",
  retryAfterSeconds: null,
};
const rateLimited: HostError = {
  kind: "rate-limited",
  message: "API rate limit exceeded",
  retryAfterSeconds: 60,
};
const network: HostError = { kind: "network", message: "socket hang up", retryAfterSeconds: null };

/** `merged` is the contract's existing PR, merged as the recorded ones are. */
const scenarioHost =
  (host: "github" | "bitbucket", merged: PullRequestRef) => (scenario: string) => {
    const fake = new FakeGitHost({ host, fixtures: allFixtures });
    fake.close(merged);
    if (scenario === "unauthorized") fake.failAlways(unauthorized);
    if (scenario === "rate-limited") fake.failAlways(rateLimited);
    return fake;
  };

describeGitHostContract("fake github", () => {
  const { ref, headSha, baseSha } = smallFeature.pullRequest;
  return {
    host: scenarioHost("github", ref),
    existingPr: ref,
    missingPr: { ...ref, number: 999 },
    existingFile: { repo: ref.repo, sha: headSha, path: "src/services/receipts.ts" },
    missingFile: { repo: ref.repo, sha: baseSha, path: "src/services/receipts.ts" },
    publishablePr: { ref, headSha },
    publication: smallFeaturePublication,
  };
});

describeGitHostContract("fake bitbucket", () => {
  const { ref, headSha, baseSha } = bitbucketBugfix.pullRequest;
  return {
    host: scenarioHost("bitbucket", ref),
    existingPr: ref,
    missingPr: { ...ref, number: 999 },
    existingFile: { repo: ref.repo, sha: baseSha, path: "src/refunds.ts" },
    missingFile: { repo: ref.repo, sha: baseSha, path: "src/refunds.test.ts" },
    publishablePr: { ref, headSha },
    publication: { verdict: "approve", summary: "Looks good.", comments: [] },
  };
});

describeTicketSourceContract("fake", {
  configured: {
    source: (scenario) => {
      const source = new FakeTicketSource({ tickets: allFixtures.flatMap((f) => f.tickets) });
      if (scenario === "unauthorized") {
        source.failNext({ kind: "unauthorized", message: "401 Unauthorized" });
      }
      return source;
    },
    existingKeys: ["SHOP-123", "PAY-42"],
    missingKeys: ["NOPE-1"],
  },
  unconfigured: () => new FakeTicketSource({ configured: false }),
});

describeAnalysisStoreContract("in-memory", (clock) => new InMemoryAnalysisStore(clock));
describeFileCacheContract("in-memory", () => new InMemoryFileCache());
describePreferenceStoreContract("in-memory", () => new InMemoryPreferenceStore());
describeHarnessStoreContract("in-memory", (clock) => new InMemoryHarnessStore(clock));

const harnessRepo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const harnessFiles = [
  {
    path: "CLAUDE.md",
    content: "# Shop\n\n@docs/house-rules.md\n",
    blob: "5b9e1baac9f3f69a1a4b342b7902abe1f5b8d66f",
  },
  {
    path: "docs/house-rules.md",
    content: "Naïve ✓\n",
    blob: "40d9d769df381aca782cede3eb091065ae255470",
  },
];

describe.each([
  { lists: true, diffs: true },
  { lists: true, diffs: false },
  { lists: false, diffs: true },
  { lists: false, diffs: false },
])("a fake harness source that lists: $lists, and diffs: $diffs", ({ lists, diffs }) => {
  const sha = "a".repeat(40);
  const toSha = "b".repeat(40);
  describeHarnessSourceContract("fake", () => ({
    source: (scenario) => {
      const source = new FakeHarnessSource({ lists, diffs });
      source.setFiles(harnessRepo, sha, {
        ...Object.fromEntries(harnessFiles.map(({ path, content }) => [path, content])),
        "docs/logo.txt": { kind: "skipped", reason: "unreadable" },
        "docs/old.md": "Moved\n",
      });
      source.setFiles(harnessRepo, toSha, {
        ...Object.fromEntries(harnessFiles.map(({ path, content }) => [path, content])),
        "docs/logo.txt": { kind: "skipped", reason: "unreadable" },
        "docs/new.md": "Moved\n",
        "AGENTS.md": "# Added\n",
      });
      if (scenario === "unauthorized") source.failAlways(unauthorized);
      return source;
    },
    lists,
    diffs,
    repo: harnessRepo,
    sha,
    files: harnessFiles,
    directory: "docs",
    missingPath: "AGENTS.md",
    skipped: { path: "docs/logo.txt", reason: "unreadable" },
    change: diffs
      ? { fromSha: sha, toSha, paths: ["AGENTS.md", "docs/new.md", "docs/old.md"] }
      : null,
  }));
});

describe("the fake harness source", () => {
  it("hashes as git does, an empty file too", async () => {
    expect(await gitBlobHash("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("counts what it's asked, fails as scripted, and waits while held", async () => {
    const source = new FakeHarnessSource();
    source.failNext("listFiles", network);
    expect(await source.listFiles(harnessRepo, "sha")).toEqual(err(network));
    expect(await source.listFiles(harnessRepo, "sha")).toEqual(ok(new Map()));

    const release = source.hold();
    let read = false;
    const reading = source.readFiles(harnessRepo, "sha", ["a.md"]).then(() => {
      read = true;
    });
    await Promise.resolve();
    expect(read).toBe(false);
    release();
    await reading;

    expect(source.calls).toEqual({
      listFiles: ["sha", "sha"],
      readFiles: [["a.md"]],
      changedPaths: [],
    });
  });
});

const reviewedRepo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const pastComment = (number: number, at: string, body: string): PastComment => ({
  pullRequest: { repo: reviewedRepo, number },
  path: "src/orders.ts",
  body,
  at,
});
const pastComments = [
  pastComment(7, "2026-10-01T10:00:00.000Z", "Filter by tenant here."),
  pastComment(9, "2026-10-03T10:00:00.000Z", "This query isn't scoped to the tenant."),
  pastComment(9, "2026-10-02T10:00:00.000Z", "Say the charset."),
];

describeReviewHistoryContract("fake", () => ({
  history: () => new FakeReviewHistory({ host: "github", comments: pastComments }),
  repo: reviewedRepo,
  unreviewedRepo: { ...reviewedRepo, repo: "api" },
}));

describeLocalCheckoutContract("fake", async () => {
  const sha = "c".repeat(40);
  return { checkout: new FakeLocalCheckout({ [sha]: CHECKOUT_CONTRACT_FILES }), sha };
});

describeAnalysisModelContract("fake", () => new FakeAnalysisModel());

describe("FakeGitHost", () => {
  const { ref } = smallFeature.pullRequest;
  const publishOptions = (alreadyPosted: CommentKey[] = []) => {
    const posted: CommentKey[] = [];
    return {
      posted,
      options: {
        headSha: smallFeature.pullRequest.headSha,
        alreadyPosted: new Set(alreadyPosted),
        onPosted: async (key: CommentKey) => {
          posted.push(key);
        },
      },
    };
  };

  it("only serves fixtures for its own host", async () => {
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures });
    const result = await host.getPullRequest(bitbucketBugfix.pullRequest.ref);
    expect(!result.ok && result.error.kind).toBe("not-found");
  });

  it("fails the next call to one method, once, in order", async () => {
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures });
    host.failNext("getPullRequest", network);
    host.failNext("getPullRequest", rateLimited);

    expect(await host.getPullRequest(ref)).toEqual(err(network));
    expect((await host.currentUser()).ok).toBe(true);
    expect(await host.getPullRequest(ref)).toEqual(err(rateLimited));
    expect((await host.getPullRequest(ref)).ok).toBe(true);
  });

  it("stops failing every call when failAlways is cleared", async () => {
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures });
    host.failAlways(unauthorized);
    expect(await host.listPullRequests()).toEqual(err(unauthorized));
    host.failAlways(null);
    expect((await host.listPullRequests()).ok).toBe(true);
  });

  it("fails a publish part way, and a retry posts only the rest", async () => {
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures });
    host.failPublishAtPost(2, network);

    const first = publishOptions();
    expect(await host.publish(ref, smallFeaturePublication, first.options)).toEqual(err(network));
    expect(first.posted).toEqual(["summary"]);

    const retry = publishOptions(first.posted);
    const result = await host.publish(ref, smallFeaturePublication, retry.options);
    expect(result.ok).toBe(true);
    expect(retry.posted).toEqual(["decision:d3"]);
    expect(host.publishAttempts.map((attempt) => [attempt.outcome, attempt.postedKeys])).toEqual([
      ["failed", ["summary"]],
      ["published", ["decision:d3"]],
    ]);
  });

  it("stamps receipts with its clock", async () => {
    const clock = new FixedClock("2026-10-21T10:00:00Z");
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures, clock });
    const result = await host.publish(ref, smallFeaturePublication, publishOptions().options);
    expect(result.ok && result.value.publishedAt).toBe("2026-10-21T10:00:00.000Z");
  });

  it("returns not-found when publishing to an unknown PR", async () => {
    const host = new FakeGitHost({ host: "github" });
    const publication: Publication = { verdict: "comment", summary: "", comments: [] };
    const result = await host.publish(ref, publication, publishOptions().options);
    expect(!result.ok && result.error.kind).toBe("not-found");
  });

  it("moves a PR to a new head SHA, keeping its head files", async () => {
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures });
    const newSha = "f".repeat(40);
    host.setHeadSha(ref, newSha);

    const result = await host.getPullRequest(ref);
    expect(result.ok && result.value.headSha).toBe(newSha);
    expect(
      await host.getFiles(ref.repo, [{ sha: newSha, path: "src/services/receipts.ts" }]),
    ).toEqual(ok([smallFeature.headFiles["src/services/receipts.ts"]]));
    expect(() => host.setHeadSha({ ...ref, number: 999 }, newSha)).toThrow();
  });

  it("returns not-found for an unknown commit", async () => {
    const host = new FakeGitHost({ host: "github", fixtures: allFixtures });
    const result = await host.getFiles(ref.repo, [{ sha: "0".repeat(40), path: "README.md" }]);
    expect(!result.ok && result.error.kind).toBe("not-found");
  });

  it("lists PRs by the current user as authored", async () => {
    const host = new FakeGitHost({
      host: "github",
      user: smallFeature.pullRequest.author,
      fixtures: allFixtures,
    });
    const result = await host.listPullRequests();
    const roles = result.ok
      ? result.value.map((summary) => [summary.ref.number, summary.role])
      : [];
    expect(roles).toEqual([
      [101, "author"],
      [102, "author"],
      [103, "reviewer"],
    ]);
  });
});

describe("FakeTicketSource", () => {
  it("records calls and answers each requested key once", async () => {
    const source = new FakeTicketSource({ tickets: smallFeature.tickets });
    const result = await source.getTickets(["SHOP-123", "SHOP-123", "SHOP-9"]);

    expect(result.ok && result.value.found.map((ticket) => ticket.key)).toEqual(["SHOP-123"]);
    expect(result.ok && result.value.missing).toEqual(["SHOP-9"]);
    expect(source.calls).toEqual([["SHOP-123", "SHOP-123", "SHOP-9"]]);
  });
});

describe("FakeAnalysisModel", () => {
  const required = new Set(smallFeatureInput.files.flatMap((f) => f.hunks.map((h) => h.id)));

  it("derives outputs that pass validation", async () => {
    const model = new FakeAnalysisModel();
    const risk = await model.risk(smallFeatureInput);
    const decisions = await model.decisions(smallFeatureInput);

    expect(risk.ok && validateRiskCoverage(risk.value.value, required)).toEqual([]);
    expect(decisions.ok && decisions.value.value.map((d) => d.title)).toEqual([
      "Changes config/app.yaml",
      "Changes src/routes/orders.ts",
      "Changes src/services/receipts.ts",
    ]);
  });

  it("has no stated intent without a description or tickets", async () => {
    const input: AnalysisInput = {
      ...smallFeatureInput,
      pullRequest: { ...smallFeatureInput.pullRequest, description: "  " },
      tickets: [],
    };
    const result = await new FakeAnalysisModel().intent(input);
    expect(result.ok && result.value.value.stated).toBeNull();
  });

  it("answers from the script first, in order, then derives", async () => {
    const model = new FakeAnalysisModel();
    const overloaded = { kind: "overloaded" as const, message: "529" };
    model.script("risk", err(overloaded), ok([]));

    expect(await model.risk(smallFeatureInput)).toEqual(err(overloaded));
    const scripted = await model.risk(smallFeatureInput, { feedback: ["missing h_1"] });
    expect(scripted.ok && scripted.value.value).toEqual([]);
    const derived = await model.risk(smallFeatureInput);
    expect(derived.ok && derived.value.value).toHaveLength(required.size);

    expect(model.callsTo("risk").map((call) => call.options)).toEqual([
      undefined,
      { feedback: ["missing h_1"] },
      undefined,
    ]);
  });

  it("fails checkSize over its token limit", async () => {
    const model = new FakeAnalysisModel({ maxInputTokens: 10 });
    const result = await model.checkSize(smallFeatureInput);
    expect(!result.ok && result.error.kind).toBe("too-large");
  });
});

describe("FakeCodeParser", () => {
  const parser = new FakeCodeParser();

  it("knows a few languages by extension", () => {
    expect(parser.languageFor("src/a.TS")).toBe("typescript");
    expect(parser.languageFor("README")).toBeNull();
    expect(parser.languageFor("config/app.yaml")).toBeNull();
  });

  it("gives equal syntax nodes for a reformat and different ones for a change", async () => {
    const nodes = async (source: string) => {
      const result = await parser.syntaxNodes(source, "typescript");
      return result.ok ? result.value : [];
    };
    const original = await nodes("const a = { b: 1, c: 'x y' };");
    expect(await nodes("const a = {\n  b: 1,\n  c: 'x y'\n};")).toEqual(original);
    expect(await nodes("const a = { b: 2, c: 'x y' };")).not.toEqual(original);
    expect(await nodes("const a = { b: 1, c: 'x  y' };")).not.toEqual(original);
  });

  it("finds top-level definitions and references", async () => {
    const result = await parser.symbols(
      "import { b } from './b';\n\nexport function a() {\n  return b();\n}\nconst c = a;\n",
      "typescript",
    );
    expect(result.ok && result.value.definitions).toEqual([
      { name: "a", kind: "function", startLine: 3, endLine: 5 },
      { name: "c", kind: "variable", startLine: 6, endLine: 7 },
    ]);
    const references = (result.ok ? result.value.references : []).map(({ name, line, kind }) => ({
      name,
      line,
      kind,
    }));
    expect(result.ok && result.value.references).toContainEqual({
      name: "b",
      line: 4,
      kind: "name",
      columns: [9],
    });
    expect(references).toContainEqual({ name: "a", line: 6, kind: "name" });
    expect(references).not.toContainEqual({ name: "a", line: 3, kind: "name" });
    expect(references).not.toContainEqual({ name: "b", line: 1, kind: "name" });
    expect(result.ok && result.value.imports).toEqual([{ module: "./b", names: ["b"] }]);
  });

  it("reads default and Python imports", async () => {
    const imports = async (source: string, language: string) => {
      const result = await parser.symbols(source, language);
      return result.ok ? result.value.imports : [];
    };
    expect(await imports("import a from './a';\n", "typescript")).toEqual([
      { module: "./a", names: null },
    ]);
    expect(await imports("from .models import A, B as C\nfrom x import *\n", "python")).toEqual([
      { module: ".models", names: ["A", "B"] },
      { module: "x", names: null },
    ]);
  });

  it("fails for unknown languages and when scripted", async () => {
    const failing = new FakeCodeParser();
    expect(await failing.symbols("x", "cobol")).toEqual(
      err({ kind: "unsupported-language", message: "cobol isn't supported" }),
    );
    failing.failAlways("syntaxNodes");
    expect((await failing.syntaxNodes("x", "python")).ok).toBe(false);
    expect((await failing.symbols("x", "python")).ok).toBe(true);
    failing.failAlways("syntaxNodes", false);
    expect((await failing.syntaxNodes("x", "python")).ok).toBe(true);
    expect(failing.calls.map((call) => call.method)).toEqual([
      "symbols",
      "syntaxNodes",
      "symbols",
      "syntaxNodes",
    ]);
  });
});

describe("FakeReviewHistory", () => {
  it("fails the next read as told, then reads again", async () => {
    const history = new FakeReviewHistory({ host: "github", comments: pastComments });
    history.failWith(network);

    expect(await history.getReviewerComments(reviewedRepo, { pullRequests: 30 })).toEqual(
      err(network),
    );
    const read = await history.getReviewerComments(reviewedRepo, { pullRequests: 30 });
    expect(read.ok && read.value.comments.length).toBe(3);
    expect(history.calls).toEqual([
      { repo: reviewedRepo, pullRequests: 30 },
      { repo: reviewedRepo, pullRequests: 30 },
    ]);
  });
});

describe("FakePreferenceSuggester", () => {
  const input: SuggestionInput = {
    signals: [],
    comments: pastComments,
    preferences: [],
    rejected: [],
    repo: reviewedRepo,
  };
  const draft: ProposalDraft = {
    kind: "look-for",
    text: "Tenant isolation",
    scope: "repo",
    evidence: ["Filter by tenant here."],
  };

  it("answers its scripts in order, then its drafts, keeping what it was asked", async () => {
    const suggester = new FakePreferenceSuggester({ drafts: [draft] });
    const overloaded = { kind: "overloaded" as const, message: "Try again." };
    suggester.script(err(overloaded), ok([]));

    expect(await suggester.suggest(input)).toEqual(err(overloaded));
    expect(await suggester.suggest(input)).toMatchObject({ ok: true, value: { value: [] } });
    const third = await suggester.suggest(input);
    expect(third).toMatchObject({ ok: true, value: { value: [draft] } });
    expect(third.ok && third.value.usage.outputTokens).toBeGreaterThan(0);
    expect(suggester.calls).toEqual([input, input, input]);
  });

  it("answers no drafts unless given some", async () => {
    expect(await new FakePreferenceSuggester().suggest(input)).toMatchObject({
      ok: true,
      value: { value: [] },
    });
  });
});

describe("FakeModelCatalog", () => {
  const down = fakeModelOption({ model: "claude-opus-5-5", available: false, reason: "No plan" });

  it("serves the passes and the suggester for an option that can run, and neither for one that can't", () => {
    const suggester = new FakePreferenceSuggester();
    const catalog = new FakeModelCatalog({ suggester, options: [fakeModelOption(), down] });

    expect(catalog.suggester(fakeModelOption().id)).toBe(suggester);
    expect(catalog.model(fakeModelOption().id)).not.toBeNull();
    expect(catalog.suggester(down.id)).toBeNull();
    expect(catalog.model(down.id)).toBeNull();
  });

  it("has a suggester of its own unless told the provider can't suggest", () => {
    expect(new FakeModelCatalog().suggester(fakeModelOption().id)).not.toBeNull();
    expect(new FakeModelCatalog({ suggester: null }).suggester(fakeModelOption().id)).toBeNull();
  });
});

describe("FixedClock", () => {
  it("returns the set time and advances", () => {
    const clock = new FixedClock("2026-10-21T10:00:00Z");
    expect(clock.now()).toBe("2026-10-21T10:00:00.000Z");
    clock.advance(1500);
    expect(clock.now()).toBe("2026-10-21T10:00:01.500Z");
  });
});

describe("RecordingLogger", () => {
  it("keeps every entry", () => {
    const logger = new RecordingLogger();
    logger.debug("a");
    logger.info("b", { n: 1 });
    logger.warn("c");
    logger.error("d");
    expect(logger.entries.map((entry) => [entry.level, entry.message, entry.fields])).toEqual([
      ["debug", "a", undefined],
      ["info", "b", { n: 1 }],
      ["warn", "c", undefined],
      ["error", "d", undefined],
    ]);
  });
});
