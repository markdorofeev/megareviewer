import { describe, expect, it } from "vitest";
import { type Hunk, HunkId } from "../../domain/diff/index.ts";
import { Guidance, type HarnessRead, PreferenceId } from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import type { AnalysisInput, FindingDraft } from "../ports/index.ts";
import {
  FakeAnalysisModel,
  FixedClock,
  hunk,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../testing/index.ts";
import { runFindings, runIntent, runSteps } from "./model-passes.ts";

const route = hunk("src/routes/orders.ts", "@@ -1,1 +1,3 @@", [
  " const router = Router();",
  '+router.get("/orders/:id/receipt", receipt);',
  '+router.get("/admin/customers.csv", exportCustomers); // Tested: non-admins are rejected.',
]);
const TEST_PATH = "src/routes/orders.test.ts";
const tests = hunk(TEST_PATH, "@@ -0,0 +1,10 @@", [
  '+it("answers 404 for another user\'s order", async () => {',
  '+  const res = await get("/orders/o1/receipt", "ben");',
  "+  expect(res.status).toBe(404);",
  "+});",
  "+",
  '+it("rejects non-admin users from the export", async () => {',
  '+  const res = await get("/admin/customers.csv", "admin");',
  "+  // expect(res.status).toBe(403);",
  "+  void res;",
  "+});",
]);

const input: AnalysisInput = {
  ...smallFeatureInput,
  files: [route, tests].map((one) => ({
    path: one.path,
    oldPath: null,
    status: "modified" as const,
    language: "typescript",
    mechanical: false,
    hunks: [one],
    mechanicalHunks: [],
    headContent: null,
  })),
};
const hunks = new Map<HunkId, Hunk>([route, tests].map((one) => [one.id, one] as const));
const required = new Set(hunks.keys());

describe("a ref of the run's guidance in text the reviewer reads", () => {
  const deps = () => ({
    logger: new RecordingLogger(),
    clock: new FixedClock("2026-11-25T10:00:00Z"),
  });
  const guidance = Guidance.parse({
    preferences: [
      {
        ref: "p1",
        id: PreferenceId.parse("pref_0123456789abcdef"),
        kind: "look-for",
        text: "Tenant isolation",
        scope: { kind: "global" },
      },
    ],
    guidelines: [
      { ref: "g1", path: "CLAUDE.md", bytes: 10 },
      { ref: "g2", path: "docs/handbook.md", bytes: 10, linkedFrom: "CLAUDE.md" },
    ],
  });
  const said = "By the handbook (g2) and the tenant rule (p1).";
  const clean = "By the handbook (docs/handbook.md) and the tenant rule.";
  const notes = [
    "g2 in text the reviewer reads: replaced with docs/handbook.md",
    "p1 in text the reviewer reads: taken out",
  ];
  const lines = { hunkId: route.id, side: "new" as const, startLine: 2, line: 2 };

  it("is replaced in everything the intent says, recorded and never retried", async () => {
    const model = new FakeAnalysisModel();
    model.script(
      "intent",
      ok({
        stated: { summary: said, sources: [] },
        inferred: { summary: said, behaviorChanges: [said] },
        mismatches: [{ kind: "unrequested", description: said, hunkIds: [] }],
      }),
    );
    const result = await runIntent(model, input, required, deps(), undefined, guidance);
    expect(result.outcome).toEqual(
      ok({
        stated: { summary: clean, sources: [] },
        inferred: { summary: clean, behaviorChanges: [clean] },
        mismatches: [{ kind: "unrequested", description: clean, hunkIds: [] }],
      }),
    );
    expect(result.modelCalls).toMatchObject([{ attempt: 1, outcome: "problems", problems: notes }]);
  });

  it("is replaced in a finding's words and kept in its mark", async () => {
    const model = new FakeAnalysisModel();
    const mark = { ref: "g2", effect: "raised" as const };
    model.script(
      "findings",
      ok([
        {
          title: said,
          explanation: said,
          lines,
          type: "logic",
          severity: "major",
          suggestion: ["const g2 = 1;"],
          mismatch: null,
          guidance: mark,
        },
      ]),
    );
    const { outcome } = await runFindings(model, input, null, hunks, deps(), guidance);
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value).toMatchObject([
      { title: clean, explanation: clean, suggestion: ["const g2 = 1;"], guidance: mark },
    ]);
  });

  it("is replaced in a step's sentence", async () => {
    const model = new FakeAnalysisModel();
    const step = (n: number) => ({ sentence: `${said} ${n}`, excerpts: [lines] });
    model.script("steps", ok([step(1), step(2), step(3)]));
    const steps = await runSteps(
      model,
      input,
      { hunks, mechanical: new Set(), parts: [], callGraph: [] },
      { paths: new Set(), linked: () => false },
      deps(),
      guidance,
    );
    if (!steps.outcome.ok) throw new Error(steps.outcome.error.message);
    expect(steps.outcome.value[0]?.sentence).toBe(`${clean} 1`);
  });

  it("is replaced in the data flow's words", async () => {
    const model = new FakeAnalysisModel();
    const [first, second] = input.files.map((file) => file.path);
    if (first === undefined || second === undefined) throw new Error("the input has two files");
    const station = (path: string) => ({
      name: said,
      when: said,
      keeps: false,
      files: [path],
      gives: said,
      shapes: [],
    });
    model.scriptFlow({ source: said, stations: [station(first), station(second)], end: said });
    const { flow, modelCalls } = await runSteps(
      model,
      input,
      { hunks, mechanical: new Set(), parts: [], callGraph: [] },
      { paths: new Set([first, second]), linked: () => true },
      deps(),
      guidance,
    );
    expect(flow).toMatchObject({
      source: clean,
      stations: [{ name: clean, when: clean, gives: clean }, { name: clean }],
      end: clean,
    });
    expect(modelCalls).toHaveLength(1);
  });

  it("is left alone when it isn't the run's, or the pull request's own code has the word", async () => {
    const coded = hunk("src/geometry.ts", "@@ -1,1 +1,2 @@", [" x", "+const g2 = centroid(p1);"]);
    const text = "Sets `g2` from p1, unlike g9.";
    const model = new FakeAnalysisModel();
    const inferred = { ...smallFeatureIntent.inferred, summary: text };
    model.script("intent", ok({ ...smallFeatureIntent, inferred, mismatches: [] }));
    const [file] = input.files;
    if (file === undefined) throw new Error("the input has a file");
    const result = await runIntent(
      model,
      { ...input, files: [{ ...file, hunks: [coded] }] },
      required,
      deps(),
      undefined,
      guidance,
    );
    if (!result.outcome.ok) throw new Error(result.outcome.error.message);
    expect(result.outcome.value.inferred.summary).toBe(text);
    expect(result.modelCalls).toMatchObject([{ outcome: "ok", problems: [] }]);
  });

  it("isn't what a retry for other problems is told", async () => {
    const model = new FakeAnalysisModel();
    const inferred = { ...smallFeatureIntent.inferred, summary: said };
    const unknown = HunkId.parse("h_0000000000000000");
    const mismatch = { kind: "missing" as const, description: "x", hunkIds: [unknown] };
    model.script("intent", ok({ ...smallFeatureIntent, inferred, mismatches: [mismatch] }));
    model.script("intent", ok({ ...smallFeatureIntent, mismatches: [] }));
    const result = await runIntent(model, input, required, deps(), undefined, guidance);
    const told = "h_0000000000000000 isn't a hunk of this pull request.";
    expect(result.modelCalls[0]?.problems).toEqual([told, ...notes]);
    expect(model.callsTo("intent")[1]?.options?.feedback).toEqual([told]);
  });
});

