import { describe, expect, it } from "vitest";
import { HunkId, type PartId, parseUnifiedDiff } from "../../domain/diff/index.ts";
import {
  type Analysis,
  AnalysisId,
  analysisId,
  following,
  type HostError,
  inProgress,
  MismatchId,
  type ModelCall,
  type ModelError,
  type ModelOption,
  modelRunnable,
  PointId,
  type Preference,
  PreferenceId,
  pointsOf,
  type StageName,
  type StageStatus,
  validateRiskCoverage,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { type AnalysisEvent, createAnalysisEvents } from "../events/index.ts";
import type {
  AnalysisInput,
  CodeParser,
  FoundCheckout,
  HarnessSourceFile,
  PassOptions,
} from "../ports/index.ts";
import {
  allFixtures,
  bitbucketBugfix,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeHarnessSource,
  FakeLocalCheckout,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakeRepositoryCopies,
  FakeTicketSource,
  FixedClock,
  fakeModelOption,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  InMemoryHarnessStore,
  InMemoryKnownCheckouts,
  InMemoryPreferenceStore,
  type PullRequestFixture,
  promptInjection,
  RecordingLogger,
  refactorMove,
  smallFeature,
  smallFeatureFiles,
} from "../testing/index.ts";
import { createUseCases, loadHarness } from "./index.ts";

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
    /** Whether analyze() runs the model after the code's analysis, as the button does. */
    modelEnabled?: boolean;
    /** The catalog's options; Sonnet 5.5 on Claude Code, available, unless given. */
    modelOptions?: readonly ModelOption[];
    checkouts?: FakeLocalCheckouts;
    harnessSource?: FakeHarnessSource;
    copies?: FakeRepositoryCopies;
    clock?: FixedClock;
    /** The PRs GitHub has; every fixture unless given. */
    fixtures?: readonly PullRequestFixture[];
  } = {},
) => {
  const clock = options.clock ?? new FixedClock("2026-10-21T09:00:00Z");
  const github = new FakeGitHost({
    host: "github",
    fixtures: options.fixtures ?? allFixtures,
    clock,
  });
  const bitbucket = new FakeGitHost({ host: "bitbucket", fixtures: allFixtures, clock });
  const tickets =
    options.tickets ??
    new FakeTicketSource({ tickets: allFixtures.flatMap((fixture) => fixture.tickets) });
  const model = options.model ?? new FakeAnalysisModel();
  const models = new FakeModelCatalog({
    model,
    ...(options.modelOptions === undefined ? {} : { options: options.modelOptions }),
  });
  const store = new RecordingStore();
  const preferences = new InMemoryPreferenceStore();
  const fileCache = options.fileCache ?? new InMemoryFileCache();
  const harnessStore = new InMemoryHarnessStore(clock);
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
      models,
      store,
      fileCache,
      harnessSource: () => options.harnessSource ?? null,
      harnessStore,
      preferences,
      history: {},
      checkouts: options.checkouts ?? new FakeLocalCheckouts(),
      knownCheckouts: new InMemoryKnownCheckouts(),
      copies: options.copies ?? new FakeRepositoryCopies(),
      threads: {},
      statuses: {},
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

  /** Runs the model on a complete analysis, as the button does, and resolves once it's done. */
  const runModel = async (id: AnalysisId, optionId?: string, tour = false): Promise<Analysis> => {
    const before = doneCount(id);
    const ran = await useCases.runModel(id, optionId, tour);
    if (!ran.ok) throw new Error(ran.error.message);
    await done(id, before + 1);
    return stored(id);
  };

  /** The analysis once its code stages end, and the model's run too unless it's off. */
  const analyze = async (fixture: PullRequestFixture = smallFeature, count = 1) => {
    const started = await useCases.startAnalysis(fixture.pullRequest.url);
    if (!started.ok) throw new Error(started.error.message);
    const id = started.value.analysisId;
    await done(id, count);
    const analysis = await stored(id);
    if (options.modelEnabled === false || !modelRunnable(analysis)) return analysis;
    return runModel(id);
  };

  return {
    clock,
    github,
    bitbucket,
    tickets,
    model,
    models,
    store,
    preferences,
    fileCache,
    harnessStore,
    logger,
    emitted,
    useCases,
    done,
    doneCount,
    stored,
    analyze,
    runModel,
    /** How many times prep started, so how many code runs there were. */
    preps: () =>
      emitted.filter(
        ({ event }) =>
          event.type === "updated" && event.stage === "prep" && event.status === "running",
      ).length,
  };
};

const allHunkIds = (analysis: Analysis): Set<HunkId> =>
  new Set(analysis.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)));

const requiredHunkIds = (analysis: Analysis): Set<HunkId> => {
  const proved = new Set(analysis.proofs.map((proof) => proof.hunkId));
  return new Set([...allHunkIds(analysis)].filter((id) => !proved.has(id)));
};

