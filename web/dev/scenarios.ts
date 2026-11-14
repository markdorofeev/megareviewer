import { isScenario, type Scenario } from "../../src/cli/dev/model-recording.ts";
import {
  type Analysis,
  DecisionId,
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
  decisions: [],
  risk: analysis.risk.map((risk) =>
    risk.source === "model" ? { ...risk, source: "rule" as const } : risk,
  ),
  modelError: null,
  modelOption: null,
});

const rateLimited = {
  stage: "risk" as StageName,
  code: "model-error",
  message: "Your Claude plan's usage limit is reached. It resets at 2026-11-13 18:00.",
};

const pad = (decisions: Analysis["decisions"], to: number): Analysis["decisions"] =>
  decisions.length === 0
    ? decisions
    : Array.from({ length: to }, (_, index) => {
        const decision = decisions[index % decisions.length];
        if (decision === undefined) throw new Error("unreachable: decisions is not empty");
        return {
          ...decision,
          id: DecisionId.parse(`d${index + 1}`),
          title: `${decision.title} (${index + 1})`,
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
        decisions: [],
        risk: analysis.risk.map((risk) =>
          risk.source === "model" ? { ...risk, riskClass: "logic" as const } : risk,
        ),
      };
    case "many":
      return { ...analysis, decisions: pad(analysis.decisions, MANY) };
    case "limit-after-findings":
      return {
        ...analysis,
        decisions: [],
        risk: analysis.risk.filter((risk) => risk.source !== "model"),
        stages: stages(analysis.stages, { risk: "failed", decisions: "skipped" }),
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
