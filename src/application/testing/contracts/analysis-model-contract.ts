import { beforeEach, describe, expect, it } from "vitest";
import {
  Intent,
  ModelUsage,
  StepDraft,
  validateFindings,
  validateSteps,
} from "../../../domain/review/index.ts";
import { type AnalysisModel, FindingDraft, type PassOutput } from "../../ports/index.ts";
import { smallFeatureInput, smallFeatureIntent } from "../fixtures/index.ts";

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
      const result = await model.findings(smallFeatureInput, smallFeatureIntent);
      if (!result.ok) throw new Error(`findings failed: ${result.error.message}`);

      const hunks = new Map(
        smallFeatureInput.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
      );
      for (const item of result.value.value) expect(FindingDraft.parse(item)).toEqual(item);
      expect(
        validateFindings(result.value.value, hunks, smallFeatureIntent.mismatches.length),
      ).toEqual([]);
      expectUsage(result.value, "findings");
    });

    it("returns steps on lines of the PR's hunks sent in full, in call order", async () => {
      const result = await model.steps(smallFeatureInput, { tour: true });
      if (!result.ok) throw new Error(`steps failed: ${result.error.message}`);

      const { steps, flow } = result.value.value;
      for (const item of steps) expect(StepDraft.parse(item)).toEqual(item);
      const paths = new Set(smallFeatureInput.files.map((file) => file.path));
      for (const station of flow?.stations ?? []) {
        for (const path of [...station.files, ...station.shapes]) expect(paths).toContain(path);
      }
      const hunks = new Map(
        smallFeatureInput.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
      );
      const mechanical = new Set(
        smallFeatureInput.files.flatMap((file) => file.mechanicalHunks.map((hunk) => hunk.hunkId)),
      );
      const context = { hunks, mechanical, parts: [], callGraph: smallFeatureInput.callGraph };
      expect(validateSteps(steps, context)).toEqual([]);
      expectUsage(result.value, "steps");
    });
  });
};
