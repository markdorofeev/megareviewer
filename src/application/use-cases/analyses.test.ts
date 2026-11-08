import { describe, expect, it } from "vitest";
import { HunkId, type PartId, parseUnifiedDiff } from "../../domain/diff/index.ts";
import {
  type Analysis,
  AnalysisId,
  type HostError,
  type ModelError,
  type StageName,
  type StageStatus,
  validateRiskCoverage,
  validateTour,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { type AnalysisEvent, createAnalysisEvents } from "../events/index.ts";
import type { AnalysisInput, CodeParser } from "../ports/index.ts";
import {
  allFixtures,
  bitbucketBugfix,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckout,
  FakeLocalCheckouts,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  type PullRequestFixture,
  promptInjection,
  RecordingLogger,
  refactorMove,
  smallFeature,
  smallFeatureFiles,
} from "../testing/index.ts";
import { createUseCases } from "./index.ts";

class RecordingStore extends InMemoryAnalysisStore {
  readonly saves: Analysis[] = [];

  override async saveAnalysis(analysis: Analysis): Promise<void> {
    this.saves.push(analysis);
    await super.saveAnalysis(analysis);
  }
}

interface Emitted {
  readonly id: AnalysisId;
  readonly event: AnalysisEvent;
  /** The stages of the last saved analysis when the event was emitted. */
  readonly savedStages: Readonly<Record<StageName, StageStatus>> | undefined;
}

const setup = (
  options: {
    model?: FakeAnalysisModel;
    tickets?: FakeTicketSource;
    parser?: CodeParser;
    onlyGithub?: boolean;
    fileCache?: InMemoryFileCache;
    modelEnabled?: boolean;
    checkouts?: FakeLocalCheckouts;
  } = {},
) => {
  const clock = new FixedClock("2026-10-21T09:00:00Z");
  const github = new FakeGitHost({ host: "github", fixtures: allFixtures, clock });
  const bitbucket = new FakeGitHost({ host: "bitbucket", fixtures: allFixtures, clock });
  const tickets =
    options.tickets ??
    new FakeTicketSource({ tickets: allFixtures.flatMap((fixture) => fixture.tickets) });
  const model = options.model ?? new FakeAnalysisModel();
  const store = new RecordingStore();
  const fileCache = options.fileCache ?? new InMemoryFileCache();
  const parser = options.parser ?? new FakeCodeParser();
  const logger = new RecordingLogger();

  const emitted: Emitted[] = [];
  const waiting: { id: AnalysisId; count: number; resolve: () => void }[] = [];
  const doneCount = (id: AnalysisId) =>
    emitted.filter((entry) => entry.id === id && entry.event.type === "done").length;
  const inner = createAnalysisEvents();
  const events = {
    emit(id: AnalysisId, event: AnalysisEvent) {
      emitted.push({ id, event, savedStages: store.saves.at(-1)?.stages });
      inner.emit(id, event);
      for (const wait of waiting.filter((entry) => doneCount(entry.id) >= entry.count)) {
        wait.resolve();
      }
    },
    subscribe: inner.subscribe,
  };

  const useCases = createUseCases(
    {
      hosts: options.onlyGithub ? { github } : { github, bitbucket },
      tickets,
      model,
      modelEnabled: options.modelEnabled ?? true,
      store,
      fileCache,
      checkouts: options.checkouts ?? new FakeLocalCheckouts(),
      parser,
      events,
      clock,
      logger,
    },
    { version: "1.2.3" },
  );

  /** Resolves once the analysis has emitted `done` `count` times since setup. */
  const done = (id: AnalysisId, count = 1) =>
    new Promise<void>((resolve) => {
      if (doneCount(id) >= count) resolve();
      else waiting.push({ id, count, resolve });
    });

  const stored = async (id: AnalysisId): Promise<Analysis> => {
    const analysis = await store.getAnalysis(id);
    if (analysis === null) throw new Error(`no analysis ${id}`);
    return analysis;
  };

  const analyze = async (fixture: PullRequestFixture = smallFeature, count = 1) => {
    const started = await useCases.startAnalysis(fixture.pullRequest.url);
    if (!started.ok) throw new Error(started.error.message);
    await done(started.value.analysisId, count);
    return stored(started.value.analysisId);
  };

  return {
    clock,
    github,
    bitbucket,
    tickets,
    model,
    store,
    fileCache,
    logger,
    emitted,
    useCases,
    done,
    stored,
    analyze,
  };
};

const allHunkIds = (analysis: Analysis): Set<HunkId> =>
  new Set(analysis.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)));

const requiredHunkIds = (analysis: Analysis): Set<HunkId> => {
  const proved = new Set(analysis.proofs.map((proof) => proof.hunkId));
  return new Set([...allHunkIds(analysis)].filter((id) => !proved.has(id)));
};

const firstInput = (model: FakeAnalysisModel, pass: "intent" | "checkSize"): AnalysisInput => {
  const call = model.callsTo(pass)[0];
  if (call === undefined) throw new Error(`no ${pass} call`);
  return call.input;
};

