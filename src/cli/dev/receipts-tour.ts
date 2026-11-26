import type { AnalysisInput, AnalysisModel } from "../../application/ports/index.ts";
import { type PullRequestFixture, smallFeature } from "../../application/testing/index.ts";
import { pullRequestUrl, type StepDraft } from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";
import { hunkWith, lineOf } from "./hunks.ts";

const ref = { ...smallFeature.pullRequest.ref, number: 106 };

/**
 * small-feature again, on the fake server only, whose steps pass writes a tour: the shared fixture
 * is every test's and every eval's, and the fake model writes none of its own.
 */
export const receiptsTour: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-tour",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, with a tour`,
  },
};

/** The tour the fake model writes of receipts-tour: the route, the receipt it renders, the config. */
const stepsOf = (input: AnalysisInput): StepDraft[] => {
  const route = hunkWith(input, "src/routes/orders.ts", 'get("/orders/:id/receipt"');
  const receipt = hunkWith(input, "src/services/receipts.ts", "export function renderReceipt");
  const config = hunkWith(input, "config/app.yaml", "currency: USD");
  if (route === undefined || receipt === undefined || config === undefined) return [];
  const on = (hunk: typeof route, from: string, to: string) => ({
    hunkId: hunk.id,
    side: "new" as const,
    startLine: lineOf(hunk, from),
    line: lineOf(hunk, to),
  });
  return [
    {
      sentence: "`GET /orders/:id/receipt` sends the user's own order's receipt as plain text",
      excerpts: [on(route, 'get("/orders/:id/receipt"', "renderReceipt(order)")],
    },
    {
      sentence:
        "`renderReceipt` serves a receipt from memory for an hour before rendering it again",
      excerpts: [on(receipt, "export function renderReceipt", "return text;")],
    },
    {
      sentence: "The app config adds a receipt currency and footer",
      excerpts: [on(config, "- phone", "footer:")],
    },
  ];
};

/** The model, but receipts-tour's steps pass answers with its tour, after the model's own time. */
export const withTour = (model: AnalysisModel, url: string): AnalysisModel => ({
  version: model.version,
  readsHarness: model.readsHarness,
  checkSize: (input) => model.checkSize(input),
  intent: (input, options) => model.intent(input, options),
  findings: (input, intent, options) => model.findings(input, intent, options),
  async steps(input, options) {
    const answer = await model.steps(input, options);
    if (!answer.ok || input.pullRequest.url !== url) return answer;
    return ok({ ...answer.value, value: stepsOf(input) });
  },
});
