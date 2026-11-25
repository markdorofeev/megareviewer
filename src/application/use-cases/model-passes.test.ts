import { describe, expect, it } from "vitest";
import type { Hunk, HunkId } from "../../domain/diff/index.ts";
import type { Guidance, HarnessRead } from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import type { AnalysisInput, ModelRisk } from "../ports/index.ts";
import {
  FakeAnalysisModel,
  FixedClock,
  hunk,
  RecordingLogger,
  smallFeatureInput,
} from "../testing/index.ts";
import { runFindings, runIntent, runRisk } from "./model-passes.ts";

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

const contract = (checkedBy: ModelRisk["checkedBy"]): ModelRisk => ({
  hunkId: route.id,
  riskClass: "contract",
  reason: "Any signed-in user could read another user's receipt.",
  lines: { hunkId: route.id, side: "new", startLine: 2, line: 2 },
  checkedBy,
  guidance: null,
});
const logic = (hunkId: HunkId): ModelRisk => ({
  hunkId,
  riskClass: "logic",
  reason: "Tests.",
  lines: null,
  checkedBy: null,
  guidance: null,
});
const named = (test: string, startLine: number, line: number) => ({
  hunkId: tests.id,
  test,
  startLine,
  line,
  checks: "Another user's order gets 404.",
});

const riskWith = async (...answer: ModelRisk[]) => {
  const model = new FakeAnalysisModel();
  model.script("risk", ok(answer));
  const logger = new RecordingLogger();
  const result = await runRisk(model, input, required, hunks, {
    logger,
    clock: new FixedClock("2026-11-16T10:00:00Z"),
  });
  if (!result.outcome.ok) throw new Error("the risk pass answered");
  return {
    risk: result.outcome.value,
    calls: model.callsTo("risk").length,
    dropped: logger.entries.filter((entry) => entry.message.startsWith("Dropped a checking test")),
  };
};

describe("runRisk's checking tests", () => {
  it("keeps one the server can check, on the head side of the test's hunk", async () => {
    const { risk, dropped } = await riskWith(
      contract(named("answers 404 for another user's order", 3, 3)),
      logic(tests.id),
    );
    expect(risk[0]?.checkedBy).toEqual({
      test: "answers 404 for another user's order",
      checks: "Another user's order gets 404.",
      lines: { hunkId: tests.id, side: "new", startLine: 3, line: 3 },
    });
    expect(dropped).toEqual([]);
  });

  it("drops one on a logic hunk: only a risk carries the mark", async () => {
    const { risk } = await riskWith(
      { ...contract(named("answers 404 for another user's order", 3, 3)), riskClass: "logic" },
      logic(tests.id),
    );
    expect(risk[0]?.checkedBy).toBeUndefined();
  });

  it("drops one the server can't check, without a retry, and keeps the risk where it was", async () => {
    // The name of the test that never asserts, its commented-out assertion, and the code's own
    // comment saying it's tested.
    const { risk, calls, dropped } = await riskWith(
      contract(named("rejects non-admin users from the export", 6, 9)),
      logic(tests.id),
    );
    expect(risk[0]).toMatchObject({ hunkId: route.id, riskClass: "contract", source: "model" });
    expect(risk[0]?.checkedBy).toBeUndefined();
    expect(calls).toBe(1);
    expect(dropped.map((entry) => entry.fields)).toEqual([
      { hunkId: route.id, testHunkId: tests.id, problem: "no-assertion" },
    ]);
  });

  it("drops one that names the risky code itself as its test", async () => {
    const { risk, dropped } = await riskWith(
      contract({ ...named("Tested: non-admins are rejected.", 3, 3), hunkId: route.id }),
      logic(tests.id),
    );
    expect(risk[0]?.checkedBy).toBeUndefined();
    expect(dropped[0]?.fields?.problem).toBe("not-a-test");
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
    model.script("risk", err(readerFailed));
    const { outcome, modelCalls, usage } = await runRisk(model, input, required, hunks, passDeps());
    expect(outcome.ok).toBe(true);
    expect(model.callsTo("risk").map((call) => call.options)).toEqual([
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
    model.script("risk", err(readerFailed), ok([]), ok([logic(route.id), logic(tests.id)]));
    const { modelCalls } = await runRisk(model, input, required, hunks, passDeps());
    expect(model.callsTo("risk").map((call) => call.options?.withoutReader)).toEqual([
      undefined,
      true,
      true,
    ]);
    expect(model.callsTo("risk")[2]?.options?.feedback).toHaveLength(2);
    expect(modelCalls.map((call) => [call.attempt, call.outcome])).toEqual([
      [1, "failed"],
      [2, "problems"],
      [3, "ok"],
    ]);
  });

  it("is run without the tool when only the retry's reading fails, told the same problems", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("risk", ok([]), err(readerFailed), ok([logic(route.id), logic(tests.id)]));
    const { outcome } = await runRisk(model, input, required, hunks, passDeps());
    expect(outcome.ok).toBe(true);
    const [, retry, without] = model.callsTo("risk");
    expect(without?.options).toEqual({ ...retry?.options, withoutReader: true });
  });

  it("fails with the second run's error, and isn't run a third time", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script("risk", err(readerFailed), err({ kind: "overloaded", message: "Overloaded" }));
    const { outcome } = await runRisk(model, input, required, hunks, passDeps());
    expect(outcome).toEqual(err({ kind: "overloaded", message: "Overloaded" }));
    expect(model.callsTo("risk")).toHaveLength(2);
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

  it("is kept on a risk by what its own pass read", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    model.script(
      "risk",
      ok([{ ...contract(null), guidance: { ref: "g2", effect: "raised" } }, logic(tests.id)]),
    );
    model.scriptReads("risk", [read("harness/docs/rules.md")]);
    const { outcome } = await runRisk(model, input, required, hunks, passDeps(), guidance);
    expect(outcome.ok && outcome.value[0]?.guidance).toEqual({ ref: "g2", effect: "raised" });
  });
});