const smallFeatureHunks = smallFeatureFiles.flatMap((file) => file.hunks.map((hunk) => hunk.id));
const [h1, h2, h3] = smallFeatureHunks;
if (h1 === undefined || h2 === undefined || h3 === undefined) {
  throw new Error("small-feature has six hunks");
}
/** small-feature's first three hunks are in config/app.yaml, which a contract rule matches. */
const configRule = (hunkId: HunkId) => ({
  hunkId,
  riskClass: "contract" as const,
  reason: "changes app config (app.yaml)",
  source: "rule" as const,
});
const configHunks = new Set(smallFeatureFiles[0]?.hunks.map((hunk) => hunk.id));
/** Well-formed, but not a hunk of any fixture. */
const unknownHunk = HunkId.parse("h_ffffffffffffffff");
const logic = (hunkId: HunkId) => ({ hunkId, riskClass: "logic" as const, reason: "Logic" });

const modelError = (kind: ModelError["kind"], message = `${kind} happened`): ModelError => ({
  kind,
  message,
});
const hostError = (kind: HostError["kind"]): HostError => ({
  kind,
  message: `${kind} from host`,
  retryAfterSeconds: null,
});

describe("the analysis pipeline", () => {
  it("analyzes the small-feature PR end to end", async () => {
    const { analyze, emitted, store } = setup();
    const analysis = await analyze();

    expect(analysis.status).toBe("complete");
    expect(analysis.error).toBeNull();
    expect(Object.values(analysis.stages)).toEqual(Array(6).fill("done"));
    expect(analysis.key.pipelineVersion).toBe("10+fake-model/1");
    expect(analysis.files.map((file) => ({ ...file, language: null }))).toEqual(
      smallFeatureFiles.map((file) => ({ ...file, language: null })),
    );
    expect(analysis.files.map((file) => file.language)).toEqual([null, "typescript", "typescript"]);
    expect(analysis.tickets).toEqual(smallFeature.tickets);
    expect(analysis.missingTicketKeys).toEqual([]);
    expect(analysis.proofs).toEqual([]);
    expect(analysis.callGraph.map((hint) => hint.symbol)).toContain("renderReceipt");
    expect(analysis.fileLinks).toEqual([
      { from: "src/routes/orders.ts", to: "src/services/receipts.ts" },
    ]);
    expect(analysis.generated).toEqual([]);
    expect(analysis.intent?.inferred.summary).toBe("Changes 3 file(s).");
    expect(analysis.risk).toEqual(
      smallFeatureHunks.map((hunkId) =>
        configHunks.has(hunkId)
          ? configRule(hunkId)
          : { hunkId, riskClass: "logic", reason: "Ordinary code change", source: "model" },
      ),
    );
    expect(analysis.decisions.map((decision) => decision.id)).toEqual(["d1", "d2", "d3"]);
    expect(analysis.tour?.steps.map((step) => step.id)).toEqual(["s1", "s2", "s3"]);
    expect(analysis.tour?.builtBy).toBe("model");
    expect(analysis.warnings).toEqual([]);
    expect(analysis.filesFetched).toEqual({ done: 6, total: 6 });
    expect(analysis.usage.map((usage) => usage.pass)).toEqual([
      "intent",
      "risk",
      "decisions",
      "tour",
    ]);

    const updates = emitted.flatMap(({ event }) =>
      event.type === "updated" ? [`${event.stage}:${event.status}`] : [event.type],
    );
    expect(updates).toEqual([
      "collect:running",
      // Files fetched: none cached, then the one batch.
      "collect:running",
      "collect:running",
      "collect:done",
      "prep:running",
      "prep:done",
      "intent:running",
      "intent:done",
      "risk:running",
      "decisions:running",
      "risk:done",
      "decisions:done",
      "tour:running",
      "tour:done",
      "done",
    ]);
    for (const { event, savedStages } of emitted) {
      if (event.type === "updated") expect(savedStages?.[event.stage]).toBe(event.status);
    }
    expect(store.saves.at(-1)).toEqual(analysis);
    expect(store.saves[0]?.status).toBe("running");
  });

  it("sends the model hunks in full with the head content of their files", async () => {
    const { analyze, model } = setup();
    await analyze();
    const input = firstInput(model, "intent");
    expect(input.pullRequest.title).toBe(smallFeature.pullRequest.title);
    expect(input.tickets).toEqual(smallFeature.tickets);
    expect(input.files.map((file) => [file.path, file.mechanical, file.headContent])).toEqual(
      smallFeatureFiles.map((file) => [file.path, false, smallFeature.headFiles[file.path]]),
    );
    expect(input.files.map((file) => file.hunks)).toEqual(smallFeatureFiles.map((f) => f.hunks));
  });

  it.each(allFixtures)("covers every hunk of $name exactly once", async (fixture) => {
    const { analyze } = setup();
    const analysis = await analyze(fixture);
    expect(analysis.status).toBe("complete");
    expect(validateRiskCoverage(analysis.risk, allHunkIds(analysis))).toEqual([]);
    expect(validateTour(analysis.tour ?? { steps: [] }, requiredHunkIds(analysis))).toEqual([]);
  });

  it("proves every refactor-move hunk and still runs the passes with nothing to cover", async () => {
    const { analyze, model } = setup();
    const analysis = await analyze(refactorMove);

    expect(analysis.status).toBe("complete");
    expect(requiredHunkIds(analysis).size).toBe(0);
    expect(analysis.proofs.map((proof) => [proof.path, proof.kind])).toEqual([
      ["pnpm-lock.yaml", "generated"],
      ["src/dates.ts", "rename"],
      ["src/text/format.ts", "move"],
      ["src/utils/strings.ts", "move"],
      ["src/config.ts", "formatting"],
    ]);
    expect(analysis.risk.every((risk) => risk.source === "proof")).toBe(true);
    expect(analysis.risk).toHaveLength(4);
    expect(analysis.tour).toEqual({ steps: [], builtBy: "model" });
    expect(analysis.warnings).toEqual([
      "pnpm-lock.yaml changed without a change to package.json or pnpm-workspace.yaml",
    ]);
    for (const pass of ["intent", "risk", "decisions", "tour"] as const) {
      expect(model.callsTo(pass)).toHaveLength(1);
    }
    const input = firstInput(model, "intent");
    expect(input.files.every((file) => file.mechanical && file.hunks.length === 0)).toBe(true);
    expect(input.files.every((file) => file.headContent === null)).toBe(true);
    expect(input.files.flatMap((file) => file.mechanicalHunks)).toHaveLength(4);
  });

  it("gives no formatting proof when the parser fails, and says nothing", async () => {
    const parser = new FakeCodeParser();
    parser.failAlways("syntaxNodes");
    parser.failAlways("symbols");
    const { analyze } = setup({ parser });
    const analysis = await analyze(refactorMove);
    expect(analysis.status).toBe("complete");
    expect(analysis.proofs.map((proof) => proof.kind)).not.toContain("formatting");
    expect([...requiredHunkIds(analysis)]).toEqual(
      analysis.files.find((file) => file.path === "src/config.ts")?.hunks.map((hunk) => hunk.id),
    );
    expect(analysis.callGraph).toEqual([]);
    expect(analysis.warnings).toHaveLength(1);
  });

  describe("collect", () => {
    it("fails when the diff can't be parsed", async () => {
      const { analyze, github } = setup();
      github.addFixture({
        ...smallFeature,
        pullRequest: { ...smallFeature.pullRequest, diff: "not a diff\n" },
      });
      const analysis = await analyze();
      expect(analysis.status).toBe("failed");
      expect(analysis.stages.collect).toBe("failed");
      expect(analysis.error).toEqual({
        stage: "collect",
        code: "host-error",
        message: expect.stringMatching(/^Couldn't parse the pull request's diff: line 1: /),
      });
    });

    it("fails when a file can't be fetched", async () => {
      const { analyze, github } = setup();
      github.failNext("getFiles", hostError("network"));
      const analysis = await analyze();
      expect(analysis.error).toEqual({
        stage: "collect",
        code: "host-error",
        message: "Couldn't fetch the pull request's files: network from host",
      });
      expect(analysis.stages.prep).toBe("pending");
    });

    it("treats files over 1 MB as unavailable", async () => {
      const { analyze, github, model } = setup();
      const { ref, headSha } = smallFeature.pullRequest;
      github.setFiles(ref.repo, headSha, {
        "src/services/receipts.ts": "x".repeat(1024 * 1024 + 1),
      });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      const receipts = firstInput(model, "intent").files.find(
        (file) => file.path === "src/services/receipts.ts",
      );
      expect(receipts?.headContent).toBeNull();
    });

    it("warns and continues when Jira fails", async () => {
      const tickets = new FakeTicketSource();
      tickets.failNext({ kind: "network", message: "Jira is down" });
      const { analyze } = setup({ tickets });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(analysis.tickets).toEqual([]);
      expect(analysis.missingTicketKeys).toEqual(["SHOP-123"]);
      expect(analysis.warnings).toEqual(["Couldn't fetch Jira tickets: Jira is down"]);
    });

    it("lists ticket keys without fetching them when Jira isn't configured", async () => {
      const tickets = new FakeTicketSource({ configured: false });
      const { analyze } = setup({ tickets });
      const analysis = await analyze(bitbucketBugfix);
      expect(tickets.calls).toEqual([]);
      expect(analysis.missingTicketKeys).toEqual(["PAY-42"]);
      expect(analysis.warnings).toEqual([]);
    });

    it("records keys Jira doesn't know as missing", async () => {
      const { analyze } = setup({ tickets: new FakeTicketSource() });
      const analysis = await analyze();
      expect(analysis.missingTicketKeys).toEqual(["SHOP-123"]);
    });
  });

  describe("size", () => {
    const inputTokens = (input: AnalysisInput) => Math.ceil(JSON.stringify(input).length / 4);

    const fullInput = async () => {
      const { analyze, model } = setup();
      await analyze();
      return firstInput(model, "checkSize");
    };

    it("drops full file contents, largest first, until the input fits", async () => {
      const full = await fullInput();
      const largest = [...full.files].sort(
        (a, b) => (b.headContent?.length ?? 0) - (a.headContent?.length ?? 0),
      )[0];
      const withoutLargest = {
        ...full,
        files: full.files.map((file) => (file === largest ? { ...file, headContent: null } : file)),
      };
      const model = new FakeAnalysisModel({ maxInputTokens: inputTokens(withoutLargest) });
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(analysis.status).toBe("complete");
      expect(analysis.warnings).toEqual([
        "Full file contents omitted for 1 file to fit the model's limit",
      ]);
      const sent = firstInput(model, "intent");
      expect(sent).toEqual(withoutLargest);
      expect(sent.files.flatMap((file) => file.hunks)).toHaveLength(6);
    });

    it("fails without dropping hunks when even the hunks don't fit", async () => {
      const full = await fullInput();
      const noContents = {
        ...full,
        files: full.files.map((file) => ({ ...file, headContent: null })),
      };
      const model = new FakeAnalysisModel({ maxInputTokens: inputTokens(noContents) - 1 });
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(analysis.status).toBe("failed");
      expect(analysis.stages.prep).toBe("failed");
      expect(analysis.error).toEqual({
        stage: "prep",
        code: "model-error",
        message: `The pull request is too large to analyze, even without full file contents: ${inputTokens(noContents)} input tokens is over the limit of ${inputTokens(noContents) - 1}`,
      });
      expect(model.callsTo("intent")).toEqual([]);
      const lastChecked = model.callsTo("checkSize").at(-1)?.input;
      expect(lastChecked?.files.flatMap((file) => file.hunks)).toHaveLength(6);
      expect(analysis.callGraph).not.toEqual([]);
    });

    it("fails at once when nothing can be dropped", async () => {
      const model = new FakeAnalysisModel({ maxInputTokens: 1 });
      const { analyze } = setup({ model });
      const analysis = await analyze(refactorMove);
      expect(analysis.error?.message).toMatch(/^The pull request is too large to analyze/);
      expect(model.callsTo("checkSize")).toHaveLength(1);
    });

    it("fails when the size check itself fails", async () => {
      const model = new FakeAnalysisModel();
      model.checkSize = async () => err(modelError("unauthorized", "Bad API key"));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.error).toEqual({
        stage: "prep",
        code: "model-error",
        message: "Bad API key",
      });
    });

    it("fails when a size check fails while dropping contents", async () => {
      const model = new FakeAnalysisModel();
      const answers = [
        err(modelError("too-large")),
        ok({ inputTokens: 1 }),
        err(modelError("network", "Connection reset")),
      ];
      model.checkSize = async () => answers.shift() ?? ok({ inputTokens: 1 });
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.error?.message).toBe("Connection reset");
    });
  });

  describe("intent", () => {
    it("fails the analysis on a model error and keeps what was done", async () => {
      const model = new FakeAnalysisModel();
      model.script("intent", err(modelError("overloaded", "Overloaded")));
      const { analyze, emitted } = setup({ model });
      const analysis = await analyze();

      expect(analysis.status).toBe("failed");
      expect(analysis.stages).toEqual({
        collect: "done",
        prep: "done",
        intent: "failed",
        risk: "pending",
        decisions: "pending",
        tour: "pending",
      });
      expect(analysis.error).toEqual({
        stage: "intent",
        code: "model-error",
        message: "Overloaded",
      });
      expect(analysis.files).toHaveLength(3);
      expect(analysis.tickets).toEqual(smallFeature.tickets);
      expect(model.callsTo("intent")).toHaveLength(1);
      expect(model.callsTo("risk")).toEqual([]);
      expect(emitted.at(-1)?.event).toEqual({ type: "done" });
    });

    it("retries an unparseable answer once with the problem as feedback", async () => {
      const model = new FakeAnalysisModel();
      model.script("intent", err(modelError("invalid-output", "riskClass: invalid enum")));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(model.callsTo("intent").map((call) => call.options)).toEqual([
        undefined,
        { feedback: ["riskClass: invalid enum"] },
      ]);
      expect(analysis.usage.filter((usage) => usage.pass === "intent")).toHaveLength(1);
    });

    it("fails when the retry of an unparseable answer fails too", async () => {
      const model = new FakeAnalysisModel();
      model.script(
        "intent",
        err(modelError("invalid-output")),
        err(modelError("invalid-output", "Still wrong")),
      );
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.error).toEqual({
        stage: "intent",
        code: "model-error",
        message: "Still wrong",
      });
    });

    it("drops unknown hunks from mismatches after a retry", async () => {
      const intent = {
        stated: null,
        inferred: { summary: "Adds receipts.", behaviorChanges: [] },
        mismatches: [
          { kind: "unrequested" as const, description: "Rate limit", hunkIds: [h1, unknownHunk] },
        ],
      };
      const model = new FakeAnalysisModel();
      model.script("intent", ok(intent), ok(intent));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(model.callsTo("intent")[1]?.options).toEqual({
        feedback: [`${unknownHunk} isn't a hunk of this pull request.`],
      });
      expect(analysis.intent?.mismatches[0]?.hunkIds).toEqual([h1]);
      expect(analysis.warnings).toEqual([
        "Dropped 1 unknown hunk reference from intent mismatches",
      ]);
    });
  });

  describe("risk", () => {
    it("uses a valid second answer after an invalid first one", async () => {
      const model = new FakeAnalysisModel();
      const second = smallFeatureHunks.map((id) => ({
        ...logic(id),
        riskClass: "contract" as const,
      }));
      model.script("risk", ok(smallFeatureHunks.slice(1).map(logic)), ok(second));
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(model.callsTo("risk")[1]?.options).toEqual({
        feedback: [`${h1} has no risk class. Classify every hunk sent in full exactly once.`],
      });
      expect(analysis.risk.map((risk) => risk.riskClass)).toEqual(Array(6).fill("contract"));
      expect(analysis.warnings).toEqual([]);
      expect(analysis.usage.filter((usage) => usage.pass === "risk")).toHaveLength(2);
    });

    it("falls back to logic for hunks still unclassified after the retry", async () => {
      const model = new FakeAnalysisModel();
      const invalid = [
        logic(h1),
        { ...logic(h1), riskClass: "contract" as const },
        logic(unknownHunk),
        ...smallFeatureHunks.slice(3).map(logic),
      ];
      model.script("risk", ok(invalid), ok(invalid));
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(model.callsTo("risk")[1]?.options?.feedback).toEqual([
        `${h1} is classified more than once.`,
        `${unknownHunk} isn't a hunk sent in full, so don't classify it.`,
        `${h2} has no risk class. Classify every hunk sent in full exactly once.`,
        `${h3} has no risk class. Classify every hunk sent in full exactly once.`,
      ]);
      expect(analysis.status).toBe("complete");
      // The model's fallback for h2 and h3 is logic; the config rule raises all three.
      expect(analysis.risk).toEqual([
        configRule(h1),
        ...smallFeatureHunks.slice(3).map((id) => ({ ...logic(id), source: "model" })),
        configRule(h2),
        configRule(h3),
      ]);
      expect(analysis.warnings).toEqual([
        "The model didn't classify 2 hunks, so they're shown as logic",
      ]);
      expect(model.callsTo("tour")[0]).toBeDefined();
    });

    it("warns about ignored classifications when every hunk is still covered", async () => {
      const model = new FakeAnalysisModel();
      const repeated = [...smallFeatureHunks.map(logic), logic(h1)];
      model.script("risk", ok(repeated), ok(repeated));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.risk).toHaveLength(6);
      expect(analysis.warnings).toEqual([
        "Ignored risk classifications for unknown or repeated hunks",
      ]);
    });

    it("repairs the first answer when the retry fails", async () => {
      const model = new FakeAnalysisModel();
      const last = smallFeatureHunks.at(-1);
      model.script(
        "risk",
        ok(smallFeatureHunks.slice(0, -1).map(logic)),
        err(modelError("network")),
      );
      const { analyze, logger } = setup({ model });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(analysis.risk.find((risk) => risk.hunkId === last)?.source).toBe("fallback");
      expect(logger.entries.map((entry) => entry.message)).toContain(
        "A model pass retry failed; repairing the first answer",
      );
    });

    it("fails the analysis on a model error and keeps the decisions", async () => {
      const model = new FakeAnalysisModel();
      model.script("risk", err(modelError("rate-limited", "Slow down")));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.status).toBe("failed");
      expect(analysis.error).toEqual({ stage: "risk", code: "model-error", message: "Slow down" });
      expect(analysis.stages).toMatchObject({ risk: "failed", decisions: "done", tour: "pending" });
      expect(analysis.decisions).toHaveLength(3);
      expect(analysis.risk).toEqual([]);
      expect(model.callsTo("tour")).toEqual([]);
    });
  });

  describe("decisions", () => {
    const draft = (hunkIds: readonly HunkId[]) => ({
      title: "Adds receipts",
      category: "api" as const,
      whyItMatters: "New endpoint.",
      hunkIds,
    });

    it("drops unknown hunk references after a retry", async () => {
      const model = new FakeAnalysisModel();
      const drafts = [draft([h1, unknownHunk]), draft([unknownHunk]), draft([h2])];
      model.script("decisions", ok(drafts), ok(drafts));
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(model.callsTo("decisions")[1]?.options).toEqual({
        feedback: [`${unknownHunk} isn't a hunk of this pull request.`],
      });
      expect(analysis.decisions.map((decision) => [decision.id, decision.hunkIds])).toEqual([
        ["d1", [h1]],
        ["d2", []],
        ["d3", [h2]],
      ]);
      expect(analysis.warnings).toEqual(["Dropped 1 unknown hunk reference from decisions"]);
    });

    it("may reference mechanical hunks", async () => {
      const files = parseUnifiedDiff(refactorMove.pullRequest.diff);
      const lockfileHunk = files.ok ? files.value[0]?.hunks[0]?.id : undefined;
      if (lockfileHunk === undefined) throw new Error("refactor-move changes the lockfile");
      const model = new FakeAnalysisModel();
      model.script("decisions", ok([draft([lockfileHunk])]));
      const { analyze } = setup({ model });
      const analysis = await analyze(refactorMove);
      expect(analysis.decisions[0]?.hunkIds).toEqual([lockfileHunk]);
      expect(model.callsTo("decisions")).toHaveLength(1);
    });

    it("fails the analysis on a model error and keeps the risk", async () => {
      const model = new FakeAnalysisModel();
      model.script("decisions", err(modelError("refusal", "Refused")));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.error).toEqual({
        stage: "decisions",
        code: "model-error",
        message: "Refused",
      });
      expect(analysis.stages).toMatchObject({ risk: "done", decisions: "failed" });
      expect(analysis.risk).toHaveLength(6);
    });
  });

  describe("tour", () => {
    it("falls back to file order when the tour is invalid twice", async () => {
      const model = new FakeAnalysisModel();
      const invalid = { steps: [{ title: "All", explanation: "", hunkIds: [h1] }] };
      model.script("tour", ok(invalid), ok(invalid));
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(model.callsTo("tour")).toHaveLength(2);
      expect(analysis.status).toBe("complete");
      expect(analysis.tour?.builtBy).toBe("code");
      expect(validateTour(analysis.tour ?? { steps: [] }, requiredHunkIds(analysis))).toEqual([]);
      expect(analysis.warnings).toEqual([
        "The guided tour didn't cover every hunk exactly once, so the tour follows the call graph instead",
      ]);
    });

    it("uses a valid second tour", async () => {
      const model = new FakeAnalysisModel();
      const valid = { steps: [{ title: "All", explanation: "", hunkIds: smallFeatureHunks }] };
      model.script("tour", ok({ steps: [] }), ok(valid));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(model.callsTo("tour")[1]?.options?.feedback).toContain(
        `${h1} is in no step. Put every hunk sent in full in exactly one step.`,
      );
      expect(analysis.tour).toEqual({
        steps: [
          {
            id: "s1",
            title: "All",
            explanation: "",
            partIds: smallFeatureHunks,
            kind: "flow",
            via: [],
            entries: [],
          },
        ],
        builtBy: "model",
      });
    });

    it("falls back to file order on a model error and still completes", async () => {
      const model = new FakeAnalysisModel();
      model.script("tour", err(modelError("overloaded", "Overloaded")));
      const { analyze } = setup({ model });
      const analysis = await analyze();

      expect(model.callsTo("tour")).toHaveLength(1);
      expect(analysis.status).toBe("complete");
      expect(analysis.stages.tour).toBe("done");
      expect(analysis.tour?.builtBy).toBe("code");
      expect(analysis.warnings).toEqual([
        "The guided tour couldn't be built (Overloaded), so the tour follows the call graph instead",
      ]);
    });
  });

  it("fails with an internal error when a stage throws", async () => {
    const parser = new FakeCodeParser();
    parser.symbols = async () => {
      throw new Error("bug");
    };
    const { analyze, logger, emitted } = setup({ parser });
    const analysis = await analyze();

    expect(analysis.status).toBe("failed");
    expect(analysis.error).toEqual({
      stage: "prep",
      code: "internal",
      message: "megareviewer hit an internal error during the analysis",
    });
    expect(analysis.stages.prep).toBe("failed");
    expect(logger.entries.find((entry) => entry.level === "error")?.message).toBe(
      "The analysis pipeline crashed",
    );
    expect(emitted.at(-1)?.event).toEqual({ type: "done" });
  });
});

