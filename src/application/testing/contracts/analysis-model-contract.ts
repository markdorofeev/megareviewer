import { beforeEach, describe, expect, it } from "vitest";
import { Intent, ModelUsage, validateFindings } from "../../../domain/review/index.ts";
import {
  type AnalysisModel,
  DecisionDraft,
  FindingDraft,
  ModelRisk,
  type PassOutput,
} from "../../ports/index.ts";
import { smallFeatureInput } from "../fixtures/index.ts";

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

    it("returns findings on lines of the PR's hunks", async () => {
      const result = await model.findings(smallFeatureInput);
      if (!result.ok) throw new Error(`findings failed: ${result.error.message}`);

      const hunks = new Map(
        smallFeatureInput.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
      );
      for (const item of result.value.value) expect(FindingDraft.parse(item)).toEqual(item);
      expect(validateFindings(result.value.value, hunks)).toEqual([]);
      expectUsage(result.value, "findings");
    });

    it("returns risk classifications", async () => {
      const result = await model.risk(smallFeatureInput);
      if (!result.ok) throw new Error(`risk failed: ${result.error.message}`);

      for (const item of result.value.value) expect(ModelRisk.parse(item)).toEqual(item);
      expectUsage(result.value, "risk");
    });

    it("returns decisions", async () => {
      const result = await model.decisions(smallFeatureInput);
      if (!result.ok) throw new Error(`decisions failed: ${result.error.message}`);

      for (const item of result.value.value) expect(DecisionDraft.parse(item)).toEqual(item);
      expectUsage(result.value, "decisions");
    });
  });
};