/** The flows place every part of every hunk without a proof once, and nothing else. */
const placesEveryPartOnce = (analysis: Analysis): void => {
  const placed = (analysis.flows ?? []).flatMap((flow) => flow.partIds).sort();
  const required = [...requiredHunkIds(analysis)]
    .flatMap((id): PartId[] => {
      const own = analysis.parts.filter((part) => part.hunkId === id).map((part) => part.id);
      return own.length > 0 ? own : [id];
    })
    .sort();
  expect(placed).toEqual(required);
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
  lines: null,
  guidance: null,
});
const configHunks = new Set(smallFeatureFiles[0]?.hunks.map((hunk) => hunk.id));
/** Well-formed, but not a hunk of any fixture. */
const unknownHunk = HunkId.parse("h_ffffffffffffffff");
const logic = (hunkId: HunkId) => ({
  hunkId,
  riskClass: "logic" as const,
  reason: "Logic",
  lines: null,
  checkedBy: null,
  guidance: null,
});

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
    expect(Object.values(analysis.stages)).toEqual([...Array(6).fill("done"), "skipped"]);
    expect(analysis.key.pipelineVersion).toBe("20");
    expect(analysis.modelError).toBeNull();
    expect(analysis.files.map((file) => ({ ...file, language: null }))).toEqual(
      smallFeatureFiles.map((file) => ({ ...file, language: null })),
    );
    expect(analysis.files.map((file) => file.language)).toEqual([null, "typescript", "typescript"]);
    expect(analysis.tickets).toEqual(smallFeature.tickets);
    expect(analysis.missingTicketKeys).toEqual([]);
    expect(analysis.proofs).toEqual([]);
    expect(analysis.callGraph.map((hint) => hint.symbol)).toContain("renderReceipt");
    expect(analysis.callSites.map((site) => site.symbol)).toContain("renderReceipt");
    expect(analysis.fileLinks).toEqual([
      { from: "src/routes/orders.ts", to: "src/services/receipts.ts" },
    ]);
    expect(analysis.generated).toEqual([]);
    expect(analysis.intent?.inferred.summary).toBe("Changes 3 file(s).");
    expect(analysis.risk).toEqual(
      smallFeatureHunks.map((hunkId) =>
        configHunks.has(hunkId)
          ? configRule(hunkId)
          : {
              hunkId,
              riskClass: "logic",
              reason: "Ordinary code change",
              source: "model",
              lines: null,
              guidance: null,
            },
      ),
    );
    expect(analysis.decisions.map((decision) => decision.id)).toEqual(["d1", "d2", "d3"]);
    expect(analysis.flows).toHaveLength(2);
    expect(analysis.warnings).toEqual([]);
    expect(analysis.filesFetched).toEqual({ done: 6, total: 6 });
    // The guardrail call after the passes, since the run has a finding.
    expect(analysis.usage.map((usage) => usage.pass).sort()).toEqual([
      "decisions",
      "findings",
      "guardrails",
      "intent",
      "risk",
    ]);

    const updates = emitted.flatMap(({ event }) =>
      event.type === "updated" ? [`${event.stage}:${event.status}`] : [event.type],
    );
    expect(updates).toEqual([
      "collect:running",
      // Files fetched: none cached, then each of the two batches.
      "collect:running",
      "collect:running",
      "collect:running",
      "collect:done",
      "prep:running",
      "prep:done",
      // The code's analysis ends with the model's stages not run.
      "intent:skipped",
      "findings:skipped",
      "risk:skipped",
      "decisions:skipped",
      "done",
      // Then the model's run, as the button starts it: every pass at once.
      "intent:running",
      "findings:running",
      "risk:running",
      "decisions:running",
      "intent:done",
      "risk:done",
      "decisions:done",
      // Last: a finding takes the intent's mismatch on its hunk, so it waits for the intent.
      "findings:done",
      // The passes' end, announced as an update while the guardrail call runs; its end is done.
      "decisions:done",
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
    placesEveryPartOnce(analysis);
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
    expect(analysis.flows).toEqual([]);
    expect(analysis.warnings).toEqual([
      "pnpm-lock.yaml changed without a change to package.json or pnpm-workspace.yaml",
    ]);
    for (const pass of ["intent", "findings", "risk", "decisions"] as const) {
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

  it("starts risk and decisions once the intent's answer begins, findings once it ends", async () => {
    const clock = new FixedClock("2026-10-21T09:00:00Z");
    const riskCalled = Promise.withResolvers<void>();
    const model = new (class extends FakeAnalysisModel {
      override async intent(input: AnalysisInput, options?: PassOptions) {
        options?.onAnswering?.();
        await riskCalled.promise;
        clock.advance(7_300);
        return super.intent(input, options);
      }
      override async risk(input: AnalysisInput, options?: PassOptions) {
        riskCalled.resolve();
        return super.risk(input, options);
      }
    })();
    const { analyze } = setup({ model, clock });
    const analysis = await analyze();

    const startOf = (pass: string) =>
      Date.parse(analysis.usage.find((usage) => usage.pass === pass)?.startedAt ?? "");
    expect(startOf("risk") - startOf("intent")).toBe(0);
    expect(startOf("decisions") - startOf("intent")).toBe(0);
    expect(startOf("findings") - startOf("intent")).toBe(7_300);
  });

  it("starts risk and decisions at the intent's end when the transport can't tell when its answer began", async () => {
    const clock = new FixedClock("2026-10-21T09:00:00Z");
    const model = new (class extends FakeAnalysisModel {
      override async intent(input: AnalysisInput, options?: PassOptions) {
        clock.advance(7_300);
        return super.intent(input, { feedback: options?.feedback ?? [] });
      }
    })();
    const { analyze } = setup({ model, clock });
    const analysis = await analyze();

    const startOf = (pass: string) =>
      Date.parse(analysis.usage.find((usage) => usage.pass === pass)?.startedAt ?? "");
    expect(startOf("risk") - startOf("intent")).toBe(7_300);
  });

  it("traces every model call: why a pass ran again, and why one failed", async () => {
    const clock = new FixedClock("2026-10-21T09:00:00Z");
    const model = new FakeAnalysisModel();
    model.script(
      "risk",
      ok(smallFeatureHunks.slice(1).map(logic)),
      ok(smallFeatureHunks.map(logic)),
    );
    model.script("decisions", err(modelError("overloaded", "Overloaded")));
    const { analyze, logger } = setup({ model, clock });
    const analysis = await analyze();

    const missing = `${h1} has no risk class. Classify every hunk sent in full exactly once.`;
    const started = clock.now();
    // The parallel passes are saved as they finish, in no set order.
    const order = (call: ModelCall) => `${call.pass}/${call.attempt}`;
    const calls = analysis.modelCalls.filter(
      (call) => call.pass !== "intent" && call.pass !== "guardrails",
    );
    expect([...calls].sort((a, b) => order(a).localeCompare(order(b)))).toEqual([
      {
        pass: "decisions",
        attempt: 1,
        startedAt: started,
        durationMs: 0,
        outcome: "failed",
        problems: [],
        error: modelError("overloaded", "Overloaded"),
        reads: [],
      },
      {
        pass: "findings",
        attempt: 1,
        startedAt: started,
        durationMs: 0,
        outcome: "ok",
        problems: [],
        error: null,
        reads: [],
      },
      {
        pass: "risk",
        attempt: 1,
        startedAt: started,
        durationMs: 0,
        outcome: "problems",
        problems: [missing],
        error: null,
        reads: [],
      },
      {
        pass: "risk",
        attempt: 2,
        startedAt: started,
        durationMs: 0,
        outcome: "ok",
        problems: [],
        error: null,
        reads: [],
      },
    ]);
    expect(analysis.modelError?.stage).toBe("decisions");
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: "info",
        message: "Model call answered",
        fields: expect.objectContaining({ pass: "risk", attempt: 1, problems: [missing] }),
      }),
    );
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Model call failed",
        fields: expect.objectContaining({ pass: "decisions", kind: "overloaded" }),
      }),
    );
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
      expect(inProgress(analysis)).toBe(false);
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

      expect(analysis.status).toBe("complete");
      expect(analysis.stages.prep).toBe("done");
      expect(analysis.stages.intent).toBe("failed");
      expect(analysis.modelError).toEqual({
        stage: "intent",
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
      expect(analysis.modelError?.message).toMatch(/^The pull request is too large to analyze/);
      expect(model.callsTo("checkSize")).toHaveLength(1);
    });

    it("fails when the size check itself fails", async () => {
      const model = new FakeAnalysisModel();
      model.checkSize = async () => err(modelError("unauthorized", "Bad API key"));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.modelError).toEqual({
        stage: "intent",
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
      expect(analysis.modelError?.message).toBe("Connection reset");
    });
  });

  describe("intent", () => {
    it("records a model error, keeping the code's analysis complete", async () => {
      const model = new FakeAnalysisModel();
      model.script("intent", err(modelError("overloaded", "Overloaded")));
      const { analyze, emitted } = setup({ model });
      const analysis = await analyze();

      expect(analysis.status).toBe("complete");
      expect(analysis.error).toBeNull();
      expect(analysis.stages).toEqual({
        collect: "done",
        prep: "done",
        intent: "failed",
        findings: "done",
        risk: "done",
        decisions: "done",
        steps: "skipped",
      });
      expect(analysis.modelError).toEqual({
        stage: "intent",
        code: "model-error",
        message: "Overloaded",
      });
      expect(analysis.files).toHaveLength(3);
      expect(analysis.tickets).toEqual(smallFeature.tickets);
      expect(model.callsTo("intent")).toHaveLength(1);
      // The other passes don't need the intent, so what they found stays.
      expect(analysis.risk.map((risk) => risk.source)).toContain("model");
      expect(emitted.at(-1)?.event).toEqual({ type: "done" });
    });

    it("retries an unparseable answer once with the problem as feedback", async () => {
      const model = new FakeAnalysisModel();
      model.script("intent", err(modelError("invalid-output", "riskClass: invalid enum")));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(model.callsTo("intent").map((call) => call.options?.feedback)).toEqual([
        undefined,
        ["riskClass: invalid enum"],
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
      expect(analysis.modelError).toEqual({
        stage: "intent",
        code: "model-error",
        message: "Still wrong",
      });
    });

    it("drops unknown hunks from mismatches after a retry", async () => {
      const intent = {
        stated: null,
        inferred: { summary: "Adds receipts.", shape: "", behaviorChanges: [], watch: [] },
        mismatches: [
          { kind: "unrequested" as const, description: "Rate limit", hunkIds: [h1, unknownHunk] },
        ],
      };
      const model = new FakeAnalysisModel();
      model.script("intent", ok(intent), ok(intent));
      const { analyze, logger } = setup({ model });
      const analysis = await analyze();
      expect(model.callsTo("intent")[1]?.options?.feedback).toEqual([
        `${unknownHunk} isn't a hunk of this pull request.`,
      ]);
      expect(analysis.intent?.mismatches[0]?.hunkIds).toEqual([h1]);
      // The reviewer can't act on the model's mistake, so it's logged, not shown.
      expect(analysis.warnings).toEqual([]);
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "warn",
          message: "Dropped unknown hunk references from intent mismatches",
        }),
      );
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
        // A risk without a checking test has none, rather than null.
        ...smallFeatureHunks.slice(3).map((id) => ({
          ...logic(id),
          checkedBy: undefined,
          source: "model",
        })),
        configRule(h2),
        configRule(h3),
      ]);
      expect(analysis.warnings).toEqual([
        "The model didn't classify 2 hunks, so they're shown as logic",
      ]);
    });

    it("keeps a contract hunk's lines only when that hunk shows them", async () => {
      const [, , , h4, h5, h6] = smallFeatureHunks;
      if (h4 === undefined || h5 === undefined || h6 === undefined) throw new Error("six hunks");
      const hunk = smallFeatureFiles.flatMap((file) => file.hunks).find((one) => one.id === h4);
      const line = hunk?.lines.find((one) => one.newLine !== null)?.newLine;
      if (line == null) throw new Error("small-feature's fourth hunk has new lines");
      const lines = { hunkId: h4, side: "new" as const, startLine: line, line };
      const contract = (id: HunkId, at: typeof lines) => ({
        ...logic(id),
        riskClass: "contract" as const,
        lines: at,
      });
      const model = new FakeAnalysisModel();
      model.script(
        "risk",
        ok([
          ...[h1, h2, h3].map(logic),
          contract(h4, lines),
          // Another hunk's lines, and lines on a logic hunk, aren't kept.
          contract(h5, lines),
          { ...logic(h6), lines: { ...lines, hunkId: h6 } },
        ]),
      );
      const { analyze } = setup({ model });
      const analysis = await analyze();
      const linesOf = (id: HunkId) => analysis.risk.find((risk) => risk.hunkId === id)?.lines;
      expect([linesOf(h4), linesOf(h5), linesOf(h6)]).toEqual([lines, null, null]);
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

    it("records a model error and keeps the decisions, and the rules' risk", async () => {
      const model = new FakeAnalysisModel();
      model.script("risk", err(modelError("rate-limited", "Slow down")));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(analysis.modelError).toEqual({
        stage: "risk",
        code: "model-error",
        message: "Slow down",
      });
      expect(analysis.stages).toMatchObject({ risk: "failed", decisions: "done" });
      expect(analysis.decisions).toHaveLength(3);
      expect(analysis.risk.map((risk) => risk.source)).not.toContain("model");
    });
  });

  describe("findings", () => {
    const hunk = smallFeatureFiles.flatMap((file) => file.hunks).at(-1);
    const added = hunk?.lines.find((line) => line.kind === "add")?.newLine;
    if (hunk === undefined || added == null) throw new Error("small-feature adds lines");
    const onLine = (side: "new" | "old") => ({
      title: "Serves a stale receipt",
      explanation: "Keyed by order ID alone.",
      lines: { hunkId: hunk.id, side, startLine: added, line: added },
      severity: "major" as const,
      suggestion: ["fixed();"],
      mismatch: null,
      guidance: null,
    });

    it("names the intent's mismatch a finding shows, from the intent it read", async () => {
      const model = new FakeAnalysisModel();
      model.script(
        "intent",
        ok({
          stated: null,
          inferred: { summary: "Adds receipts.", shape: "", behaviorChanges: [], watch: [] },
          mismatches: [
            { kind: "unrequested", description: "Caches receipts.", hunkIds: [hunk.id] },
          ],
        }),
      );
      model.script("findings", ok([{ ...onLine("new"), mismatch: MismatchId.parse("m1") }]));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.findings.map((finding) => finding.mismatch)).toEqual(["m1"]);
    });

    it("keeps a finding wrong only in its suggestion or mismatch, without them", async () => {
      const model = new FakeAnalysisModel();
      const drafts = [{ ...onLine("new"), suggestion: null, mismatch: MismatchId.parse("m9") }];
      model.script("findings", ok(drafts), ok(drafts));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(model.callsTo("findings")[1]?.options).toEqual({
        feedback: ["Finding 1 names m9, which isn't one of the intent's mismatches."],
      });
      expect(analysis.findings).toEqual([
        { ...drafts[0], id: "f1", suggestion: null, mismatch: null },
      ]);
    });

    it("still runs the findings when the intent pass fails, with no mismatch to name", async () => {
      const model = new FakeAnalysisModel();
      model.script("intent", err(modelError("overloaded", "Overloaded")));
      model.script("findings", ok([onLine("new")]));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.modelError?.stage).toBe("intent");
      expect(analysis.stages.findings).toBe("done");
      expect(analysis.findings.map((finding) => finding.mismatch)).toEqual([null]);
    });

    it("keeps a finding whose text runs long as it is, without running the pass again", async () => {
      const model = new FakeAnalysisModel();
      const long = { ...onLine("new"), title: "t".repeat(81), explanation: "e".repeat(301) };
      model.script("findings", ok([long]));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(model.callsTo("findings")).toHaveLength(1);
      expect(analysis.findings).toEqual([{ ...long, id: "f1" }]);
    });
  });

  describe("decisions", () => {
    const draft = (hunkIds: readonly HunkId[]) => ({
      title: "Adds receipts",
      category: "api" as const,
      whyItMatters: "New endpoint.",
      hunkIds,
      lines: null,
    });

    it("drops unknown hunk references after a retry", async () => {
      const model = new FakeAnalysisModel();
      const drafts = [draft([h1, unknownHunk]), draft([unknownHunk]), draft([h2])];
      model.script("decisions", ok(drafts), ok(drafts));
      const { analyze, logger } = setup({ model });
      const analysis = await analyze();

      expect(model.callsTo("decisions")[1]?.options).toEqual({
        feedback: [`${unknownHunk} isn't a hunk of this pull request.`],
      });
      expect(analysis.decisions.map((decision) => [decision.id, decision.hunkIds])).toEqual([
        ["d1", [h1]],
        ["d2", []],
        ["d3", [h2]],
      ]);
      expect(analysis.warnings).toEqual([]);
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "warn",
          message: "Dropped unknown hunk references from decisions",
        }),
      );
    });

    it("keeps a decision's lines only when one of its hunks shows them", async () => {
      const hunk = smallFeatureFiles.flatMap((file) => file.hunks).find((one) => one.id === h2);
      const line = hunk?.lines.find((one) => one.newLine !== null)?.newLine;
      if (line == null) throw new Error("small-feature's second hunk has new lines");
      const lines = { hunkId: h2, side: "new" as const, startLine: line, line };
      const model = new FakeAnalysisModel();
      model.script(
        "decisions",
        ok([
          { ...draft([h2]), lines },
          { ...draft([h1]), lines },
          { ...draft([h2]), lines: { ...lines, startLine: 999, line: 999 } },
        ]),
      );
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.decisions.map((decision) => decision.lines)).toEqual([lines, null, null]);
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

    it("records a model error and keeps the risk", async () => {
      const model = new FakeAnalysisModel();
      model.script("decisions", err(modelError("refusal", "Refused")));
      const { analyze } = setup({ model });
      const analysis = await analyze();
      expect(analysis.modelError).toEqual({
        stage: "decisions",
        code: "model-error",
        message: "Refused",
      });
      expect(analysis.stages).toMatchObject({ risk: "done", decisions: "failed" });
      expect(analysis.risk).toHaveLength(6);
    });
  });

  describe("flows", () => {
    it("shows the code's flows from prep on, before the model passes", async () => {
      const { analyze, store } = setup();
      await analyze();
      const afterPrep = store.saves.find((analysis) => analysis.stages.prep === "done");
      expect(afterPrep?.stages.intent).toBe("pending");
      expect(afterPrep?.flows).not.toBeNull();
    });

    it("keeps the code's flows: the model doesn't title them", async () => {
      const withoutModel = await setup({ modelEnabled: false }).analyze();
      const analysis = await setup().analyze();
      expect(analysis.flows).toEqual(withoutModel.flows);
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
    expect(inProgress(analysis)).toBe(false);
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
    const { useCases, done, preps } = setup();
    const [first, second] = await Promise.all([
      useCases.startAnalysis(url),
      useCases.startAnalysis(url),
    ]);
    expect(first).toEqual(second);
    if (!first?.ok) throw new Error("not started");
    await done(first.value.analysisId);
    expect(await useCases.startAnalysis(url)).toEqual(first);
    expect(preps()).toBe(1);
  });

  it("joins a run in flight", async () => {
    const { useCases, done, preps } = setup();
    const first = await useCases.startAnalysis(url);
    const second = await useCases.startAnalysis(url);
    expect(second).toEqual(first);
    if (!first.ok) throw new Error("not started");
    await done(first.value.analysisId);
    expect(preps()).toBe(1);
  });

  it("runs a failed analysis again under the same ID", async () => {
    const { analyze, clock, github } = setup();
    github.failNext("getFiles", hostError("network"));
    const failed = await analyze();
    expect(failed.status).toBe("failed");
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
    const interrupted: Analysis = { ...complete, status: "running", flows: null };
    const { analyze: analyzeAgain, store: otherStore } = setup({ model });
    await otherStore.saveAnalysis(interrupted);
    const again = await analyzeAgain();
    expect(again.id).toBe(complete.id);
    expect(again.status).toBe("complete");
    expect(model.callsTo("intent")).toHaveLength(2);
    expect(await store.getAnalysis(complete.id)).toEqual(complete);
  });
});