describe("starting analyses", () => {
  const { url } = smallFeature.pullRequest;

  it("rejects URLs that aren't pull requests", async () => {
    const { useCases } = setup();
    expect(await useCases.startAnalysis("https://gitlab.com/a/b/-/merge_requests/1")).toEqual(
      err({ code: "unsupported-url", message: "Not a GitHub or Bitbucket Cloud pull request URL" }),
    );
  });

  it("rejects PRs on hosts that aren't configured", async () => {
    const { useCases } = setup({ onlyGithub: true });
    expect(await useCases.startAnalysis(bitbucketBugfix.pullRequest.url)).toEqual(
      err({ code: "host-not-configured", message: "Bitbucket Cloud isn't configured" }),
    );
  });

  it("maps host errors", async () => {
    const { useCases, github } = setup();
    expect(await useCases.startAnalysis("https://github.com/acme/shop/pull/999")).toEqual(
      err({ code: "not-found", message: "pull request github/acme/shop#999 not found" }),
    );
    github.failNext("getPullRequest", hostError("rate-limited"));
    expect(await useCases.startAnalysis(url)).toEqual(
      err({ code: "host-error", message: "rate-limited from host" }),
    );
  });

  it("returns a complete analysis without running it again", async () => {
    const { analyze, useCases, model } = setup();
    const analysis = await analyze();
    expect(await useCases.startAnalysis(url)).toEqual(ok({ analysisId: analysis.id }));
    expect(model.callsTo("intent")).toHaveLength(1);
  });

  it("runs one pipeline for concurrent requests", async () => {
    const { useCases, model, done } = setup();
    const [first, second] = await Promise.all([
      useCases.startAnalysis(url),
      useCases.startAnalysis(url),
    ]);
    expect(first).toEqual(second);
    if (!first?.ok) throw new Error("not started");
    await done(first.value.analysisId);
    expect(await useCases.startAnalysis(url)).toEqual(first);
    expect(model.callsTo("intent")).toHaveLength(1);
  });

  it("joins a run in flight", async () => {
    const { useCases, model, done } = setup();
    const first = await useCases.startAnalysis(url);
    const second = await useCases.startAnalysis(url);
    expect(second).toEqual(first);
    if (!first.ok) throw new Error("not started");
    await done(first.value.analysisId);
    expect(model.callsTo("intent")).toHaveLength(1);
  });

  it("runs a failed analysis again under the same ID", async () => {
    const model = new FakeAnalysisModel();
    model.script("intent", err(modelError("overloaded")));
    const { analyze, clock } = setup({ model });
    const failed = await analyze();
    clock.advance(1000);
    const again = await analyze(smallFeature, 2);
    expect(again.id).toBe(failed.id);
    expect(again.status).toBe("complete");
    expect(again.createdAt).toBe(failed.createdAt);
    expect(again.updatedAt).not.toBe(failed.updatedAt);
  });

  it("runs an analysis left running by an earlier process again", async () => {
    const { analyze, store, model } = setup();
    const complete = await analyze();
    const interrupted: Analysis = { ...complete, status: "running", tour: null };
    const { analyze: analyzeAgain, store: otherStore } = setup({ model });
    await otherStore.saveAnalysis(interrupted);
    const again = await analyzeAgain();
    expect(again.id).toBe(complete.id);
    expect(again.status).toBe("complete");
    expect(model.callsTo("intent")).toHaveLength(2);
    expect(await store.getAnalysis(complete.id)).toEqual(complete);
  });
});

