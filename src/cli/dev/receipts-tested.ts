import type {
  AnalysisInput,
  AnalysisModel,
  ModelCheckingTest,
  ModelRisk,
} from "../../application/ports/index.ts";
import { type PullRequestFixture, smallFeature } from "../../application/testing/index.ts";
import type { Hunk } from "../../domain/diff/index.ts";
import { pullRequestUrl } from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";

const TEST_PATH = "src/routes/orders.test.ts";

const TEST_FILE = `import request from "supertest";
import { describe, expect, it } from "vitest";
import { appWith, order } from "../testing.ts";

describe("GET /orders/:id/receipt", () => {
  it("answers 404 for another user's order", async () => {
    const app = appWith({ orders: [order({ id: "o1", userId: "ana" })] });
    const res = await request(app).get("/orders/o1/receipt").set("x-user", "ben");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("Receipt");
  });

  it("renders the order's lines and total", async () => {
    const items = [{ name: "Mug", quantity: 2, priceCents: 1250 }];
    const app = appWith({ orders: [order({ id: "o1", userId: "ana", items })] });
    const res = await request(app).get("/orders/o1/receipt").set("x-user", "ana");
    expect(res.type).toBe("text/plain");
    expect(res.text).toContain("2 x Mug  12.50");
    expect(res.text).toContain("Total: 25.00");
  });
});
`;

const testDiff = (): string => {
  const lines = TEST_FILE.trimEnd().split("\n");
  return [
    `diff --git a/${TEST_PATH} b/${TEST_PATH}`,
    "new file mode 100644",
    "index 0000000..c2a91fb",
    "--- /dev/null",
    `+++ b/${TEST_PATH}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
};

const ref = { ...smallFeature.pullRequest.ref, number: 105 };

/**
 * small-feature with a test of its receipt route, on the fake server only: the shared fixture is
 * every test's and every eval's. Its risk pass, below, has a risk a test checks beside one none does.
 */
export const receiptsTested: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-tested",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, with tests`,
    diff: `${smallFeature.pullRequest.diff}${testDiff()}`,
  },
  headFiles: { ...smallFeature.headFiles, [TEST_PATH]: TEST_FILE },
};

const hunkWith = (input: AnalysisInput, path: string, text: string): Hunk | undefined =>
  input.files
    .find((file) => file.path === path)
    ?.hunks.find((hunk) => hunk.lines.some((line) => line.text.includes(text)));

const lineOf = (hunk: Hunk, text: string): number =>
  hunk.lines.find((line) => line.kind !== "del" && line.text.includes(text))?.newLine ?? 1;

/** The risks the fake model raises on receipts-tested: the route a test checks, the limit none does. */
const risksOf = (input: AnalysisInput): ModelRisk[] => {
  const route = hunkWith(input, "src/routes/orders.ts", 'get("/orders/:id/receipt"');
  const limit = hunkWith(input, "config/app.yaml", "perMinute: 600");
  const test = hunkWith(input, TEST_PATH, "answers 404");
  const checkedBy: ModelCheckingTest | null =
    test === undefined
      ? null
      : {
          hunkId: test.id,
          test: "answers 404 for another user's order",
          startLine: lineOf(test, "toBe(404)"),
          line: lineOf(test, 'not.toContain("Receipt")'),
          checks: "Another user's order gets 404 and no receipt text.",
        };
  return input.files.flatMap((file) =>
    file.hunks.map((hunk): ModelRisk => {
      if (hunk.id === route?.id) {
        return {
          hunkId: hunk.id,
          riskClass: "contract",
          reason:
            "Any signed-in user could read another user's receipt if the lookup stopped scoping by user.",
          lines: {
            hunkId: hunk.id,
            side: "new",
            startLine: lineOf(hunk, 'get("/orders/:id/receipt"'),
            line: lineOf(hunk, "findOrder("),
          },
          checkedBy,
        };
      }
      if (hunk.id === limit?.id) {
        const line = lineOf(hunk, "perMinute");
        return {
          hunkId: hunk.id,
          riskClass: "contract",
          reason: "Every client can now send ten times as many requests a minute to the API.",
          lines: { hunkId: hunk.id, side: "new", startLine: line, line },
          checkedBy: null,
        };
      }
      return { hunkId: hunk.id, riskClass: "logic", reason: "", lines: null, checkedBy: null };
    }),
  );
};

/** The model, but receipts-tested's risk pass answers with its risks, after the model's own time. */
export const withCheckingTests = (model: AnalysisModel, url: string): AnalysisModel => ({
  version: model.version,
  checkSize: (input) => model.checkSize(input),
  intent: (input, options) => model.intent(input, options),
  findings: (input, intent, options) => model.findings(input, intent, options),
  async risk(input, options) {
    const answer = await model.risk(input, options);
    if (!answer.ok || input.pullRequest.url !== url) return answer;
    return ok({ ...answer.value, value: risksOf(input) });
  },
  decisions: (input, options) => model.decisions(input, options),
});