describe("loading the repository's harness", () => {
  const { ref, baseSha, url } = smallFeature.pullRequest;
  const networkError: HostError = {
    kind: "network",
    message: "socket hang up",
    retryAfterSeconds: null,
  };
  const sourceWith = (files: Readonly<Record<string, string>>) => {
    const source = new FakeHarnessSource();
    source.setFiles(ref.repo, baseSha, files);
    return source;
  };
  /** What's stored once the load already running ends: without a source, this starts none. */
  const loaded = async (harnessStore: InMemoryHarnessStore) => {
    const logger = new RecordingLogger();
    await loadHarness({ harnessSource: () => null, harnessStore, logger }, ref.repo, baseSha);
    return harnessStore.getHarness(ref.repo, baseSha);
  };

  it("starts with a new analysis, which doesn't wait for it", async () => {
    const harnessSource = sourceWith({ "CLAUDE.md": "@docs/rules.md", "docs/rules.md": "" });
    const release = harnessSource.hold();
    const { analyze, harnessStore } = setup({ harnessSource, modelEnabled: false });

    const analysis = await analyze();
    expect(analysis.status).toBe("complete");
    expect(await harnessStore.getHarness(ref.repo, baseSha)).toBeNull();

    release();
    const harness = await loaded(harnessStore);
    expect(harness?.files.map((file) => file.path)).toEqual(["CLAUDE.md", "docs/rules.md"]);
  });

  it("asks the source for nothing when the commit's harness is stored", async () => {
    const harnessSource = sourceWith({ "CLAUDE.md": "" });
    const { analyze, harnessStore, useCases } = setup({ harnessSource, modelEnabled: false });
    await analyze();
    expect(await loaded(harnessStore)).toMatchObject({ baseSha });

    await useCases.startAnalysis(url);
    expect(harnessSource.calls.listFiles).toEqual([baseSha]);
  });

  it("starts again for a complete analysis whose harness hadn't loaded", async () => {
    const harnessSource = sourceWith({ "CLAUDE.md": "" });
    harnessSource.failNext("listFiles", networkError);
    const { analyze, harnessStore, useCases, preps } = setup({
      harnessSource,
      modelEnabled: false,
    });
    await analyze();
    expect(await harnessStore.getHarness(ref.repo, baseSha)).toBeNull();

    await useCases.startAnalysis(url);
    expect(await loaded(harnessStore)).toMatchObject({ baseSha });
    expect(preps()).toBe(1);
  });

  it("starts for an analysis that has its callers, whose opening does nothing else", async () => {
    const harnessSource = sourceWith({ "CLAUDE.md": "" });
    harnessSource.failNext("listFiles", networkError);
    const { analyze, harnessStore, store, useCases } = setup({
      harnessSource,
      modelEnabled: false,
    });
    await store.saveAnalysis({ ...(await analyze()), checkout: "read" });

    await useCases.startAnalysis(url);
    expect(await loaded(harnessStore)).toMatchObject({ baseSha });
  });

  it("completes the analysis, without a warning on it, when the load fails", async () => {
    const harnessSource = sourceWith({ "CLAUDE.md": "" });
    harnessSource.failAlways(networkError);
    const { analyze } = setup({ harnessSource });

    const analysis = await analyze();
    expect(analysis).toMatchObject({ status: "complete", error: null, modelError: null });
    expect(analysis.warnings.filter((warning) => warning.includes("hang up"))).toEqual([]);
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
  /** A setup whose first analysis fails fetching the PR's files. */
  const failing = () => {
    const ready = setup();
    ready.github.failNext("getFiles", hostError("network"));
    return ready;
  };

  it("runs a failed analysis again", async () => {
    const { analyze, useCases, done, stored } = failing();
    const failed = await analyze();
    expect(await useCases.retryAnalysis(failed.id)).toEqual(ok({ analysisId: failed.id }));
    await done(failed.id, 2);
    expect((await stored(failed.id)).status).toBe("complete");
  });

  it("analyzes the new commits under a new ID when the PR changed", async () => {
    const { analyze, useCases, github, done, stored } = failing();
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
    const { analyze, useCases, github } = failing();
    const failed = await analyze();
    github.failNext("getPullRequest", hostError("unauthorized"));
    expect(await useCases.retryAnalysis(failed.id)).toEqual(
      err({ code: "host-error", message: "unauthorized from host" }),
    );
  });
});

describe("without the model", () => {
  it("completes after prep, with rule risk and the call-graph flows, and calls no model", async () => {
    const { analyze, model, emitted } = setup({ modelEnabled: false });
    const analysis = await analyze();

    expect(model.calls).toEqual([]);
    expect(analysis.status).toBe("complete");
    expect(analysis.error).toBeNull();
    expect(analysis.stages).toEqual({
      collect: "done",
      prep: "done",
      intent: "skipped",
      findings: "skipped",
      risk: "skipped",
      decisions: "skipped",
      steps: "skipped",
    });
    expect(analysis.key.pipelineVersion).toBe("20");
    expect(analysis.intent).toBeNull();
    expect(analysis.decisions).toEqual([]);
    expect(analysis.usage).toEqual([]);
    expect(analysis.risk.map((risk) => [risk.hunkId, risk.source])).toEqual(
      smallFeatureHunks.map((hunkId) => [hunkId, "rule"]),
    );
    expect(analysis.flows).not.toBeNull();
    placesEveryPartOnce(analysis);
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
      placesEveryPartOnce(analysis);
      for (const hint of analysis.callGraph) {
        expect([known.has(hint.fromPartId), known.has(hint.toPartId)]).toEqual([true, true]);
      }
      for (const site of analysis.callSites) {
        expect([site.partId, ...site.toPartIds].filter((id) => !known.has(id))).toEqual([]);
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
        checkouts: new FakeLocalCheckouts({
          checkout: checkout(),
          dir: "/src/shop",
          namesRepo: true,
        }),
      });
      const analysis = await analyze();
      expect(analysis.status).toBe("complete");
      expect(analysis.checkout).toBe("read");
      expect(analysis.checkoutDir).toBe("/src/shop");
      expect(analysis.key.pipelineVersion).toBe("20");
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
    const reader = checkout({
      "scripts/tool.py": "ordersRouter = 1",
      "src/other.ts": "x",
      "src/long.ts": "ordersRouters",
    });
    const parser = new FakeCodeParser();
    const { analyze } = setup({
      modelEnabled: false,
      parser,
      checkouts: new FakeLocalCheckouts({ checkout: reader, dir: "/src/shop", namesRepo: true }),
    });
    await analyze();
    expect(reader.reads).toEqual([["src/admin.ts", "src/app.ts", "src/long.ts"]]);
    const parsed = parser.calls
      .filter((call) => call.method === "symbols")
      .map((call) => call.source);
    expect(parsed).toContain(appLines.join("\n"));
    expect(parsed).not.toContain("x");
    expect(parsed).not.toContain("ordersRouters");
  });

  it("warns about files too large to read, and about a checkout it can't read", async () => {
    const big = `ordersRouter ${"x".repeat(1024 * 1024)}`;
    const { analyze } = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts({
        checkout: checkout({
          "src/big.ts": big,
          "src/huge.ts": big,
          // Names nothing the PR changes, so no caller in it could be missing.
          "src/other.ts": "x".repeat(1024 * 1024 + 1),
        }),
        dir: "/src/shop",
        namesRepo: true,
      }),
    });
    expect((await analyze()).warnings).toContain(
      "2 files in the local checkout are over 1 MB, so callers in them aren't shown.",
    );

    const failing = checkout();
    failing.filesMentioning = async () => err({ kind: "failed", message: "git grep failed: boom" });
    const second = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts({ checkout: failing, dir: "/src/shop", namesRepo: true }),
    });
    const analysis = await second.analyze();
    expect(analysis.status).toBe("complete");
    expect(analysis.unchangedCallers).toEqual([]);
    expect(analysis.warnings).toContain("Couldn't read the local checkout: git grep failed: boom");
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
        checkouts: new FakeLocalCheckouts({ checkout: reader, dir: "/src/shop", namesRepo }),
      });
      const analysis = await analyze();
      expect(analysis.checkout).toBe(status);
      expect(analysis.checkoutDir).toBe(namesRepo ? "/src/shop" : null);
      expect(analysis.key.pipelineVersion).toBe("20");
      expect(analysis.unchangedCallers).toEqual([]);
      expect(reader.reads).toEqual([]);
    },
  );

  it("says none was found without a checkout", async () => {
    const { analyze } = setup({ modelEnabled: false });
    expect((await analyze()).checkout).toBe("none");
  });

  it("says what's on the machine now when a PR is opened again, changing nothing else", async () => {
    const clones: FoundCheckout[] = [];
    const { analyze, useCases, stored } = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts(null, { clones }),
    });
    const analysis = await analyze();
    expect(analysis.checkoutDir).toBeNull();

    clones.push({ checkout: new FakeLocalCheckout({}), dir: "/src/shop", namesRepo: true });
    const again = await useCases.startAnalysis(smallFeature.pullRequest.url);
    expect(again).toEqual({ ok: true, value: { analysisId: analysis.id } });
    expect(await stored(analysis.id)).toEqual({
      ...analysis,
      checkout: "missing-commit",
      checkoutDir: "/src/shop",
    });
  });

  it("reads a clone found after the folder pointed at, and remembers it for the next start", async () => {
    const clone = { checkout: checkout(), dir: "/src/shop", namesRepo: true };
    const checkouts = new FakeLocalCheckouts(null, { clones: [clone] });
    const { analyze, runModel } = setup({ modelEnabled: false, checkouts });
    const analysis = await analyze();
    expect(analysis.checkout).toBe("read");
    expect(analysis.checkoutDir).toBe("/src/shop");
    expect(checkouts.asked).toEqual(["pointedAt", "search"]);
    await runModel(analysis.id);
    expect(checkouts.asked.slice(2)).toEqual(["pointedAt", "at /src/shop"]);
  });
});