describe("recoverInterruptedAnalyses", () => {
  it("fails analyses left running, at the stage that was running", async () => {
    const { analyze, useCases, store, clock } = setup();
    const complete = await analyze();
    const atIntent: Analysis = {
      ...complete,
      id: AnalysisId.parse("a_00000000000000a1"),
      status: "running",
      stages: { ...complete.stages, intent: "running", risk: "pending", decisions: "pending" },
    };
    const notStarted: Analysis = {
      ...complete,
      id: AnalysisId.parse("a_00000000000000a2"),
      status: "running",
      stages: { ...complete.stages, collect: "pending", prep: "pending" },
    };
    await store.saveAnalysis(atIntent);
    await store.saveAnalysis(notStarted);
    clock.advance(5000);

    expect(await useCases.recoverInterruptedAnalyses()).toBe(2);
    expect(await store.getAnalysis(atIntent.id)).toEqual({
      ...atIntent,
      status: "failed",
      stages: { ...atIntent.stages, intent: "failed" },
      error: {
        stage: "intent",
        code: "interrupted",
        message: "megareviewer stopped during the analysis",
      },
      updatedAt: clock.now(),
    });
    expect((await store.getAnalysis(notStarted.id))?.error?.stage).toBe("collect");
    expect(await store.getAnalysis(complete.id)).toEqual(complete);
    expect(await useCases.recoverInterruptedAnalyses()).toBe(0);
  });

  it("leaves analyses running in this process alone", async () => {
    const { useCases, done } = setup();
    const started = await useCases.startAnalysis(smallFeature.pullRequest.url);
    expect(await useCases.recoverInterruptedAnalyses()).toBe(0);
    if (!started.ok) throw new Error("not started");
    await done(started.value.analysisId);
  });
});

