import { describe, expect, it } from "vitest";
import type { Hunk } from "../../domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisId,
  FindingId,
  MODEL_STAGES,
  pointsOf,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { type AnalysisEvent, createAnalysisEvents } from "../events/index.ts";
import type { AdviceDraft } from "../ports/index.ts";
import {
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeGuardrailAdvisor,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakeRepositoryCopies,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  InMemoryHarnessStore,
  InMemoryKnownCheckouts,
  InMemoryPreferenceStore,
  type PullRequestFixture,
  RecordingLogger,
  smallFeature,
  smallFeatureFiles,
} from "../testing/index.ts";
import { codeOf, GUARDRAIL_CALL_MS, MAX_POINT_LINES, runGuardrailCall } from "./guardrails.ts";
import { createUseCases } from "./index.ts";

const BIOME = '{ "linter": { "rules": { "recommended": true, "style": { "noVar": "off" } } } }\n';
const PACKAGE = '{ "devDependencies": { "@biomejs/biome": "2.0.0" } }\n';

/** small-feature, in a repository with a Biome config and a package.json at its base commit. */
const withBiome: PullRequestFixture = {
  ...smallFeature,
  baseFiles: { ...smallFeature.baseFiles, "biome.json": BIOME, "package.json": PACKAGE },
};

const hunks = smallFeatureFiles.flatMap((file) => file.hunks);
// The points are in TypeScript, so a run reads Biome's config for them.
const [firstHunk, secondHunk] = hunks.filter(
  (hunk) => hunk.path.endsWith(".ts") && hunk.lines.some((line) => line.kind === "add"),
);
if (firstHunk === undefined || secondHunk === undefined) throw new Error("small-feature has hunks");

const findingOn = (hunk: Hunk, title: string) => {
  const line = hunk.lines.find((one) => one.kind === "add")?.newLine ?? 1;
  return {
    title,
    explanation: "Nobody hears if it rejects.",
    lines: { hunkId: hunk.id, side: "new" as const, startLine: line, line },
    type: "logic" as const,
    severity: "major" as const,
    suggestion: null,
    mismatch: null,
    guidance: null,
  };
};

/** The fake model's findings, one on the first TypeScript hunk. */
const tsFinding = () => ok([findingOn(firstHunk, "Drops a promise")]);

class RecordingStore extends InMemoryAnalysisStore {
  readonly saves: Analysis[] = [];

  override async saveAnalysis(analysis: Analysis): Promise<void> {
    this.saves.push(analysis);
    await super.saveAnalysis(analysis);
  }
}

const lintRule = (overrides: Partial<AdviceDraft["marks"][number]["guardrail"]> = {}) => ({
  kind: "lint-rule",
  tool: "biome" as const,
  engine: "Biome",
  rule: "noFloatingPromises",
  on: false,
  does: "Reports a promise that is neither awaited nor handled.",
  ...overrides,
});

