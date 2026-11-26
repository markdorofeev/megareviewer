import { describe, expect, it } from "vitest";
import { FakeAnalysisModel, smallFeatureInput } from "../../application/testing/index.ts";
import { validateSteps } from "../../domain/review/index.ts";
import { receiptsTour, withTour } from "./receipts-tour.ts";

const inputOf = (url: string) => ({
  ...smallFeatureInput,
  pullRequest: { ...smallFeatureInput.pullRequest, url },
});

describe("receipts-tour on the fake server", () => {
  const model = withTour(new FakeAnalysisModel(), receiptsTour.pullRequest.url);

  it("writes three steps the server's checks pass", async () => {
    const answer = await model.steps(inputOf(receiptsTour.pullRequest.url));
    if (!answer.ok) throw new Error("the fake model answers");
    const steps = answer.value.value;
    expect(steps).toHaveLength(3);
    const hunks = new Map(
      smallFeatureInput.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
    );
    expect(validateSteps(steps, { hunks, mechanical: new Set() })).toEqual([]);
    expect(steps.every((step) => step.excerpts.every((one) => one.line - one.startLine >= 3))).toBe(
      true,
    );
  });

  it("writes none for any other pull request", async () => {
    const answer = await model.steps(inputOf(smallFeatureInput.pullRequest.url));
    expect(answer.ok && answer.value.value).toEqual([]);
  });
});