describe("callers brought to a complete analysis", () => {
  const { headSha, ref, url } = smallFeature.pullRequest;
  const big = `ordersRouter ${"x".repeat(1024 * 1024)}`;
  const repositoryFiles = {
    ...smallFeature.headFiles,
    "src/app.ts": [
      'import { ordersRouter } from "./routes/orders.ts";',
      'app.use("/api", ordersRouter);',
    ].join("\n"),
  };
  const commits = { [headSha]: repositoryFiles };
  const downloads = (files: Readonly<Record<string, string>> = repositoryFiles) =>
    new FakeRepositoryCopies({ commits: { [headSha]: files }, downloadFolder: "/copies" });
  const COPY = `/copies/github/${ref.repo.owner}/${ref.repo.repo}.git`;

  /** A model whose intent pass waits until it's let go. */
  class HeldModel extends FakeAnalysisModel {
    private readonly gate = Promise.withResolvers<void>();
    release = () => this.gate.resolve();
    override async intent(...args: Parameters<FakeAnalysisModel["intent"]>) {
      await this.gate.promise;
      return super.intent(...args);
    }
  }

  /** Lets everything that can run without a timer run. */
  const settle = async () => {
    for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
  };

  /** A PR opened with downloads on, its review complete and the download held. */
  const opened = async (
    options: Parameters<typeof setup>[0] & { copies: FakeRepositoryCopies },
  ) => {
    const release = options.copies.hold();
    const ready = setup({ modelEnabled: false, ...options });
    const started = await ready.useCases.startAnalysis(url);
    if (!started.ok) throw new Error(started.error.message);
    await settle();
    const id = started.value.analysisId;
    return { ...ready, id, release, before: await ready.stored(id) };
  };

  const usesOf = (analysis: Analysis) =>
    analysis.unchangedCallers.flatMap(({ symbol, uses }) =>
      uses.map((use) => `${symbol} ${use.path}:${use.line}`),
    );
  const USES = ["ordersRouter src/app.ts:2"];

  it("opens the review without them, then adds them under the same ID", async () => {
    const copies = downloads();
    const { id, before, release, stored, done, doneCount, emitted } = await opened({ copies });
    expect(before.status).toBe("complete");
    expect(before.checkout).toBe("downloading");
    expect(before.unchangedCallers).toEqual([]);
    expect(following(before)).toBe(true);
    // The page reads the review now, and goes on following for the callers.
    expect(doneCount(id)).toBe(0);
    expect(emitted.at(-1)?.event).toEqual({ type: "updated", stage: "prep", status: "done" });

    release();
    await done(id);
    const after = await stored(id);
    expect(usesOf(after)).toEqual(USES);
    expect(following(after)).toBe(false);
    expect(after).toEqual({
      ...before,
      checkout: "read",
      checkoutDir: COPY,
      unchangedCallers: after.unchangedCallers,
    });
    expect(doneCount(id)).toBe(1);
  });

  it("changes nothing but the callers, the checkout and its warnings", async () => {
    const copies = downloads({ ...repositoryFiles, "src/big.ts": big });
    const { id, before, release, stored, done } = await opened({ copies });
    release();
    await done(id);
    const after = await stored(id);
    const WARNING = "1 file in the local checkout is over 1 MB, so callers in it aren't shown.";
    expect(after).toEqual({
      ...before,
      checkout: "read",
      checkoutDir: COPY,
      unchangedCallers: after.unchangedCallers,
      warnings: [...before.warnings, WARNING],
    });
  });

  it("has the same callers as an analysis that read a checkout from the start", async () => {
    const checkouts = new FakeLocalCheckouts({
      checkout: new FakeLocalCheckout(commits),
      dir: "/src/shop",
      namesRepo: true,
    });
    const whole = await setup({ modelEnabled: false, checkouts }).analyze();
    const brought = await setup({ modelEnabled: false, copies: downloads() }).analyze();
    expect(brought).toEqual({ ...whole, checkoutDir: COPY, filesFetched: brought.filesFetched });
  });

  it("starts downloading only once the code's stages have ended", async () => {
    const copies = downloads();
    const { analyze, emitted } = setup({ modelEnabled: false, copies });
    const original = copies.download.bind(copies);
    let stagesEnded = false;
    copies.download = (...args) => {
      stagesEnded = emitted.some(
        ({ event }) => event.type === "updated" && event.stage === "decisions",
      );
      return original(...args);
    };
    await analyze();
    expect(stagesEnded).toBe(true);
  });

  it("downloads nothing for an analysis that failed", async () => {
    const copies = downloads();
    const { github, useCases, done } = setup({ modelEnabled: false, copies });
    github.failNext("getFiles", hostError("unauthorized"));
    const started = await useCases.startAnalysis(url);
    if (!started.ok) throw new Error(started.error.message);
    await done(started.value.analysisId);
    await settle();
    expect(copies.downloads).toBe(0);
  });

  it("uses a copy that has the commit at once", async () => {
    const copies = downloads();
    await copies.download(ref.repo, headSha);
    const analysis = await setup({ modelEnabled: false, copies }).analyze();
    expect(analysis.checkout).toBe("read");
    expect(analysis.checkoutDir).toBe(COPY);
    expect(usesOf(analysis)).toEqual(USES);
    expect(copies.downloads).toBe(1);
  });

  it("downloads once for a PR opened twice meanwhile", async () => {
    const copies = downloads();
    const { useCases, id, release, done } = await opened({ copies });
    const again = await useCases.startAnalysis(url);
    expect(again).toEqual({ ok: true, value: { analysisId: id } });
    release();
    await done(id);
    expect(copies.asked.filter((one) => one.startsWith("download"))).toHaveLength(1);
  });

  it("reads a clone that has the commit by the time the PR is opened again", async () => {
    const clones: FoundCheckout[] = [];
    const { analyze, useCases, stored, preps } = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts(null, { clones }),
    });
    const before = await analyze();
    expect(before.checkout).toBe("none");

    // The reviewer ran git fetch.
    clones.push({ checkout: new FakeLocalCheckout(commits), dir: "/src/shop", namesRepo: true });
    const [again, twice] = await Promise.all([
      useCases.startAnalysis(url),
      useCases.startAnalysis(url),
    ]);
    expect([again, twice]).toEqual(
      Array.from({ length: 2 }, () => ({ ok: true, value: { analysisId: before.id } })),
    );
    await settle();
    const after = await stored(before.id);
    expect(usesOf(after)).toEqual(USES);
    expect(after).toEqual({
      ...before,
      checkout: "read",
      checkoutDir: "/src/shop",
      unchangedCallers: after.unchangedCallers,
    });
    expect(preps()).toBe(1);
  });

  it("downloads when a complete analysis without callers is opened", async () => {
    const before = await setup({ modelEnabled: false }).analyze();
    const { id } = before;
    // As one an earlier version stored, with a clone that lacks the commit.
    const old = { ...before, checkout: "missing-commit" as const, checkoutDir: "/src/old" };
    const second = setup({
      modelEnabled: false,
      copies: downloads(),
      checkouts: new FakeLocalCheckouts({
        checkout: new FakeLocalCheckout({}),
        dir: "/src/shop",
        namesRepo: true,
      }),
    });
    await second.store.saveAnalysis(old);
    await second.useCases.startAnalysis(url);
    expect((await second.stored(id)).checkout).toBe("downloading");
    // The clone it lacks stays named, for a download that fails.
    expect((await second.stored(id)).checkoutDir).toBe("/src/shop");
    await second.done(id);
    expect(usesOf(await second.stored(id))).toEqual(USES);
  });

  describe("an analysis stored while the key said a checkout was read", () => {
    const storedAs = async (changes: Partial<Analysis>) => {
      const ready = setup({ modelEnabled: false });
      const made = await setup({ modelEnabled: false }).analyze();
      const key = { ...made.key, pipelineVersion: "20+checkout" };
      const old: Analysis = { ...made, id: analysisId(key), key, ...changes };
      await ready.store.saveAnalysis(old);
      return { ...ready, made, old };
    };

    it("is found, and stays as it is", async () => {
      const { useCases, old, stored, preps } = await storedAs({
        checkout: "read",
        checkoutDir: "/src/shop",
      });
      const again = await useCases.startAnalysis(url);
      expect(again).toEqual({ ok: true, value: { analysisId: old.id } });
      expect(await stored(old.id)).toEqual(old);
      expect(preps()).toBe(0);
    });

    it("runs again under its own ID when it failed", async () => {
      const { useCases, old, done, stored } = await storedAs({ status: "failed" });
      const again = await useCases.startAnalysis(url);
      expect(again).toEqual({ ok: true, value: { analysisId: old.id } });
      await done(old.id);
      expect((await stored(old.id)).status).toBe("complete");
    });

    it.each([
      ["2026-10-22T09:00:00Z", "complete", true],
      ["2026-10-20T09:00:00Z", "complete", false],
      ["2026-10-22T09:00:00Z", "failed", false],
    ] as const)(
      "beside one under the plain key: the complete one, then the one changed last (%s, %s)",
      async (updatedAt, status, expected) => {
        const { useCases, store, made, old } = await storedAs({
          checkout: "read",
          status,
          updatedAt,
        });
        await store.saveAnalysis({ ...made, checkout: "read" });
        const again = await useCases.startAnalysis(url);
        expect(again.ok && again.value.analysisId === old.id).toBe(expected);
      },
    );
  });

  describe("with a model run", () => {
    it("waits for the run in flight, and reads the PR without them", async () => {
      const model = new HeldModel();
      const copies = downloads({ ...repositoryFiles, "src/big.ts": big });
      const { useCases, id, release, stored, done, doneCount } = await opened({ copies, model });
      await useCases.runModel(id);
      release();
      await settle();
      const during = await stored(id);
      expect(during.checkout).toBe("downloading");
      expect(during.unchangedCallers).toEqual([]);

      model.release();
      await done(id);
      const after = await stored(id);
      expect(after.intent).not.toBeNull();
      expect(usesOf(after)).toEqual(USES);
      // The run's end isn't the analysis's: the callers are still to come.
      expect(doneCount(id)).toBe(1);
      const inputs = model.callsTo("intent").map(({ input }) => JSON.stringify(input));
      expect(inputs.some((input) => input.includes("src/app.ts"))).toBe(false);

      // Remove AI review keeps the callers and what couldn't be read of them.
      const WARNING = "1 file in the local checkout is over 1 MB, so callers in it aren't shown.";
      expect(after.warnings).toContain(WARNING);
      const removed = await useCases.removeModelRun(id);
      expect(removed.ok && removed.value.analysis.warnings).toContain(WARNING);
      expect(removed.ok && usesOf(removed.value.analysis)).toEqual(USES);
      expect(removed.ok && removed.value.analysis.checkout).toBe("read");
    });

    it("loses nothing of either when they're written while the run is about to start", async () => {
      const { useCases, models, id, release, stored, done } = await opened({
        copies: downloads(),
      });
      // The run has read the analysis, and asks which models there are.
      const asked = Promise.withResolvers<void>();
      const answer = Promise.withResolvers<void>();
      const options = models.options.bind(models);
      models.options = async () => {
        asked.resolve();
        await answer.promise;
        return options();
      };
      const running = useCases.runModel(id);
      await asked.promise;
      release();
      await settle();
      expect(usesOf(await stored(id))).toEqual(USES);
      answer.resolve();
      await running;
      await done(id, 2);
      await settle();
      const after = await stored(id);
      expect(after.intent).not.toBeNull();
      expect(usesOf(after)).toEqual(USES);
      expect(after.checkout).toBe("read");
      expect((await useCases.removeModelRun(id)).ok).toBe(true);
      expect(usesOf(await stored(id))).toEqual(USES);
    });

    it("starts from the analysis with them when they're being written", async () => {
      const { useCases, store, id, release, stored, done } = await opened({ copies: downloads() });
      // The write has started, and the run and a second one are asked for before it ends.
      const save = store.saveAnalysis.bind(store);
      const writing = Promise.withResolvers<void>();
      const written = Promise.withResolvers<void>();
      store.saveAnalysis = async (analysis) => {
        writing.resolve();
        await written.promise;
        await save(analysis);
      };
      release();
      await writing.promise;
      store.saveAnalysis = save;
      const runs = [useCases.runModel(id), useCases.runModel(id)];
      await settle();
      const third = useCases.runModel(id);
      await settle();
      written.resolve();
      for (const run of [...runs, third]) {
        expect(await run).toEqual({ ok: true, value: { analysisId: id } });
      }
      await done(id);
      await settle();
      const after = await stored(id);
      expect(after.intent).not.toBeNull();
      expect(usesOf(after)).toEqual(USES);
    });

    it("isn't started twice by a request that waited while another ran", async () => {
      const { useCases, models, id, release, runModel } = await opened({ copies: downloads() });
      const answer = Promise.withResolvers<void>();
      const options = models.options.bind(models);
      models.options = async () => {
        await answer.promise;
        return options();
      };
      const late = useCases.runModel(id);
      await settle();
      models.options = options;
      release();
      await settle();
      await runModel(id);
      answer.resolve();
      expect(await late).toMatchObject({ ok: false, error: { code: "analysis-not-complete" } });
    });

    it("doesn't keep a PR opened during the run waiting", async () => {
      const model = new HeldModel();
      const clones: FoundCheckout[] = [];
      const ready = setup({
        modelEnabled: false,
        model,
        checkouts: new FakeLocalCheckouts(null, { clones }),
      });
      const { id } = await ready.analyze();
      clones.push({ checkout: new FakeLocalCheckout(commits), dir: "/src/shop", namesRepo: true });
      // Opened, and the run asked for before the callers are read.
      const opening = ready.useCases.startAnalysis(url);
      await ready.useCases.runModel(id);
      expect(await opening).toEqual({ ok: true, value: { analysisId: id } });
      model.release();
      await settle();
      expect((await ready.stored(id)).intent).not.toBeNull();
    });

    it("that's removed during a download leaves the download going", async () => {
      const { useCases, id, release, stored, done } = await opened({ copies: downloads() });
      await useCases.runModel(id);
      await settle();
      const removed = await useCases.removeModelRun(id);
      expect(removed.ok && removed.value.analysis.checkout).toBe("downloading");
      release();
      await done(id);
      expect(usesOf(await stored(id))).toEqual(USES);
      expect((await stored(id)).intent).toBeNull();
    });
  });

  it("says why a download failed, with the review complete, and tries again when opened", async () => {
    const copies = downloads();
    copies.failNext({ kind: "refused", message: "GitHub didn't let megareviewer download it." });
    const { analyze, useCases, stored, done } = setup({ modelEnabled: false, copies });
    const failed = await analyze();
    expect(failed.status).toBe("complete");
    expect(failed.checkout).toBe("download-failed");
    expect(failed.checkoutError).toBe("GitHub didn't let megareviewer download it.");
    expect(following(failed)).toBe(false);

    await useCases.startAnalysis(url);
    expect((await stored(failed.id)).checkoutError).toBeNull();
    await done(failed.id, 2);
    expect(usesOf(await stored(failed.id))).toEqual(USES);
    expect(copies.downloads).toBe(2);
  });

  it("says when the pull request can't be read again after the download", async () => {
    class ForgetfulCache extends InMemoryFileCache {
      forgetting = false;
      override async get(...args: Parameters<InMemoryFileCache["get"]>) {
        return this.forgetting ? null : super.get(...args);
      }
    }
    const fileCache = new ForgetfulCache();
    const { github, id, release, stored, done } = await opened({ copies: downloads(), fileCache });
    fileCache.forgetting = true;
    github.failAlways(hostError("network"));
    release();
    await done(id);
    expect(await stored(id)).toMatchObject({
      status: "complete",
      checkout: "download-failed",
      checkoutError: expect.stringContaining("The repository was downloaded, but"),
    });
  });

  it("says when a bug stopped it, and leaves a review that wasn't downloading as it is", async () => {
    const copies = downloads();
    copies.download = async () => {
      throw new Error("boom");
    };
    const { analyze, logger } = setup({ modelEnabled: false, copies });
    const analysis = await analyze();
    expect(analysis.checkout).toBe("download-failed");
    expect(analysis.checkoutError).toContain("internal error");
    expect(logger.entries.some((entry) => entry.message.includes("callers"))).toBe(true);

    const clones: FoundCheckout[] = [];
    const broken = setup({
      modelEnabled: false,
      checkouts: new FakeLocalCheckouts(null, { clones }),
    });
    const before = await broken.analyze();
    const checkout = new FakeLocalCheckout(commits);
    checkout.filesMentioning = async () => {
      throw new Error("boom");
    };
    clones.push({ checkout, dir: "/src/shop", namesRepo: true });
    await broken.useCases.startAnalysis(url);
    expect(await broken.stored(before.id)).toEqual(before);
  });

  it("logs a failure to record it", async () => {
    const { release, store, logger } = await opened({ copies: downloads() });
    store.saveAnalysis = async () => {
      throw new Error("disk full");
    };
    release();
    await settle();
    expect(
      logger.entries.filter((entry) => entry.message === "Couldn't record an analysis's callers"),
    ).toHaveLength(1);
  });

  it("does nothing for an analysis that's gone", async () => {
    const { release, store, emitted } = await opened({ copies: downloads() });
    const count = emitted.length;
    store.getAnalysis = async () => null;
    release();
    await settle();
    expect(emitted).toHaveLength(count);
  });

  it("stopped with megareviewer, is set back at the next start and starts again when opened", async () => {
    const copies = downloads();
    copies.failNext({ kind: "stopped", message: "megareviewer was stopped." });
    const { id, release, stored, useCases } = await opened({ copies });
    // The one going in this process is left alone.
    await useCases.recoverInterruptedAnalyses();
    expect((await stored(id)).checkout).toBe("downloading");
    release();
    await settle();
    const left = await stored(id);
    expect(left.checkout).toBe("downloading");

    const next = setup({ modelEnabled: false, copies: downloads() });
    await next.store.saveAnalysis(left);
    expect(await next.useCases.recoverInterruptedAnalyses()).toBe(0);
    expect(await next.stored(id)).toEqual({ ...left, checkout: "none" });
    await next.useCases.startAnalysis(url);
    await next.done(id);
    expect(usesOf(await next.stored(id))).toEqual(USES);

    const named = setup({ modelEnabled: false });
    await named.store.saveAnalysis({ ...left, checkoutDir: "/src/shop" });
    await named.useCases.recoverInterruptedAnalyses();
    expect((await named.stored(id)).checkout).toBe("missing-commit");
  });

  it("forgets old copies through the use cases", async () => {
    const copies = downloads();
    const { useCases } = setup({ copies });
    expect(await useCases.forgetOldCopies()).toBe(0);
  });
});