describe("retryAnalysis", () => {
  const failingModel = () => {
    const model = new FakeAnalysisModel();
    model.script("intent", err(modelError("overloaded")));
    return model;
  };

  it("runs a failed analysis again", async () => {
    const { analyze, useCases, done, stored } = setup({ model: failingModel() });
    const failed = await analyze();
    expect(await useCases.retryAnalysis(failed.id)).toEqual(ok({ analysisId: failed.id }));
    await done(failed.id, 2);
    expect((await stored(failed.id)).status).toBe("complete");
  });

  it("analyzes the new commits under a new ID when the PR changed", async () => {
    const { analyze, useCases, github, done, stored } = setup({ model: failingModel() });
    const failed = await analyze();
    const newHead = "1".repeat(40);
    github.setHeadSha(smallFeature.pullRequest.ref, newHead);
    const retried = await useCases.retryAnalysis(failed.id);
    if (!retried.ok) throw new Error(retried.error.message);
    expect(retried.value.analysisId).not.toBe(failed.id);
    await done(retried.value.analysisId);
    const analysis = await stored(retried.value.analysisId);
    expect(analysis.key.headSha).toBe(newHead);
    expect(analysis.status).toBe("complete");
    expect((await stored(failed.id)).status).toBe("failed");
  });

  it("only retries failed analyses", async () => {
    const { analyze, useCases } = setup();
    const complete = await analyze();
    expect(await useCases.retryAnalysis(complete.id)).toEqual(
      err({ code: "bad-request", message: "Only a failed analysis can be retried" }),
    );
    expect(await useCases.retryAnalysis(AnalysisId.parse("a_0000000000000000"))).toEqual(
      err({ code: "not-found", message: "No analysis a_0000000000000000" }),
    );
  });

  it("reports host errors when re-fetching the PR", async () => {
    const { analyze, useCases, github } = setup({ model: failingModel() });
    const failed = await analyze();
    github.failNext("getPullRequest", hostError("unauthorized"));
    expect(await useCases.retryAnalysis(failed.id)).toEqual(
      err({ code: "host-error", message: "unauthorized from host" }),
    );
  });
});

