import { describe, expect, it } from "vitest";
import { FakeAnalysisModel, smallFeatureInput } from "../../application/testing/index.ts";
import { validateStops } from "../../domain/review/index.ts";
import { receiptsTour, withTour } from "./receipts-tour.ts";

const inputOf = (url: string) => ({
  ...smallFeatureInput,
  pullRequest: { ...smallFeatureInput.pullRequest, url },
});

describe("receipts-tour on the fake server", () => {
  const model = withTour(new FakeAnalysisModel(), receiptsTour.pullRequest.url);

  it("writes three stops the server's checks pass", async () => {
    const answer = await model.stops(inputOf(receiptsTour.pullRequest.url));
    if (!answer.ok) throw new Error("the fake model answers");
    const stops = answer.value.value;
    expect(stops).toHaveLength(3);
    const hunks = new Map(
      smallFeatureInput.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
    );
    expect(
      validateStops(stops, {
        hunks,
        mechanical: new Set(),
        parts: [],
        callGraph: smallFeatureInput.callGraph,
      }),
    ).toEqual([]);
    expect(stops.every((stop) => stop.excerpts.every((one) => one.line - one.startLine >= 3))).toBe(
      true,
    );
  });

  it("writes none for any other pull request", async () => {
    const answer = await model.stops(inputOf(smallFeatureInput.pullRequest.url));
    expect(answer.ok && answer.value.value).toEqual([]);
  });
});