describe("runModel", () => {
  const codeOnly = async (options: Parameters<typeof setup>[0] = {}) => {
    const ready = setup({ ...options, modelEnabled: false });
    return { ...ready, analysis: await ready.analyze() };
  };

  it("adds the model's results to the code's analysis, keeping its ID", async () => {
    const { analysis, runModel, model } = await codeOnly();
    expect(analysis.intent).toBeNull();
    const after = await runModel(analysis.id);
    expect(after.id).toBe(analysis.id);
    expect(after.status).toBe("complete");
    expect(after.intent).not.toBeNull();
    expect(after.decisions).toHaveLength(3);
    expect(after.flows).not.toBeNull();
    expect(Object.values(after.stages)).toEqual([...Array(6).fill("done"), "skipped"]);
    expect(model.callsTo("intent")).toHaveLength(1);
  });

  it("runs again after a failure, clearing the error", async () => {
    const model = new FakeAnalysisModel();
    model.script("intent", err(modelError("overloaded", "Overloaded")));
    const { analysis, runModel } = await codeOnly({ model });
    const failed = await runModel(analysis.id);
    expect(failed.modelError?.message).toBe("Overloaded");
    const again = await runModel(analysis.id);
    expect(again.modelError).toBeNull();
    expect(again.stages.decisions).toBe("done");
  });

  it("refuses what it can't run, and says why", async () => {
    const { analysis, useCases, runModel } = await codeOnly();
    await runModel(analysis.id);
    expect(await useCases.runModel(analysis.id)).toEqual(
      err({ code: "bad-request", message: "Claude has already analyzed this pull request" }),
    );
    expect(await useCases.runModel(AnalysisId.parse("a_0000000000000000"))).toEqual(
      err({ code: "not-found", message: "No analysis a_0000000000000000" }),
    );

    const unavailable = await codeOnly({
      modelOptions: [
        fakeModelOption({
          available: false,
          reason: "Claude Code isn't signed in: run `claude` and sign in",
        }),
      ],
    });
    expect(await unavailable.useCases.runModel(unavailable.analysis.id)).toEqual(
      err({
        code: "model-unavailable",
        message:
          "Sonnet 5.5 through Claude Code can't run: Claude Code isn't signed in: run `claude` and sign in",
      }),
    );
    expect(unavailable.model.calls).toEqual([]);
  });

  it("runs on the option asked for, and records it on the analysis", async () => {
    const haiku = fakeModelOption({ model: "claude-haiku-5-5", modelName: "Haiku 5.5" });
    const { analysis, runModel, models } = await codeOnly({
      modelOptions: [haiku, fakeModelOption()],
    });
    const after = await runModel(analysis.id, haiku.id);
    expect(after.modelOption).toEqual({
      provider: "claude-code",
      providerName: "Claude Code",
      model: "claude-haiku-5-5",
      modelName: "Haiku 5.5",
      family: "Claude",
    });
    expect(models.asked).toBe(1);
  });

  it("runs on the default without a choice", async () => {
    const { analysis, runModel } = await codeOnly();
    expect((await runModel(analysis.id)).modelOption?.model).toBe("claude-sonnet-5-5");
  });

  it("runs without a choice on the option last used, while it can run", async () => {
    const haiku = fakeModelOption({ model: "claude-haiku-5-5", modelName: "Haiku 5.5" });
    const { analysis, runModel, useCases, models, store } = await codeOnly({
      modelOptions: [fakeModelOption(), haiku],
    });
    expect((await useCases.getStatus()).model.defaultId).toBe("claude-code/claude-sonnet-5-5");

    await runModel(analysis.id, haiku.id);
    expect(await store.getLastModelOption()).toBe(haiku.id);
    expect((await useCases.getStatus()).model.defaultId).toBe(haiku.id);
    expect((await useCases.removeModelRun(analysis.id)).ok).toBe(true);
    expect((await runModel(analysis.id)).modelOption?.model).toBe("claude-haiku-5-5");

    models.setOptions([fakeModelOption(), { ...haiku, available: false, reason: "signed out" }]);
    expect((await useCases.getStatus()).model.defaultId).toBe("claude-code/claude-sonnet-5-5");
  });

  it("doesn't remember an option it refused", async () => {
    const { analysis, useCases, store } = await codeOnly();
    await useCases.runModel(analysis.id, "claude-code/claude-nothing");
    expect(await store.getLastModelOption()).toBeNull();
  });

  it("refuses an option it doesn't know, and one that can't run, with why", async () => {
    const api = fakeModelOption({
      provider: "anthropic-api",
      providerName: "Anthropic API",
      available: false,
      reason: "No Anthropic API credentials",
    });
    const { analysis, useCases, model } = await codeOnly({
      modelOptions: [fakeModelOption(), api],
    });
    expect(await useCases.runModel(analysis.id, "claude-code/claude-nothing")).toEqual(
      err({ code: "bad-request", message: "No model option claude-code/claude-nothing" }),
    );
    expect(await useCases.runModel(analysis.id, api.id)).toEqual(
      err({
        code: "model-unavailable",
        message: "Sonnet 5.5 through Anthropic API can't run: No Anthropic API credentials",
      }),
    );
    expect(model.calls).toEqual([]);
  });

  it("refuses to run when no model is known", async () => {
    const { analysis, useCases } = await codeOnly({ modelOptions: [] });
    expect(await useCases.runModel(analysis.id)).toEqual(
      err({ code: "model-unavailable", message: "No model is known to megareviewer" }),
    );
  });

  it("refuses an analysis that isn't complete", async () => {
    const { useCases, store, analysis } = await codeOnly();
    await store.saveAnalysis({ ...analysis, status: "failed" });
    expect(await useCases.runModel(analysis.id)).toEqual(
      err({ code: "analysis-not-complete", message: "The analysis isn't complete yet" }),
    );
  });

  it("joins a run in flight", async () => {
    const { analysis, useCases, done, model } = await codeOnly();
    const [first, second] = await Promise.all([
      useCases.runModel(analysis.id),
      useCases.runModel(analysis.id),
    ]);
    expect(first).toEqual(ok({ analysisId: analysis.id }));
    expect(second).toEqual(first);
    await done(analysis.id, 2);
    expect(model.callsTo("intent")).toHaveLength(1);
  });

  it("is failed by recovery when a stop interrupted it, leaving the analysis complete", async () => {
    const { analysis, useCases, store } = await codeOnly();
    await store.saveAnalysis({
      ...analysis,
      stages: { ...analysis.stages, intent: "running", risk: "pending" },
    });
    expect(await useCases.recoverInterruptedAnalyses()).toBe(1);
    const recovered = await store.getAnalysis(analysis.id);
    expect(recovered?.status).toBe("complete");
    expect(recovered?.stages).toMatchObject({ intent: "failed", risk: "skipped" });
    expect(recovered?.modelError).toEqual({
      stage: "intent",
      code: "interrupted",
      message: "megareviewer stopped while Claude analyzed the pull request",
    });
    expect(recovered !== undefined && recovered !== null && modelRunnable(recovered)).toBe(true);
  });
});