describe("without the model", () => {
  it("completes after prep, with rule risk and the call-graph tour, and calls no model", async () => {
    const { analyze, model, emitted } = setup({ modelEnabled: false });
    const analysis = await analyze();

    expect(model.calls).toEqual([]);
    expect(analysis.status).toBe("complete");
    expect(analysis.error).toBeNull();
    expect(analysis.stages).toEqual({
      collect: "done",
      prep: "done",
      intent: "skipped",
      risk: "skipped",
      decisions: "skipped",
      tour: "skipped",
    });
    expect(analysis.key.pipelineVersion).toBe("10+no-model");
    expect(analysis.intent).toBeNull();
    expect(analysis.decisions).toEqual([]);
    expect(analysis.usage).toEqual([]);
    expect(analysis.risk.map((risk) => [risk.hunkId, risk.source])).toEqual(
      smallFeatureHunks.map((hunkId) => [hunkId, "rule"]),
    );
    expect(analysis.tour?.builtBy).toBe("code");
    expect(validateTour(analysis.tour ?? { steps: [] }, requiredHunkIds(analysis))).toEqual([]);
    expect(emitted.at(-1)?.event).toEqual({ type: "done" });
  });

  it.each(allFixtures)(
    "reads every part of $name in exactly one step, with hints between its parts",
    async (fixture) => {
      const { analyze } = setup({ modelEnabled: false });
      const analysis = await analyze(fixture);
      const known = new Set<PartId>(
        analysis.files.flatMap((file) =>
          file.hunks.flatMap((hunk) => {
            const parts = analysis.parts.filter((part) => part.hunkId === hunk.id);
            return parts.length > 0 ? parts.map((part) => part.id) : [hunk.id];
          }),
        ),
      );
      expect(
        validateTour(analysis.tour ?? { steps: [] }, requiredHunkIds(analysis), analysis.parts),
      ).toEqual([]);
      for (const hint of analysis.callGraph) {
        expect([known.has(hint.fromPartId), known.has(hint.toPartId)]).toEqual([true, true]);
      }
    },
  );

  it("marks rule matches contract", async () => {
    const { analyze } = setup({ modelEnabled: false });
    const analysis = await analyze(promptInjection);
    expect(analysis.risk.map((risk) => [risk.riskClass, risk.reason])).toContainEqual([
      "contract",
      "auth or security path",
    ]);
  });

  it("keeps a rule's contract over the model's logic when the model runs", async () => {
    const { analyze } = setup();
    const analysis = await analyze(promptInjection);
    const contract = analysis.risk.filter((risk) => risk.riskClass === "contract");
    expect(contract.length).toBeGreaterThan(0);
    expect(contract.every((risk) => risk.source === "rule")).toBe(true);
  });
});