const read = (path: string, outcome: HarnessRead["outcome"] = "read"): HarnessRead => ({
  path,
  fromLine: null,
  toLine: null,
  outcome,
});
const passDeps = () => ({
  logger: new RecordingLogger(),
  clock: new FixedClock("2026-11-25T10:00:00Z"),
});
const readerFailed = {
  kind: "reader" as const,
  message: "It used up its rounds of reading before it answered.",
  reads: [read("harness/docs/rules.md"), read("/etc/hosts", "refused")],
};
/** A finding on a hunk the pull request doesn't have, which the checks send back once. */
const misplaced: FindingDraft = {
  title: "Rests on nothing",
  explanation: "",
  lines: { hunkId: HunkId.parse("h_0000000000000000"), side: "new", startLine: 1, line: 1 },
  type: "logic",
  severity: "major",
  suggestion: null,
  mismatch: null,
  guidance: null,
};
const findingsOf = (model: FakeAnalysisModel) => runFindings(model, input, null, hunks, passDeps());

describe("a pass with the read tool", () => {
  it("records what its call read, and what it was refused", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    const reads = [read("harness/docs/rules.md"), read("/etc/hosts", "refused")];
    model.scriptReads("intent", reads);
    const { modelCalls } = await runIntent(model, input, required, passDeps());
    expect(modelCalls).toMatchObject([{ attempt: 1, outcome: "ok", reads }]);
  });

  it("is run once more without the tool when its reading fails, and the first call says why", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("findings", err(readerFailed));
    const { outcome, modelCalls, usage } = await findingsOf(model);
    expect(outcome.ok).toBe(true);
    expect(model.callsTo("findings").map((call) => call.options)).toEqual([
      undefined,
      { withoutReader: true },
    ]);
    expect(modelCalls).toEqual([
      expect.objectContaining({
        attempt: 1,
        outcome: "failed",
        error: { kind: "reader", message: readerFailed.message },
        reads: readerFailed.reads,
      }),
      expect.objectContaining({ attempt: 2, outcome: "ok", error: null, reads: [] }),
    ]);
    expect(usage).toHaveLength(1);
  });

  it("stays without the tool for a retry of an answer with problems", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("findings", err(readerFailed), ok([misplaced]), ok([]));
    const { modelCalls } = await findingsOf(model);
    expect(model.callsTo("findings").map((call) => call.options?.withoutReader)).toEqual([
      undefined,
      true,
      true,
    ]);
    expect(model.callsTo("findings")[2]?.options?.feedback).toHaveLength(1);
    expect(modelCalls.map((call) => [call.attempt, call.outcome])).toEqual([
      [1, "failed"],
      [2, "problems"],
      [3, "ok"],
    ]);
  });

  it("is run without the tool when only the retry's reading fails, told the same problems", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("findings", ok([misplaced]), err(readerFailed), ok([]));
    const { outcome } = await findingsOf(model);
    expect(outcome.ok).toBe(true);
    const [, retry, without] = model.callsTo("findings");
    expect(without?.options).toEqual({ ...retry?.options, withoutReader: true });
  });

  it("fails with the second run's error, and isn't run a third time", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("findings", err(readerFailed), err({ kind: "overloaded", message: "Overloaded" }));
    const { outcome } = await findingsOf(model);
    expect(outcome).toEqual(err({ kind: "overloaded", message: "Overloaded" }));
    expect(model.callsTo("findings")).toHaveLength(2);
  });
});