describe("a run with the tour", () => {
  const codeOnly = async (model = new FakeAnalysisModel()) => {
    const ready = setup({ modelEnabled: false, model });
    return { ...ready, analysis: await ready.analyze() };
  };

  /** Lines of the small-feature hunk in `path`, on its head side. */
  const lines = (analysis: Analysis, path: string, startLine: number, line: number) => {
    const hunk = analysis.files.find((file) => file.path === path)?.hunks.at(-1);
    if (hunk === undefined) throw new Error(`small-feature changes ${path}`);
    return { hunkId: hunk.id, side: "new" as const, startLine, line };
  };

  const tourOf = (analysis: Analysis) => [
    {
      sentence: "The route sends a receipt",
      excerpts: [lines(analysis, "src/routes/orders.ts", 33, 40)],
    },
    {
      sentence: "A receipt is cached for an hour",
      excerpts: [lines(analysis, "src/services/receipts.ts", 8, 19)],
    },
    {
      sentence: "The config adds a footer",
      excerpts: [lines(analysis, "config/app.yaml", 31, 35)],
    },
  ];

  it("never runs the steps pass, nor tells the passes of a tour, when the run doesn't ask", async () => {
    const { analysis, runModel, model } = await codeOnly();
    const after = await runModel(analysis.id);
    expect(model.callsTo("steps")).toEqual([]);
    expect(model.calls.filter((call) => call.options?.tour !== undefined)).toEqual([]);
    expect(after.stages.steps).toBe("skipped");
    expect(after.steps).toBeNull();
    expect(after.usage.map((usage) => usage.pass)).not.toContain("steps");
  });

  it("keeps the steps, numbered, and tells every pass of the run the tour was asked for", async () => {
    const model = new FakeAnalysisModel();
    const { analysis, runModel } = await codeOnly(model);
    model.script("steps", ok(tourOf(analysis)));
    const after = await runModel(analysis.id, undefined, true);
    expect(after.stages.steps).toBe("done");
    expect(after.steps?.map((step) => [step.id, step.sentence])).toEqual([
      ["t1", "The route sends a receipt"],
      ["t2", "A receipt is cached for an hour"],
      ["t3", "The config adds a footer"],
    ]);
    expect(after.stepsError).toBeNull();
    expect(after.modelError).toBeNull();
    const passes = model.calls.filter((call) => call.pass !== "checkSize");
    expect(passes.map((call) => call.options?.tour)).toEqual(passes.map(() => true));
    expect(after.usage.map((usage) => usage.pass)).toContain("steps");
  });

  it("is no tour when the model answers fewer than three steps", async () => {
    const model = new FakeAnalysisModel();
    const { analysis, runModel } = await codeOnly(model);
    model.script("steps", ok(tourOf(analysis).slice(0, 2)));
    const after = await runModel(analysis.id, undefined, true);
    expect(after.stages.steps).toBe("done");
    expect(after.steps).toEqual([]);
    expect(after.stepsError).toBeNull();
    expect(model.callsTo("steps")).toHaveLength(1);
  });

  it("tells the model what the checks found once, then repairs what's left", async () => {
    const model = new FakeAnalysisModel();
    const { analysis, runModel } = await codeOnly(model);
    const outside = lines(analysis, "src/services/receipts.ts", 30, 31);
    const wrong = [...tourOf(analysis), { sentence: "Past the hunk", excerpts: [outside] }];
    model.script("steps", ok(wrong), ok(wrong));
    const after = await runModel(analysis.id, undefined, true);
    expect(model.callsTo("steps")[1]?.options?.feedback).toEqual([
      `Step 4's excerpt 1 has lines ${outside.hunkId} doesn't show on that side.`,
    ]);
    expect(after.steps).toHaveLength(3);
    expect(after.modelCalls.filter((call) => call.pass === "steps")).toHaveLength(2);
  });

  it("is the tour's error, never the run's, when the pass fails or the checks leave too few", async () => {
    const failing = new FakeAnalysisModel();
    failing.script("steps", err(modelError("overloaded", "Overloaded")));
    const first = await codeOnly(failing);
    const failed = await first.runModel(first.analysis.id, undefined, true);
    expect(failed.stages.steps).toBe("failed");
    expect(failed.stepsError).toEqual({
      stage: "steps",
      code: "model-error",
      message: "Overloaded",
    });
    expect(failed.modelError).toBeNull();
    expect(failed.stages.decisions).toBe("done");

    const sparse = new FakeAnalysisModel();
    const second = await codeOnly(sparse);
    const [route, receipts] = tourOf(second.analysis);
    const outside = {
      sentence: "Outside",
      excerpts: [lines(second.analysis, "config/app.yaml", 90, 91)],
    };
    const answer = [route, receipts, outside, outside].flatMap((step) => step ?? []);
    sparse.script("steps", ok(answer), ok(answer));
    const left = await second.runModel(second.analysis.id, undefined, true);
    expect(left.stages.steps).toBe("failed");
    expect(left.stepsError?.message).toBe(
      "Only 2 of the tour's 4 steps showed lines of this pull request, and a tour needs 3",
    );
    expect(left.modelError).toBeNull();
  });

  it("goes with the run when it's removed", async () => {
    const model = new FakeAnalysisModel();
    const { analysis, runModel, useCases } = await codeOnly(model);
    model.script("steps", ok(tourOf(analysis)));
    await runModel(analysis.id, undefined, true);
    const removed = await useCases.removeModelRun(analysis.id);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(removed.value.analysis.steps).toBeNull();
    expect(removed.value.analysis.stages.steps).toBe("skipped");
  });

  it("fails only the tour when a step leaves it being written", async () => {
    const { analysis, useCases, store, clock } = await codeOnly();
    const ran: Analysis = {
      ...analysis,
      stages: {
        ...analysis.stages,
        intent: "done",
        findings: "done",
        risk: "done",
        decisions: "done",
        steps: "running",
      },
    };
    await store.saveAnalysis(ran);
    clock.advance(1000);
    expect(await useCases.recoverInterruptedAnalyses()).toBe(1);
    const recovered = await store.getAnalysis(analysis.id);
    expect(recovered?.stages.steps).toBe("failed");
    expect(recovered?.modelError).toBeNull();
    expect(recovered?.stepsError?.code).toBe("interrupted");
  });
});