describe("with a local checkout", () => {
  const { headSha } = smallFeature.pullRequest;
  const appLines = [
    'import { ordersRouter } from "./routes/orders.ts";',
    "",
    "export const app = express();",
    'app.use("/api", ordersRouter);',
  ];
  const checkout = (files: Record<string, string> = {}) =>
    new FakeLocalCheckout({
      [headSha]: {
        ...smallFeature.headFiles,
        "src/app.ts": appLines.join("\n"),
        // Names the router, but doesn't import it.
        "src/admin.ts": "export const adminRouter = ordersRouter;",
        "README.md": "ordersRouter",
        ...files,
      },
    });
  const ordersHunk = smallFeatureFiles[1]?.hunks[1]?.id;

  it.each([false, true])(
    "reads the callers of changed definitions outside the PR (model %s)",
    async (modelEnabled) => {
      const { analyze } = setup({
        modelEnabled,
        checkouts: new FakeLocalCheckouts({ checkout: checkout(), namesRepo: true }),
      });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(analysis.checkout).toBe("read");
      expect(analysis.key.pipelineVersion).toBe(
        `10+${modelEnabled ? "fake-model/1" : "no-model"}+checkout`,
      );
      expect(analysis.unchangedCallers).toEqual([
        {
          partId: ordersHunk,
          symbol: "ordersRouter",
          uses: [
            {
              path: "src/app.ts",
              line: 4,
              use: "call",
              excerpt: { start: 2, lines: appLines.slice(1) },
            },
          ],
          more: 0,
        },
      ]);
    },
  );

  it("parses only unchanged files in the PR's languages that name a changed definition", async () => {
    const reader = checkout({ "scripts/tool.py": "ordersRouter = 1", "src/other.ts": "x" });
    const parser = new FakeCodeParser();
    const { analyze } = setup({
      modelEnabled: false,
      parser,
      checkouts: new FakeLocalCheckouts({ checkout: reader, namesRepo: true }),
    });
    await analyze();
    expect(reader.reads).toEqual([["src/admin.ts", "src/app.ts", "src/other.ts"]]);
    const parsed = parser.calls
      .filter((call) => call.method === "symbols")
      .map((call) => call.source);
    expect(parsed).toContain(appLines.join("\n"));
    expect(parsed).not.toContain("x");
  });

  it("warns about files too large to read, and about a checkout it can't read", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const { analyze } = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts({
        checkout: checkout({ "src/big.ts": big, "src/huge.ts": big }),
        namesRepo: true,
      }),
    });
    expect((await analyze()).warnings).toContain(
      "2 files in the local checkout are over 1 MB, so callers in them aren't shown.",
    );

    const failing = checkout();
    failing.listFiles = async () => err({ kind: "failed", message: "git ls-tree failed: boom" });
    const second = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts({ checkout: failing, namesRepo: true }),
    });
    const analysis = await second.analyze();
    expect(analysis.status).toBe("complete");
    expect(analysis.unchangedCallers).toEqual([]);
    expect(analysis.warnings).toContain(
      "Couldn't read the local checkout: git ls-tree failed: boom",
    );
  });

  it.each([
    [true, "missing-commit"],
    [false, "none"],
  ] as const)(
    "reads nothing from a checkout without the head commit (remote names the repository: %s)",
    async (namesRepo, status) => {
      const reader = new FakeLocalCheckout({ ["0".repeat(40)]: smallFeature.headFiles });
      const { analyze } = setup({
        modelEnabled: false,
        checkouts: new FakeLocalCheckouts({ checkout: reader, namesRepo }),
      });
      const analysis = await analyze();
      expect(analysis.checkout).toBe(status);
      expect(analysis.key.pipelineVersion).toBe("10+no-model");
      expect(analysis.unchangedCallers).toEqual([]);
      expect(reader.reads).toEqual([]);
    },
  );

  it("says none was found without a checkout", async () => {
    const { analyze } = setup({ modelEnabled: false });
    expect((await analyze()).checkout).toBe("none");
  });
});
