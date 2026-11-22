import type {
  AdviceDraft,
  AnalysisInput,
  AnalysisModel,
  FindingDraft,
  GuardrailAdvisor,
} from "../../application/ports/index.ts";
import {
  FakeGuardrailAdvisor,
  type PullRequestFixture,
  smallFeature,
} from "../../application/testing/index.ts";
import { pullRequestUrl, sameRepo } from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";
import { hunkWith, lineOf } from "./receipts-tested.ts";

const repo = { ...smallFeature.pullRequest.ref.repo, repo: "checkout" };
const ref = { repo, number: 31 };

const BIOME_JSON = `{
  "$schema": "https://biomejs.dev/schemas/2.3.0/schema.json",
  "linter": {
    "enabled": true,
    "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } }
  }
}
`;

/**
 * small-feature in a repository of its own with a Biome config, on the fake server only: the
 * shared fixture is every test's and every eval's. Its AI review has a finding about a promise
 * Express never sees, which the guardrail call marks with a Biome rule the config doesn't name.
 */
export const receiptsChecked: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-checked",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, in a repository with Biome`,
  },
  baseFiles: { ...smallFeature.baseFiles, "biome.json": BIOME_JSON },
};

/** How long the fake guardrail call takes on receipts-checked, after the passes. */
export const MARKS_DELAY_MS = 1_500;

/**
 * The fake guardrail call: in receipts-checked's repository, every finding marked with a Biome rule
 * the config doesn't name; no marks elsewhere.
 */
export const checkedAdvisor = (delayMs = MARKS_DELAY_MS): GuardrailAdvisor => {
  const fake = new FakeGuardrailAdvisor();
  return {
    async advise(input) {
      const answered = await fake.advise(input);
      if (!answered.ok || !sameRepo(input.repo, repo)) return answered;
      // After the landing, so the page is seen putting the marks in without moving the code.
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const answer: AdviceDraft = {
        marks: input.points
          .filter((point) => point.kind === "finding")
          .map((point) => ({
            point: point.ref,
            guardrail: {
              kind: "lint-rule",
              tool: "biome",
              engine: "Biome",
              rule: "noMisusedPromises",
              on: false,
              does: "Reports a promise passed where its result is ignored.",
            },
          })),
      };
      return ok({ ...answered.value, value: answer });
    },
  };
};

/** The fake model's finding on the checked PR, which a Biome rule would have caught. */
const findingsOf = (input: AnalysisInput): FindingDraft[] => {
  const route = hunkWith(input, "src/routes/orders.ts", 'get("/orders/:id/receipt"');
  if (route === undefined) return [];
  const line = lineOf(route, 'get("/orders/:id/receipt"');
  return [
    {
      title: "A failed order lookup leaves the receipt request hanging",
      explanation:
        "Express 4 ignores the promise an `async` handler returns, so when `findOrder` rejects, nothing answers the request.",
      lines: { hunkId: route.id, side: "new", startLine: line, line },
      severity: "major",
      suggestion: null,
      mismatch: null,
      guidance: null,
    },
  ];
};

/** The model, but the checked PR's findings pass answers the above, after its own time. */
export const withGuardrails = (model: AnalysisModel, url: string): AnalysisModel => ({
  version: model.version,
  checkSize: (input) => model.checkSize(input),
  intent: (input, options) => model.intent(input, options),
  async findings(input, intent, options) {
    const answer = await model.findings(input, intent, options);
    if (!answer.ok || input.pullRequest.url !== url) return answer;
    return ok({ ...answer.value, value: findingsOf(input) });
  },
  risk: (input, options) => model.risk(input, options),
  decisions: (input, options) => model.decisions(input, options),
  steps: (input, options) => model.steps(input, options),
});