describe("a model run's guidance", () => {
  const { repo } = smallFeature.pullRequest.ref;
  const { baseSha } = smallFeature.pullRequest;
  let made = 0;
  const preference = (overrides: Partial<Preference>): Preference => {
    made += 1;
    return {
      id: PreferenceId.parse(`pref_${made.toString(16).padStart(16, "0")}`),
      kind: "look-for",
      text: "Tenant isolation",
      scope: { kind: "global" },
      source: "written",
      enabled: true,
      createdAt: `2026-10-0${made % 9}T10:00:00.000Z`,
      updatedAt: "2026-10-20T10:00:00.000Z",
      ...overrides,
    };
  };
  const tenant = preference({ createdAt: "2026-10-01T10:00:00.000Z" });
  const naming = preference({
    kind: "dont-flag",
    text: "Naming of test helpers",
    scope: { kind: "repo", repo },
    createdAt: "2026-10-02T10:00:00.000Z",
  });
  const elsewhere = preference({
    text: "Migrations",
    scope: { kind: "repo", repo: { ...repo, repo: "api" } },
  });
  const off = preference({ text: "Retries", enabled: false });
  /** small-feature, in a repository with guideline files at its base commit. */
  const withGuidelines = (files: Readonly<Record<string, string>>): PullRequestFixture => ({
    ...smallFeature,
    baseFiles: { ...smallFeature.baseFiles, ...files },
  });
  const guidelines = withGuidelines({
    "REVIEW.md": "Migrations must be reversible.\n",
    "AGENTS.md": "Use pnpm.\n",
    "CLAUDE.md": "x".repeat(70_000),
  });
  const added = smallFeatureFiles
    .flatMap((file) => file.hunks)
    .flatMap((hunk) => {
      const line = hunk.lines.find((one) => one.kind === "add")?.newLine;
      return line == null ? [] : [{ hunkId: hunk.id, side: "new" as const, startLine: line, line }];
    });
  const findingOn = (
    at: number,
    guidance: { ref: string; effect: "raised" | "left-out" } | null,
  ) => {
    const lines = added[at];
    if (lines === undefined) throw new Error("small-feature adds lines in every hunk");
    return {
      title: `Finding ${at}`,
      explanation: "",
      lines,
      severity: "major" as const,
      suggestion: null,
      mismatch: null,
      guidance,
    };
  };

  it("gives the passes the enabled preferences for the repository and REVIEW.md at the base commit, and keeps what it gave", async () => {
    const { analyze, model, preferences, github } = setup({ fixtures: [guidelines] });
    for (const one of [naming, elsewhere, off, tenant]) await preferences.savePreference(one);

    const analysis = await analyze();

    const guidance = {
      preferences: [
        { ref: "p1", kind: "look-for", text: "Tenant isolation", scope: "global" },
        { ref: "p2", kind: "dont-flag", text: "Naming of test helpers", scope: "repo" },
      ],
      guidelines: [
        {
          ref: "g1",
          path: "REVIEW.md",
          linkedFrom: null,
          content: "Migrations must be reversible.\n",
        },
      ],
    };
    for (const pass of ["checkSize", "intent", "findings", "risk", "decisions"] as const) {
      expect(model.callsTo(pass).map((call) => call.input.guidance)).toEqual([guidance]);
    }
    expect(analysis.guidance).toEqual({
      preferences: [
        {
          ref: "p1",
          id: tenant.id,
          kind: "look-for",
          text: "Tenant isolation",
          scope: tenant.scope,
        },
        { ref: "p2", id: naming.id, kind: "dont-flag", text: naming.text, scope: naming.scope },
      ],
      guidelines: [{ ref: "g1", path: "REVIEW.md", linkedFrom: null, given: "prompt", bytes: 31 }],
      checks: [],
    });
    expect(analysis.warnings).toEqual([]);
    // Only the files switched on are asked for.
    expect(
      github.getFilesCalls.filter((call) => call.some((file) => file.path === "REVIEW.md")),
    ).toEqual([[{ sha: baseSha, path: "REVIEW.md" }]]);
  });

  it("runs without guidance when the reviewer has none and the repository no REVIEW.md", async () => {
    const { analyze, model } = setup();

    const analysis = await analyze();

    expect(firstInput(model, "intent").guidance).toEqual({ preferences: [], guidelines: [] });
    expect(analysis.guidance).toEqual({ preferences: [], guidelines: [], checks: [] });
    expect(analysis.warnings).toEqual([]);
  });

  it("has none before the model runs", async () => {
    const analysis = await setup({ modelEnabled: false }).analyze();
    expect(analysis.guidance).toBeNull();
  });

  it("reads the guideline files the reviewer switched on, and not REVIEW.md once it's off", async () => {
    const { analyze, model, preferences } = setup({ fixtures: [guidelines] });
    await preferences.setGuidelineSwitch(repo, "REVIEW.md", false);
    await preferences.setGuidelineSwitch(repo, "AGENTS.md", true);
    await preferences.setGuidelineSwitch(repo, "CONTRIBUTING.md", true);

    const analysis = await analyze();

    expect(firstInput(model, "intent").guidance.guidelines).toEqual([
      { ref: "g1", path: "AGENTS.md", linkedFrom: null, content: "Use pnpm.\n" },
    ]);
    expect(analysis.guidance?.guidelines).toEqual([
      { ref: "g1", path: "AGENTS.md", linkedFrom: null, given: "prompt", bytes: 10 },
    ]);
  });

  it("doesn't send a guideline file that doesn't fit, and says so, once however often the run is tried", async () => {
    const model = new FakeAnalysisModel();
    model.script("intent", err(modelError("overloaded")));
    const { analyze, runModel, preferences } = setup({ fixtures: [guidelines], model });
    await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);

    const failed = await analyze();
    const analysis = await runModel(failed.id);

    const warning =
      "The AI review ran without some guideline files: CLAUDE.md is 69 KB and didn't fit in the 64 KB they can add up to";
    expect(failed.warnings).toEqual([warning]);
    expect(analysis.warnings).toEqual([warning]);
    expect(analysis.guidance?.guidelines).toEqual([
      { ref: "g1", path: "REVIEW.md", linkedFrom: null, given: "prompt", bytes: 31 },
    ]);
    expect(model.callsTo("findings")[0]?.input.guidance.guidelines.map((one) => one.path)).toEqual([
      "REVIEW.md",
    ]);
  });

  it("goes on without the guideline files when they can't be read, with a warning", async () => {
    const { useCases, done, stored, github, model, preferences } = setup({
      fixtures: [guidelines],
      modelEnabled: false,
    });
    await preferences.savePreference(tenant);
    const started = await useCases.startAnalysis(smallFeature.pullRequest.url);
    if (!started.ok) throw new Error(started.error.message);
    const id = started.value.analysisId;
    await done(id);
    github.failNext("getFiles", hostError("network"));

    await useCases.runModel(id);
    await done(id, 2);
    const analysis = await stored(id);

    expect(analysis.warnings).toEqual([
      "Couldn't read the repository's guideline files, so the AI review ran without them: network from host",
    ]);
    expect(analysis.modelError).toBeNull();
    expect(firstInput(model, "intent").guidance).toEqual({
      preferences: [{ ref: "p1", kind: "look-for", text: "Tenant isolation", scope: "global" }],
      guidelines: [],
    });
    expect(analysis.guidance?.guidelines).toEqual([]);
  });

  describe("with a harness", () => {
    const source = (files: Readonly<Record<string, string | HarnessSourceFile>>) => {
      const harnessSource = new FakeHarnessSource();
      harnessSource.setFiles(repo, baseSha, files);
      return harnessSource;
    };
    const given = (analysis: Analysis) =>
      analysis.guidance?.guidelines.map(({ ref, path, linkedFrom }) => [ref, path, linkedFrom]);
    const FILES = {
      "REVIEW.md": "Migrations must be reversible.\n",
      "CLAUDE.md": "See docs/plan.md.\n\n@docs/rules.md\n@docs/naming.md\n",
      "docs/rules.md": "# Rules\n\n@style.md\n",
      "docs/naming.md": "# Naming\n",
      "docs/style.md": "# Style\n",
      "docs/plan.md": "# Plan\n",
    };

    it("gives the enabled roots and then the files they import, with what imports each", async () => {
      const { analyze, model, preferences, github } = setup({ harnessSource: source(FILES) });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);

      const analysis = await analyze();

      expect(firstInput(model, "intent").guidance.guidelines).toEqual([
        { ref: "g1", path: "REVIEW.md", linkedFrom: null, content: FILES["REVIEW.md"] },
        { ref: "g2", path: "CLAUDE.md", linkedFrom: null, content: FILES["CLAUDE.md"] },
        {
          ref: "g3",
          path: "docs/rules.md",
          linkedFrom: "CLAUDE.md",
          content: FILES["docs/rules.md"],
        },
        {
          ref: "g4",
          path: "docs/naming.md",
          linkedFrom: "CLAUDE.md",
          content: FILES["docs/naming.md"],
        },
        {
          ref: "g5",
          path: "docs/style.md",
          linkedFrom: "docs/rules.md",
          content: FILES["docs/style.md"],
        },
      ]);
      expect(analysis.guidance?.guidelines[2]).toEqual({
        ref: "g3",
        path: "docs/rules.md",
        linkedFrom: "CLAUDE.md",
        given: "prompt",
        bytes: 19,
      });
      // Nothing is asked of the host's files: the harness has them.
      expect(github.getFilesCalls.flat().filter(({ path }) => path.endsWith(".md"))).toEqual([]);
    });

    it("leaves out a root that's off with what it imports, and an import that's off alone", async () => {
      const { analyze, preferences } = setup({ harnessSource: source(FILES) });
      expect(given(await analyze())).toEqual([["g1", "REVIEW.md", null]]);

      const other = setup({ harnessSource: source(FILES) });
      await other.preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);
      await other.preferences.setGuidelineSwitch(repo, "docs/naming.md", false);
      expect(given(await other.analyze())?.map(([, path]) => path)).toEqual([
        "REVIEW.md",
        "CLAUDE.md",
        "docs/rules.md",
        "docs/style.md",
      ]);
      expect(await preferences.getGuidelineSwitches(repo)).toEqual(new Map());
    });

    it("passes over an import that doesn't fit, takes a smaller one after it, and names what it left out", async () => {
      const { analyze, preferences } = setup({
        harnessSource: source({
          "CLAUDE.md": "@large.md @small.md @huge.md @image.txt @off.txt\n\n[See](link.txt)",
          "large.md": "x".repeat(70_000),
          "small.md": "Small.\n",
          "huge.md": { kind: "skipped", reason: "too-large" },
          "image.txt": { kind: "skipped", reason: "unreadable" },
          "off.txt": { kind: "skipped", reason: "unreadable" },
          "link.txt": { kind: "skipped", reason: "unreadable" },
        }),
      });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);
      await preferences.setGuidelineSwitch(repo, "off.txt", false);

      const analysis = await analyze();

      expect(given(analysis)).toEqual([
        ["g1", "CLAUDE.md", null],
        ["g2", "small.md", "CLAUDE.md"],
      ]);
      // A file only linked isn't one a run always reads, so leaving it out says nothing.
      expect(analysis.warnings).toEqual([
        "The AI review ran without some guideline files: large.md is 69 KB and didn't fit in the 64 KB they can add up to; huge.md is over 1 MB; image.txt couldn't be read as text",
      ]);
    });

    it("gives a root that's on only because a root that's on imports it", async () => {
      const { analyze, preferences } = setup({
        harnessSource: source({
          "CLAUDE.md": "@AGENTS.md\n",
          "AGENTS.md": "Use pnpm.\n\n@docs/rules.md\n",
          "docs/rules.md": "# Rules\n",
        }),
      });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);
      expect(given(await analyze())).toEqual([
        ["g1", "CLAUDE.md", null],
        ["g2", "AGENTS.md", null],
        ["g3", "docs/rules.md", "AGENTS.md"],
      ]);
    });

    it("lists the other enabled files for a model that reads them, as the copies it reads", async () => {
      const long = `${"word ".repeat(400)}\n\n## After\n`;
      const model = new FakeAnalysisModel({ readsHarness: true });
      const { analyze, preferences } = setup({
        harnessSource: source({
          "CLAUDE.md": "@docs/rules.md @docs/large.md\n\nSee docs/plan.md.\n",
          "docs/rules.md": "[Deep](deep.md)\n",
          "docs/large.md": `# Large\n\n${"x ".repeat(40_000)}`,
          "docs/plan.md": long,
          "docs/deep.md": "# Deep\n",
        }),
        model,
      });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);

      const analysis = await analyze();

      expect(
        analysis.guidance?.guidelines.map(({ ref, path, linkedFrom, given }) => [
          ref,
          path,
          linkedFrom,
          given,
        ]),
      ).toEqual([
        ["g1", "CLAUDE.md", null, "prompt"],
        ["g2", "docs/rules.md", "CLAUDE.md", "prompt"],
        ["g3", "docs/large.md", "CLAUDE.md", "on-request"],
        ["g4", "docs/plan.md", "CLAUDE.md", "on-request"],
        ["g5", "docs/deep.md", "docs/rules.md", "on-request"],
      ]);
      const { harness, guidance } = firstInput(model, "intent");
      expect(guidance.guidelines.map(({ ref }) => ref)).toEqual(["g1", "g2"]);
      expect(harness?.files.map(({ ref, path }) => [ref, path])).toEqual([
        ["g3", "harness/docs/large.md"],
        ["g4", "harness/docs/plan.md"],
        ["g5", "harness/docs/deep.md"],
      ]);
      const plan = harness?.contents.get("harness/docs/plan.md")?.split("\n") ?? [];
      const [after] = harness?.files[1]?.headings ?? [];
      expect(plan[(after?.line ?? 0) - 1]).toBe("## After");
      expect(harness?.files[1]?.lines).toBe(plan.length - 1);
      // What doesn't fit the prompt can be read, so nothing is left out.
      expect(analysis.warnings).toEqual([]);
    });

    it("says how many files a model that doesn't read them ran without, and why", async () => {
      const { analyze, model, preferences } = setup({ harnessSource: source(FILES) });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);

      const analysis = await analyze();

      expect(firstInput(model, "intent").harness).toBeNull();
      expect(analysis.guidance?.guidelines.every((file) => file.given === "prompt")).toBe(true);
      expect(analysis.warnings).toEqual([
        "The AI review ran without 1 file the repository's guideline files link: Sonnet 5.5 through Claude Code can't read files on request",
      ]);
    });

    it("has nothing to read when the harness can't be loaded, or every file is in the prompt", async () => {
      const model = new FakeAnalysisModel({ readsHarness: true });
      const harnessSource = source(FILES);
      harnessSource.failAlways(hostError("network"));
      const failing = setup({ harnessSource, model, fixtures: [withGuidelines(FILES)] });
      await failing.analyze();
      expect(firstInput(model, "intent").harness).toBeNull();

      const other = new FakeAnalysisModel({ readsHarness: true });
      await setup({ harnessSource: source({ "REVIEW.md": "Be kind." }), model: other }).analyze();
      expect(firstInput(other, "intent").harness).toBeNull();
    });

    it("names the file that imports one, not the first that mentions it", async () => {
      const { analyze, preferences } = setup({
        harnessSource: source({
          "REVIEW.md": "As rules.md says.",
          "CLAUDE.md": "@rules.md",
          "rules.md": "",
        }),
      });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);
      expect(given(await analyze())?.at(-1)).toEqual(["g3", "rules.md", "CLAUDE.md"]);
    });

    it("waits for the load the analysis started, making no other", async () => {
      const harnessSource = source(FILES);
      const release = harnessSource.hold();
      const { analyze, runModel, model, preferences } = setup({
        harnessSource,
        modelEnabled: false,
      });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);
      const { id } = await analyze();
      const running = runModel(id);
      release();
      expect(given(await running)).toHaveLength(5);
      expect(harnessSource.calls.listFiles).toEqual([baseSha]);
      expect(model.callsTo("intent")).toHaveLength(1);
    });

    it("reads the roots alone when the harness can't be loaded, with one warning", async () => {
      const harnessSource = source(FILES);
      harnessSource.failAlways(hostError("rate-limited"));
      const { analyze, preferences } = setup({
        harnessSource,
        fixtures: [withGuidelines(FILES)],
      });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);

      const analysis = await analyze();

      expect(given(analysis)).toEqual([
        ["g1", "REVIEW.md", null],
        ["g2", "CLAUDE.md", null],
      ]);
      expect(analysis.warnings).toEqual([
        "Couldn't load the files the repository's guideline files import, so the AI review ran without them: rate-limited from host",
      ]);
    });

    it("warns once when neither the harness nor the roots can be read", async () => {
      const harnessSource = source(FILES);
      harnessSource.failAlways(hostError("network"));
      const { analyze, runModel, github } = setup({ harnessSource, modelEnabled: false });
      const { id } = await analyze();
      github.failNext("getFiles", hostError("network"));
      expect((await runModel(id)).warnings).toEqual([
        "Couldn't read the repository's guideline files, so the AI review ran without them: network from host",
      ]);
    });

    it("says nothing of a harness that can't be loaded for a repository without guideline files", async () => {
      const harnessSource = source({});
      harnessSource.failAlways(hostError("network"));
      expect((await setup({ harnessSource }).analyze()).warnings).toEqual([]);
    });

    it("loads nothing for the run when every root is off", async () => {
      const harnessSource = source(FILES);
      const { analyze, runModel, preferences, harnessStore } = setup({
        harnessSource,
        modelEnabled: false,
      });
      await preferences.setGuidelineSwitch(repo, "REVIEW.md", false);
      const { id } = await analyze();
      await harnessStore.dropUnusedSince("2027-01-01T00:00:00Z");
      const ran = await runModel(id);
      expect(ran.guidance?.guidelines).toEqual([]);
      expect(harnessSource.calls.listFiles).toHaveLength(1);
    });

    it("shows a point's mark as from the imported file the rule is in", async () => {
      const model = new FakeAnalysisModel();
      model.script("findings", ok([findingOn(0, { ref: "g3", effect: "raised" })]));
      const { analyze, preferences } = setup({ harnessSource: source(FILES), model });
      await preferences.setGuidelineSwitch(repo, "CLAUDE.md", true);
      expect(pointsOf(await analyze())[0]?.guidance).toEqual({
        effect: "raised",
        label: "docs/rules.md",
        preferenceId: null,
        everywhere: false,
      });
    });
  });

  it("keeps the marks that check out and drops the others, never their points", async () => {
    const model = new FakeAnalysisModel();
    model.script(
      "findings",
      ok([
        findingOn(0, { ref: "p1", effect: "raised" }),
        findingOn(1, { ref: "p2", effect: "left-out" }),
        findingOn(2, { ref: "g1", effect: "left-out" }),
        findingOn(3, { ref: "p1", effect: "left-out" }),
        findingOn(4, { ref: "p7", effect: "raised" }),
        findingOn(5, null),
      ]),
    );
    model.script(
      "risk",
      ok(
        smallFeatureHunks.map((hunkId, index) => ({
          ...logic(hunkId),
          riskClass: index < 4 ? ("contract" as const) : ("logic" as const),
          guidance:
            [
              { ref: "g1", effect: "raised" as const },
              { ref: "p2", effect: "left-out" as const },
              { ref: "p2", effect: "raised" as const },
              null,
              { ref: "p1", effect: "raised" as const },
              null,
            ][index] ?? null,
        })),
      ),
    );
    const { analyze, preferences, logger } = setup({ fixtures: [guidelines], model });
    await preferences.savePreference(tenant);
    await preferences.savePreference(naming);

    const analysis = await analyze();

    expect(analysis.findings.map((finding) => finding.guidance)).toEqual([
      { ref: "p1", effect: "raised" },
      { ref: "p2", effect: "left-out" },
      { ref: "g1", effect: "left-out" },
      null,
      null,
      null,
    ]);
    expect(model.callsTo("findings")).toHaveLength(1);
    const modelRisk = analysis.risk.filter((risk) => risk.source === "model");
    expect(modelRisk.map((risk) => [risk.riskClass, risk.guidance])).toEqual([
      ["contract", { ref: "g1", effect: "raised" }],
      ["contract", { ref: "p2", effect: "left-out" }],
      ["contract", null],
      ["contract", null],
      // A mark on a logic hunk says nothing the page shows.
      ["logic", null],
      ["logic", null],
    ]);
    // The risk pass and the findings pass run side by side, so their entries come in either order.
    const dropped = logger.entries
      .filter((entry) => entry.message === "Dropped a guidance mark that doesn't check out")
      .map((entry) => entry.fields);
    expect(dropped).toHaveLength(3);
    expect(dropped).toEqual(
      expect.arrayContaining([
        { finding: 4, ref: "p1", effect: "left-out" },
        { finding: 5, ref: "p7", effect: "raised" },
        { hunkId: smallFeatureHunks[2], ref: "p2", effect: "raised" },
      ]),
    );
    const marked = pointsOf(analysis).flatMap((point) =>
      point.guidance === undefined ? [] : [[point.id, point.guidance.effect, point.guidance.label]],
    );
    expect(marked).toEqual([
      ["f1", "raised", "Tenant isolation"],
      ["f2", "left-out", "Naming of test helpers"],
      ["f3", "left-out", "REVIEW.md"],
      [`r:${smallFeatureHunks[0]}`, "raised", "REVIEW.md"],
      [`r:${smallFeatureHunks[1]}`, "left-out", "Naming of test helpers"],
    ]);
  });

  it("keeps a point's mark as the run read the preference, after the preference is deleted", async () => {
    const model = new FakeAnalysisModel();
    model.script("findings", ok([findingOn(0, { ref: "p1", effect: "raised" })]));
    const { analyze, preferences } = setup({ model });
    await preferences.savePreference(tenant);
    const analysis = await analyze();
    await preferences.deletePreference(tenant.id);

    expect(pointsOf(analysis)[0]?.guidance).toEqual({
      effect: "raised",
      label: "Tenant isolation",
      preferenceId: tenant.id,
      everywhere: true,
    });
  });

  it("is gone with the model run, and read afresh by the next", async () => {
    const { analyze, useCases, runModel, preferences } = setup({ fixtures: [guidelines] });
    await preferences.savePreference(tenant);
    const ran = await analyze();
    expect(ran.guidance?.preferences).toHaveLength(1);

    const removed = await useCases.removeModelRun(ran.id);
    expect(removed.ok && removed.value.analysis.guidance).toBeNull();

    await preferences.savePreference(naming);
    const again = await runModel(ran.id);
    expect(again.guidance?.preferences.map((one) => one.text)).toEqual([
      "Tenant isolation",
      "Naming of test helpers",
    ]);
  });
});