const setup = (
  options: { answer?: AdviceDraft; advisor?: FakeGuardrailAdvisor; model?: FakeAnalysisModel } = {},
) => {
  const clock = new FixedClock("2026-11-10T10:00:00.000Z");
  const github = new FakeGitHost({ host: "github", fixtures: [withBiome], clock });
  const store = new RecordingStore(clock);
  const advisor =
    options.advisor ?? new FakeGuardrailAdvisor({ answer: options.answer ?? { marks: [] } });
  const model =
    options.model ??
    (() => {
      const fake = new FakeAnalysisModel();
      fake.script("findings", tsFinding());
      return fake;
    })();
  const emitted: { id: AnalysisId; event: AnalysisEvent }[] = [];
  const inner = createAnalysisEvents();
  const waits: { test: () => boolean; resolve: () => void }[] = [];
  const events = {
    emit(id: AnalysisId, event: AnalysisEvent) {
      emitted.push({ id, event });
      inner.emit(id, event);
      for (const wait of waits.filter((one) => one.test())) wait.resolve();
    },
    subscribe: inner.subscribe,
  };
  const until = (test: () => boolean) =>
    new Promise<void>((resolve) => {
      if (test()) resolve();
      else waits.push({ test, resolve });
    });
  /** Resolves once `test` holds, checked after each turn of the event loop. */
  const settled = async (test: () => boolean | Promise<boolean>) => {
    for (let turn = 0; turn < 1_000; turn += 1) {
      if (await test()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("never settled");
  };
  const doneCount = (id: AnalysisId) =>
    emitted.filter((one) => one.id === id && one.event.type === "done").length;
  const useCases = createUseCases(
    {
      hosts: { github },
      threads: {},
      statuses: {},
      tickets: new FakeTicketSource(),
      models: new FakeModelCatalog({ model, advisor }),
      store,
      fileCache: new InMemoryFileCache(),
      preferences: new InMemoryPreferenceStore(),
      history: {},
      checkouts: new FakeLocalCheckouts(),
      harnessSource: () => null,
      harnessStore: new InMemoryHarnessStore(),
      knownCheckouts: new InMemoryKnownCheckouts(),
      copies: new FakeRepositoryCopies(),
      parser: new FakeCodeParser(),
      events,
      clock,
      logger: new RecordingLogger(),
    },
    { version: "1.2.3" },
  );
  const stored = async (id: AnalysisId): Promise<Analysis> => {
    const analysis = await store.getAnalysis(id);
    if (analysis === null) throw new Error(`no analysis ${id}`);
    return analysis;
  };
  const analyzed = async (): Promise<AnalysisId> => {
    const started = await useCases.startAnalysis(withBiome.pullRequest.url);
    if (!started.ok) throw new Error(started.error.message);
    const id = started.value.analysisId;
    await until(() => doneCount(id) >= 1);
    return id;
  };
  /** Starts a model run, and resolves once its events end. */
  const run = async (id: AnalysisId): Promise<Analysis> => {
    const before = doneCount(id);
    const ran = await useCases.runModel(id);
    if (!ran.ok) throw new Error(ran.error.message);
    await until(() => doneCount(id) > before);
    return stored(id);
  };
  return {
    clock,
    store,
    advisor,
    model,
    useCases,
    emitted,
    until,
    settled,
    stored,
    analyzed,
    run,
    doneCount,
  };
};

describe("a model run's guardrail call", () => {
  it("isn't made when the run has no finding", async () => {
    const model = new FakeAnalysisModel();
    model.script("findings", ok([]));
    const { analyzed, run, advisor } = setup({ model });

    const analysis = await run(await analyzed());

    expect(advisor.calls).toEqual([]);
    expect(analysis.guardrails).toBeNull();
    expect(analysis.modelCalls.map((call) => call.pass)).not.toContain("guardrails");
  });

  it("reads the run's findings with their code, and marks the ones it names", async () => {
    const model = new FakeAnalysisModel();
    const broken = findingOn(secondHunk, "Breaks the route's callers");
    const kept = findingOn(secondHunk, "Reads the order twice");
    model.script("findings", ok([findingOn(firstHunk, "Drops a promise"), broken, kept]));
    const suggested = {
      kind: "ci-check",
      tool: null,
      engine: "oasdiff",
      rule: null,
      on: false,
      does: "Fails a change that breaks the API's contract.",
    };
    const { analyzed, run, advisor } = setup({
      model,
      answer: {
        marks: [
          { point: "f1", guardrail: lintRule() },
          { point: "f2", guardrail: suggested },
        ],
      },
    });

    const analysis = await run(await analyzed());

    const [input] = advisor.calls;
    expect(input?.points.map((point) => [point.ref, point.path])).toEqual([
      ["f1", firstHunk.path],
      ["f2", secondHunk.path],
      ["f3", secondHunk.path],
    ]);
    expect(input?.points[1]).toMatchObject({
      title: broken.title,
      explanation: broken.explanation,
      code: codeOf(secondHunk, broken.lines),
    });
    expect(input?.configs.map((config) => config.path)).toEqual(["biome.json"]);
    expect(input?.buildFiles).toEqual([{ path: "package.json", content: PACKAGE }]);

    const rule = {
      is: "rule",
      tool: "biome",
      rule: "noFloatingPromises",
      configPath: "biome.json",
    } as const;
    expect(analysis.findings[0]?.guardrail).toEqual(rule);
    expect(analysis.findings[1]?.guardrail).toEqual({
      is: "suggested",
      kind: "ci-check",
      engine: "oasdiff",
      does: "Fails a change that breaks the API's contract.",
    });
    expect(pointsOf(analysis).flatMap((point) => (point.guardrail ? [point.id] : []))).toEqual([
      "f1",
      "f2",
    ]);
    expect(analysis.guardrails).toBe("done");
    expect(analysis.guidance?.checks).toEqual([
      { tool: "biome", path: "biome.json", bytes: BIOME.length },
      { tool: null, path: "package.json", bytes: PACKAGE.length },
    ]);
    expect(analysis.usage.map((usage) => usage.pass)).toContain("guardrails");
    expect(analysis.modelCalls.filter((call) => call.pass === "guardrails")).toEqual([
      expect.objectContaining({ attempt: 1, outcome: "ok", problems: [], error: null }),
    ]);
  });

  it("drops a mark on a point that doesn't exist, a second on a point, and a rule the repository has", async () => {
    const { analyzed, run } = setup({
      answer: {
        marks: [
          { point: "f9", guardrail: lintRule() },
          { point: "f1", guardrail: lintRule({ rule: "noVar" }) },
          { point: "f1", guardrail: lintRule() },
          { point: "f1", guardrail: lintRule() },
        ],
      },
    });

    const analysis = await run(await analyzed());

    expect(analysis.findings[0]?.guardrail).toMatchObject({ rule: "noFloatingPromises" });
    expect(analysis.modelCalls.find((call) => call.pass === "guardrails")).toMatchObject({
      outcome: "problems",
      problems: [
        "Mark 1, on f9: left out, since the run has no such point",
        "Mark 2, on f1: left out, since its rule is one the repository already has, or it names no valid check",
        "Mark 4, on f1: left out, since an earlier mark is on that point",
      ],
    });
  });

  it("suggests a rule whose config the pull request itself changes", async () => {
    const clock = new FixedClock("2026-11-10T10:00:00.000Z");
    const github = new FakeGitHost({ host: "github", fixtures: [withBiome], clock });
    const advisor = new FakeGuardrailAdvisor({
      answer: { marks: [{ point: "f1", guardrail: lintRule() }] },
    });
    const finding = { ...findingOn(firstHunk, "Drops a promise"), id: FindingId.parse("f1") };
    const call = (changedPaths: readonly string[]) =>
      runGuardrailCall(
        {
          hosts: { github },
          fileCache: new InMemoryFileCache(),
          clock,
          logger: new RecordingLogger(),
        },
        advisor,
        withBiome.pullRequest,
        changedPaths,
        new Map(hunks.map((hunk) => [hunk.id, hunk])),
        [finding],
      );

    expect((await call([firstHunk.path])).findings[0]?.guardrail?.is).toBe("rule");
    expect((await call([firstHunk.path, "biome.json"])).findings[0]?.guardrail).toEqual({
      is: "suggested",
      kind: "lint-rule",
      engine: "Biome",
      does: "Reports a promise that is neither awaited nor handled.",
    });
  });

  it("lands the review when the passes end, and says the call's end apart", async () => {
    const advisor = new FakeGuardrailAdvisor({ answer: { marks: [] } });
    const { analyzed, useCases, until, settled, stored, doneCount } = setup({ advisor });
    const id = await analyzed();
    const release = advisor.hold();
    const before = doneCount(id);

    const ran = await useCases.runModel(id);
    if (!ran.ok) throw new Error(ran.error.message);
    await settled(() => advisor.calls.length > 0);

    const landed = await stored(id);
    for (const stage of MODEL_STAGES) {
      expect(landed.stages[stage]).toBe("done");
    }
    expect(landed.guardrails).toBe("running");
    expect(doneCount(id)).toBe(before);

    release();
    await until(() => doneCount(id) > before);
    expect((await stored(id)).guardrails).toBe("done");
  });

  it("says the call runs in the write that ends the last pass", async () => {
    const { analyzed, useCases, store, until, doneCount } = setup();
    const id = await analyzed();
    const before = doneCount(id);
    await useCases.runModel(id);
    await until(() => doneCount(id) > before);

    const saves = store.saves.filter((saved) => saved.id === id);
    const ended = saves.findIndex((saved) =>
      MODEL_STAGES.every((stage) => saved.stages[stage] === "done"),
    );
    expect(saves[ended]?.guardrails).toBe("running");
  });

  it("leaves the review as the passes made it when the call fails, saying why", async () => {
    const advisor = new FakeGuardrailAdvisor({
      answer: { marks: [{ point: "f1", guardrail: lintRule() }] },
    });
    advisor.script(err({ kind: "invalid-output", message: "marks: expected array" }));
    const { analyzed, run } = setup({ advisor });

    const analysis = await run(await analyzed());

    expect(analysis.guardrails).toBe("failed");
    expect(analysis.modelError).toBeNull();
    expect(analysis.findings.every((finding) => finding.guardrail === undefined)).toBe(true);
    expect(analysis.modelCalls.filter((call) => call.pass === "guardrails")).toEqual([
      expect.objectContaining({
        outcome: "failed",
        error: { kind: "invalid-output", message: "marks: expected array" },
      }),
    ]);
  });

  it("leaves a call that takes longer than its limit", async () => {
    const advisor = new FakeGuardrailAdvisor({
      answer: { marks: [{ point: "f1", guardrail: lintRule() }] },
    });
    const { analyzed, useCases, clock, until, settled, stored, doneCount } = setup({ advisor });
    const id = await analyzed();
    advisor.hold();
    const before = doneCount(id);

    const ran = await useCases.runModel(id);
    if (!ran.ok) throw new Error(ran.error.message);
    await settled(() => advisor.calls.length > 0);
    clock.advance(GUARDRAIL_CALL_MS);
    await until(() => doneCount(id) > before);

    const analysis = await stored(id);
    expect(analysis.guardrails).toBe("failed");
    expect(analysis.findings.every((finding) => finding.guardrail === undefined)).toBe(true);
    expect(analysis.modelCalls.find((call) => call.pass === "guardrails")?.error?.message).toMatch(
      /took more than 30 seconds/,
    );
  });

  it("is gone with Remove AI review", async () => {
    const { analyzed, run, useCases } = setup({
      answer: { marks: [{ point: "f1", guardrail: lintRule() }] },
    });
    const ran = await run(await analyzed());
    expect(ran.findings[0]?.guardrail).toBeDefined();

    const removed = await useCases.removeModelRun(ran.id);

    if (!removed.ok) throw new Error(removed.error.message);
    expect(removed.value.analysis.findings).toEqual([]);
    expect(removed.value.analysis.guardrails).toBeNull();
    expect(removed.value.analysis.guidance).toBeNull();
  });
});

describe("a guardrail call a stop interrupted", () => {
  it("is failed at the next start, and the review it landed stays", async () => {
    const { analyzed, run, store, useCases, stored } = setup();
    const ran = await run(await analyzed());
    await store.saveAnalysis({ ...ran, guardrails: "running" });

    expect(await useCases.recoverInterruptedAnalyses()).toBe(1);

    const recovered = await stored(ran.id);
    expect(recovered.guardrails).toBe("failed");
    expect(recovered.modelError).toBeNull();
    expect(recovered.stages).toEqual(ran.stages);
  });
});

describe("codeOf", () => {
  const long: Hunk = {
    ...secondHunk,
    lines: Array.from({ length: 45 }, (_, index) => ({
      kind: "add" as const,
      text: `line ${index + 1}`,
      oldLine: null,
      newLine: index + 1,
      noNewlineAtEnd: false,
    })),
  };

  it("is the lines a point rests on, with their markers", () => {
    expect(codeOf(long, { hunkId: long.id, side: "new", startLine: 2, line: 3 })).toEqual([
      "+line 2",
      "+line 3",
    ]);
  });

  it("is at most the limit, the rest counted", () => {
    const code = codeOf(long, { hunkId: long.id, side: "new", startLine: 1, line: 45 });
    expect(code).toHaveLength(MAX_POINT_LINES + 1);
    expect(code.at(-1)).toBe("… 5 more lines");
  });
});
