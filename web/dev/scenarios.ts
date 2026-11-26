import { isScenario, type Scenario } from "../../src/cli/dev/model-recording.ts";
import {
  type Analysis,
  FindingId,
  mapModelStages,
  type StageName,
  type StageStatus,
} from "../../src/domain/review/index.ts";

export { isScenario, type Scenario };

/** The analysis before anyone asked Claude: the code's review alone. */
export const withoutModel = (analysis: Analysis): Analysis => ({
  ...analysis,
  stages: mapModelStages(analysis.stages, () => "skipped"),
  intent: null,
  findings: [],
  modelError: null,
  modelOption: null,
});

const rateLimited = {
  stage: "findings" as StageName,
  code: "model-error",
  message: "Your Claude plan's usage limit is reached. It resets at 2026-11-13 18:00.",
};

const pad = (findings: Analysis["findings"], to: number): Analysis["findings"] =>
  findings.length === 0
    ? findings
    : Array.from({ length: to }, (_, index) => {
        const finding = findings[index % findings.length];
        if (finding === undefined) throw new Error("unreachable: findings is not empty");
        return {
          ...finding,
          id: FindingId.parse(`f${index + 1}`),
          title: `${finding.title} (${index + 1})`,
        };
      });

const stages = (
  from: Analysis["stages"],
  statuses: Partial<Record<StageName, StageStatus>>,
): Analysis["stages"] => ({ ...from, ...statuses });

/** Points the "many" scenario makes, to test the list, Next and the tree. */
const MANY = 40;

/**
 * The analysis a scenario leaves once Claude's run ends: what landed, and what's missing and why.
 * The mock API plays these, so the page's wait and landing can be worked on without the model.
 */
export const afterModelRun = (analysis: Analysis, scenario: Scenario): Analysis => {
  switch (scenario) {
    case "ready":
    case "slow":
    case "invalid-then-ok":
      return analysis;
    case "nothing-found":
      return {
        ...analysis,
        // Nothing found means nothing to raise: no mismatch either.
        intent: analysis.intent === null ? null : { ...analysis.intent, mismatches: [] },
        findings: [],
      };
    case "many":
      return { ...analysis, findings: pad(analysis.findings, MANY) };
    case "limit-after-intent":
      return {
        ...analysis,
        findings: [],
        stages: stages(analysis.stages, { findings: "failed" }),
        modelError: rateLimited,
      };
    case "refusal":
      return {
        ...analysis,
        findings: [],
        stages: stages(analysis.stages, { findings: "failed" }),
        modelError: {
          stage: "findings",
          code: "model-error",
          message: "Claude declined to answer this task.",
        },
      };
    case "not-signed-in":
      return {
        ...withoutModel(analysis),
        stages: stages(
          mapModelStages(analysis.stages, () => "skipped"),
          { intent: "failed" },
        ),
        modelError: {
          stage: "intent",
          code: "model-error",
          message: "Claude Code isn't signed in. Run `claude` and sign in.",
        },
      };
  }
};