describe("removeModelRun", () => {
  /** A file cache that can stop answering, so a removal that reads it has to go to the host. */
  class ForgettingFileCache extends InMemoryFileCache {
    forgotten = false;
    override async get(...args: Parameters<InMemoryFileCache["get"]>) {
      return this.forgotten ? null : super.get(...args);
    }
  }

  /** A parser that can break, so a removal that parses fails. */
  class BreakingParser extends FakeCodeParser {
    broken = false;
    override async syntaxNodes(...args: Parameters<FakeCodeParser["syntaxNodes"]>) {
      if (this.broken) throw new Error("parsed during the removal");
      return super.syntaxNodes(...args);
    }
    override async symbols(...args: Parameters<FakeCodeParser["symbols"]>) {
      if (this.broken) throw new Error("parsed during the removal");
      return super.symbols(...args);
    }
  }

  const withModelRun = async (model?: FakeAnalysisModel) => {
    const fileCache = new ForgettingFileCache();
    const parser = new BreakingParser();
    const ready = setup({
      modelEnabled: false,
      fileCache,
      parser,
      ...(model === undefined ? {} : { model }),
    });
    const codeOnly = await ready.analyze();
    const ran = await ready.runModel(codeOnly.id);
    const remove = async () => {
      const removed = await ready.useCases.removeModelRun(codeOnly.id);
      if (!removed.ok) throw new Error(removed.error.message);
      return removed.value;
    };
    /** Every outside read fails from here on: the host, the file cache, Jira and the parser. */
    const cutOff = () => {
      ready.github.failAlways(hostError("network"));
      fileCache.forgotten = true;
      ready.tickets.failNext({ kind: "network", message: "Jira is down" });
      parser.broken = true;
    };
    return { ...ready, codeOnly, ran, remove, cutOff };
  };

  it("puts back exactly what the code made, under the same ID, reading nothing outside", async () => {
    const model = new FakeAnalysisModel();
    model.script(
      "risk",
      ok(smallFeatureHunks.map((hunkId) => ({ ...logic(hunkId), riskClass: "contract" as const }))),
    );
    const { codeOnly, ran, remove, cutOff, stored, preps } = await withModelRun(model);
    expect(ran.intent).not.toBeNull();
    expect(ran.risk).not.toEqual(codeOnly.risk);
    expect(ran.beforeModel).toEqual({ risk: codeOnly.risk, warnings: codeOnly.warnings });
    const prepsBefore = preps();

    cutOff();
    const removed = await remove();
    expect({ ...removed.analysis, updatedAt: codeOnly.updatedAt }).toEqual(codeOnly);
    expect(await stored(codeOnly.id)).toEqual(removed.analysis);
    expect(removed.pointReviews).toEqual([]);
    expect(preps()).toBe(prepsBefore);
  });

  it("puts back the code's warnings without the model's", async () => {
    const full = await (async () => {
      const { analyze, model } = setup();
      await analyze();
      return firstInput(model, "checkSize");
    })();
    // Just too large, so the run drops a file's contents and says so.
    const model = new FakeAnalysisModel({
      maxInputTokens: Math.ceil(JSON.stringify(full).length / 4) - 1,
    });
    const { codeOnly, ran, remove } = await withModelRun(model);
    expect(ran.warnings.length).toBeGreaterThan(codeOnly.warnings.length);

    const removed = await remove();
    expect({ ...removed.analysis, updatedAt: codeOnly.updatedAt }).toEqual(codeOnly);
  });

  it("puts back what the code made before the first run when a failed run was tried again", async () => {
    const model = new FakeAnalysisModel();
    model.script("findings", err(modelError("rate-limited")));
    const { codeOnly, ran, remove, runModel } = await withModelRun(model);
    expect(ran.modelError).not.toBeNull();
    expect(ran.risk).not.toEqual(codeOnly.risk);
    const again = await runModel(codeOnly.id);
    expect(again.modelError).toBeNull();

    const removed = await remove();
    expect({ ...removed.analysis, updatedAt: codeOnly.updatedAt }).toEqual(codeOnly);
  });

  it("runs the code's stages again on an analysis stored before what the code made was kept", async () => {
    const { codeOnly, ran, store, remove, preps } = await withModelRun();
    await store.saveAnalysis({ ...ran, beforeModel: null });
    const prepsBefore = preps();

    const removed = await remove();
    expect({ ...removed.analysis, updatedAt: codeOnly.updatedAt }).toEqual(codeOnly);
    // Without saving or announcing anything until it's done.
    expect(preps()).toBe(prepsBefore);
  });

  it("leaves the analysis with its run, and its points' states, when running the code again fails", async () => {
    const { codeOnly, ran, store, useCases, cutOff, stored } = await withModelRun();
    const legacy = { ...ran, beforeModel: null };
    await store.saveAnalysis(legacy);
    const dismissed = {
      pointId: PointId.parse("f1"),
      state: "dismissed" as const,
      updatedAt: "2026-10-21T09:05:00Z",
    };
    await store.savePointReview(codeOnly.id, dismissed);

    cutOff();
    const removed = await useCases.removeModelRun(codeOnly.id);
    expect(removed.ok).toBe(false);
    expect(await stored(codeOnly.id)).toEqual(legacy);
    expect(await store.getPointReviews(codeOnly.id)).toEqual([dismissed]);
  });

  it("forgets the states of Claude's points, so a new run starts from none", async () => {
    const { codeOnly, store, remove, runModel } = await withModelRun();
    await store.savePointReview(codeOnly.id, {
      pointId: PointId.parse("f1"),
      state: "dismissed",
      updatedAt: "2026-10-21T09:05:00Z",
    });

    await remove();
    expect(await store.getPointReviews(codeOnly.id)).toEqual([]);
    const again = await runModel(codeOnly.id);
    expect(again.stages.decisions).toBe("done");
  });

  it("keeps the record of a published review", async () => {
    const { codeOnly, store, remove } = await withModelRun();
    const receipt = {
      url: "https://github.com/acme/shop/pull/101#pullrequestreview-1",
      publishedAt: "2026-10-21T09:10:00Z",
      postedCommentIds: {},
    };
    await store.recordPublication(codeOnly.id, { number: 1, id: null, receipt });

    await remove();
    expect(await store.getPublications(codeOnly.id)).toEqual([{ number: 1, id: null, receipt }]);
  });

  it("refuses a second removal, leaving the analysis as the first did", async () => {
    const { codeOnly, useCases, remove, stored } = await withModelRun();
    const removed = await remove();

    expect(await useCases.removeModelRun(codeOnly.id)).toEqual(
      err({ code: "bad-request", message: "No model has analyzed this pull request" }),
    );
    expect(await stored(codeOnly.id)).toEqual(removed.analysis);
  });

  it("refuses a removal while another is going, and starts a run asked for meanwhile after it", async () => {
    const { codeOnly, ran, store, useCases, done, doneCount, stored } = await withModelRun();
    // Running the code again keeps the first removal going across several turns.
    await store.saveAnalysis({ ...ran, beforeModel: null });
    const before = doneCount(codeOnly.id);

    const first = useCases.removeModelRun(codeOnly.id);
    const second = useCases.removeModelRun(codeOnly.id);
    const run = useCases.runModel(codeOnly.id);
    expect(await second).toEqual(
      err({ code: "analysis-not-complete", message: "The analysis isn't complete yet" }),
    );
    expect((await first).ok).toBe(true);
    expect((await run).ok).toBe(true);
    await done(codeOnly.id, before + 1);
    const again = await stored(codeOnly.id);
    expect(again.stages.decisions).toBe("done");
    expect(again.beforeModel).toEqual({ risk: codeOnly.risk, warnings: codeOnly.warnings });
  });

  it("refuses an analysis Claude hasn't run on, or one that isn't complete", async () => {
    const { useCases, store, analyze } = setup({ modelEnabled: false });
    const codeOnly = await analyze();
    expect(await useCases.removeModelRun(codeOnly.id)).toEqual(
      err({ code: "bad-request", message: "No model has analyzed this pull request" }),
    );
    await store.saveAnalysis({ ...codeOnly, status: "failed" });
    expect(await useCases.removeModelRun(codeOnly.id)).toEqual(
      err({ code: "analysis-not-complete", message: "The analysis isn't complete yet" }),
    );
    expect(await useCases.removeModelRun(AnalysisId.parse("a_0000000000000000"))).toEqual(
      err({ code: "not-found", message: "No analysis a_0000000000000000" }),
    );
  });

  it("refuses while Claude's run is going", async () => {
    const { useCases, analyze, done, doneCount } = setup({ modelEnabled: false });
    const codeOnly = await analyze();
    const before = doneCount(codeOnly.id);
    await useCases.runModel(codeOnly.id);
    expect(await useCases.removeModelRun(codeOnly.id)).toEqual(
      err({ code: "analysis-not-complete", message: "The analysis isn't complete yet" }),
    );
    await done(codeOnly.id, before + 1);
  });
});
