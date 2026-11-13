import { beforeEach, describe, expect, it } from "vitest";
import { Intent, ModelUsage, validateTourTitles } from "../../../domain/review/index.ts";
import {
  type AnalysisModel,
  DecisionDraft,
  ModelRisk,
  type PassOutput,
  TourDraft,
} from "../../ports/index.ts";
import {
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
  smallFeatureSkeleton,
} from "../fixtures/index.ts";

// Later passes take the fixture analysis's earlier results rather than this model's, so each
// pass's request is the same on every run and can be recorded once.
const intent = smallFeatureIntent;
const risk = smallFeatureAnalysis.risk.flatMap(({ hunkId, riskClass, reason }) =>
  riskClass === "mechanical" ? [] : [{ hunkId, riskClass, reason }],
);
const decisions = smallFeatureAnalysis.decisions;
const skeleton = { tour: smallFeatureSkeleton, parts: [] };

const expectUsage = (output: PassOutput<unknown>, pass: ModelUsage["pass"]) => {
  expect(ModelUsage.parse(output.usage)).toEqual(output.usage);
  expect(output.usage.pass).toBe(pass);
};

export const describeAnalysisModelContract = (
  name: string,
  createModel: () => AnalysisModel,
): void => {
  describe(`AnalysisModel contract: ${name}`, () => {
    let model: AnalysisModel;
    beforeEach(() => {
      model = createModel();
    });

    it("has a version", () => {
      expect(model.version).not.toBe("");
    });

    it("measures the input", async () => {
      const result = await model.checkSize(smallFeatureInput);
      if (!result.ok) throw new Error(`checkSize failed: ${result.error.message}`);
      expect(result.value.inputTokens).toBeGreaterThan(0);
    });

    it("returns an intent", async () => {
      const result = await model.intent(smallFeatureInput);
      if (!result.ok) throw new Error(`intent failed: ${result.error.message}`);

      expect(Intent.parse(result.value.value)).toEqual(result.value.value);
      expectUsage(result.value, "intent");
    });

    it("returns risk classifications", async () => {
      const result = await model.risk(smallFeatureInput, intent);
      if (!result.ok) throw new Error(`risk failed: ${result.error.message}`);

      for (const item of result.value.value) expect(ModelRisk.parse(item)).toEqual(item);
      expectUsage(result.value, "risk");
    });

    it("returns decisions", async () => {
      const result = await model.decisions(smallFeatureInput, intent);
      if (!result.ok) throw new Error(`decisions failed: ${result.error.message}`);

      for (const item of result.value.value) expect(DecisionDraft.parse(item)).toEqual(item);
      expectUsage(result.value, "decisions");
    });

    it("titles the code's tour", async () => {
      const result = await model.tour(smallFeatureInput, intent, risk, decisions, skeleton);
      if (!result.ok) throw new Error(`tour failed: ${result.error.message}`);

      expect(TourDraft.parse(result.value.value)).toEqual(result.value.value);
      expect(validateTourTitles(result.value.value, smallFeatureSkeleton)).toEqual([]);
      expectUsage(result.value, "tour");
    });
  });
};
