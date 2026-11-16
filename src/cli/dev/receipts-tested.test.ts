import { describe, expect, it } from "vitest";
import type { AnalysisInput } from "../../application/ports/index.ts";
import {
  FakeAnalysisModel,
  smallFeature,
  smallFeatureInput,
} from "../../application/testing/index.ts";
import { parseUnifiedDiff } from "../../domain/diff/index.ts";
import { checkingTestProblem } from "../../domain/review/index.ts";
import { receiptsTested, withCheckingTests } from "./receipts-tested.ts";

const inputOf = (url: string): AnalysisInput => {
  const parsed = parseUnifiedDiff(receiptsTested.pullRequest.diff);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return {
    ...smallFeatureInput,
    pullRequest: { ...smallFeatureInput.pullRequest, url },
    files: parsed.value.map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      language: file.language,
      mechanical: false,
      hunks: file.hunks,
      mechanicalHunks: [],
      headContent: receiptsTested.headFiles[file.path] ?? null,
    })),
  };
};

const risksFor = async (url: string) => {
  const input = inputOf(url);
  const hunks = new Map(input.files.flatMap((file) => file.hunks.map((one) => [one.id, one])));
  const model = withCheckingTests(new FakeAnalysisModel(), receiptsTested.pullRequest.url);
  const answer = await model.risk(input);
  if (!answer.ok) throw new Error("the fake model answers");
  const pathOf = (hunkId: string) =>
    input.files.find((file) => file.hunks.some((one) => one.id === hunkId))?.path;
  return answer.value.value
    .filter((risk) => risk.riskClass === "contract")
    .map((risk) => {
      const claim = risk.checkedBy;
      // As the server checks it, before it keeps it.
      const problem =
        claim === null
          ? null
          : checkingTestProblem(
              {
                test: claim.test,
                checks: claim.checks,
                lines: {
                  hunkId: claim.hunkId,
                  side: "new",
                  startLine: claim.startLine,
                  line: claim.line,
                },
              },
              hunks,
              new Set(hunks.keys()),
              receiptsTested.headFiles[pathOf(claim.hunkId) ?? ""] ?? null,
            );
      return [
        pathOf(risk.hunkId),
        risk.lines === null ? null : [risk.lines.startLine, risk.lines.line],
        claim?.test ?? null,
        problem,
      ];
    });
};

describe("receipts-tested on the fake server", () => {
  it("is small-feature with a test of the receipt route, as a PR of its own", () => {
    expect(receiptsTested.pullRequest.url).not.toBe(smallFeature.pullRequest.url);
    expect(receiptsTested.pullRequest.diff.startsWith(smallFeature.pullRequest.diff)).toBe(true);
    expect(Object.keys(receiptsTested.headFiles)).toContain("src/routes/orders.test.ts");
  });

  it("has a risk a test checks, as the server checks it, beside one none does", async () => {
    expect(await risksFor(receiptsTested.pullRequest.url)).toEqual([
      ["config/app.yaml", [13, 13], null, null],
      ["src/routes/orders.ts", [33, 34], "answers 404 for another user's order", null],
    ]);
  });

  it("leaves another PR's risk pass to the model", async () => {
    expect(await risksFor(smallFeature.pullRequest.url)).toEqual([]);
  });
});
