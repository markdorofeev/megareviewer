import type { AnalysisInput, AnalysisModel, FindingDraft } from "../../application/ports/index.ts";
import { ok } from "../../domain/shared/index.ts";

/** The model, but the PR's findings pass answers `findingsOf`, after its own time. */
export const withFindings = (
  model: AnalysisModel,
  url: string,
  findingsOf: (input: AnalysisInput) => FindingDraft[],
): AnalysisModel => ({
  version: model.version,
  readsHarness: model.readsHarness,
  checkSize: (input) => model.checkSize(input),
  intent: (input, options) => model.intent(input, options),
  async findings(input, intent, options) {
    const answer = await model.findings(input, intent, options);
    if (!answer.ok || input.pullRequest.url !== url) return answer;
    return ok({ ...answer.value, value: findingsOf(input) });
  },
  steps: (input, options) => model.steps(input, options),
});
