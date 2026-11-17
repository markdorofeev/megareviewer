import { describe, expect, it } from "vitest";
import type { Hunk, HunkId } from "../../domain/diff/index.ts";
import { ok } from "../../domain/shared/index.ts";
import type { AnalysisInput, ModelRisk } from "../ports/index.ts";
import {
  FakeAnalysisModel,
  FixedClock,
  hunk,
  RecordingLogger,
  smallFeatureInput,
} from "../testing/index.ts";
import { runRisk } from "./model-passes.ts";

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