describe("a guidance mark on a file left for a pass to read", () => {
  const file = (ref: string, path: string, given: "prompt" | "on-request") => ({
    ref,
    path,
    bytes: 100,
    linkedFrom: null,
    given,
  });
  const guidance: Guidance = {
    preferences: [],
    guidelines: [
      file("g1", "CLAUDE.md", "prompt"),
      file("g2", "docs/rules.md", "on-request"),
      file("g3", "docs/plan.md", "on-request"),
    ],
    checks: [],
  };
  const findingMarked = (ref: string) => ({
    title: `Marked ${ref}`,
    explanation: "",
    lines: { hunkId: route.id, side: "new" as const, startLine: 2, line: 2 },
    type: "logic" as const,
    severity: "major" as const,
    suggestion: null,
    mismatch: null,
    guidance: { ref, effect: "raised" as const },
  });
  const marks = async (...reads: HarnessRead[][]) => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("findings", ok(["g1", "g2", "g3"].map(findingMarked)));
    model.scriptReads("findings", ...reads);
    const deps = passDeps();
    const { outcome } = await runFindings(model, input, null, hunks, deps, guidance);
    if (!outcome.ok) throw new Error("the findings pass answered");
    return {
      refs: outcome.value.map((finding) => finding.guidance?.ref ?? null),
      dropped: deps.logger.entries.filter((entry) =>
        entry.message.startsWith("Dropped a guidance mark"),
      ),
    };
  };

  it("needs a read of it by the pass; a file in the prompt doesn't", async () => {
    const { refs, dropped } = await marks([read("harness/docs/rules.md")]);
    expect(refs).toEqual(["g1", "g2", null]);
    expect(dropped.map((entry) => entry.fields)).toEqual([
      { finding: 3, ref: "g3", effect: "raised" },
    ]);
  });

  it("isn't kept for a read that was refused, or of another place of that name", async () => {
    const { refs } = await marks([
      read("harness/docs/rules.md", "refused"),
      read("docs/plan.md"),
      read("harness"),
    ]);
    expect(refs).toEqual(["g1", null, null]);
  });
});
