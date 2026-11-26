import type { AnalysisInput, FindingDraft } from "../../application/ports/index.ts";
import { type PullRequestFixture, smallFeature } from "../../application/testing/index.ts";
import { pullRequestUrl } from "../../domain/review/index.ts";
import { hunkWith, lineOf } from "./hunks.ts";

const ref = { ...smallFeature.pullRequest.ref, number: 108 };

/**
 * small-feature again, on the fake server only: the shared fixture is every test's and every
 * eval's. Its AI review has a finding of each type, one of each severity.
 */
export const receiptsTyped: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-typed",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, with a finding of each type`,
  },
};

/** The typed PR's findings, the least severe first, as a model may list them. */
export const typedFindings = (input: AnalysisInput): FindingDraft[] => {
  const route = hunkWith(input, "src/routes/orders.ts", 'get("/orders/:id/receipt"');
  const receipts = hunkWith(input, "src/services/receipts.ts", "renderReceipt");
  const limit = hunkWith(input, "config/app.yaml", "perMinute: 600");
  if (route === undefined || receipts === undefined || limit === undefined) return [];
  const cache = lineOf(receipts, "const cache = new Map");
  const format = lineOf(receipts, "const formatCents");
  const perMinute = lineOf(limit, "perMinute");
  const shared = { suggestion: null, mismatch: null, guidance: null };
  return [
    {
      title: "Receipts are never removed from memory",
      explanation:
        "`cache` keeps every receipt rendered until the server restarts: an expired one is only written over when the same order is asked for again.",
      lines: { hunkId: receipts.id, side: "new", startLine: cache, line: cache },
      type: "logic",
      severity: "minor",
      ...shared,
    },
    {
      title: "Any client can send ten times the requests",
      explanation:
        "`perMinute` goes from 60 to 600 for every route, so a client the limit stops today can reach sign-in and payment ten times as often.",
      lines: { hunkId: limit.id, side: "new", startLine: perMinute, line: perMinute },
      type: "contract",
      severity: "blocking",
      ...shared,
    },
    {
      title: "Formats prices beside the code that already does",
      explanation:
        "`formatCents` writes again what the orders service has, so a receipt and an order can show one price two ways.",
      lines: { hunkId: receipts.id, side: "new", startLine: format, line: format },
      type: "architecture",
      severity: "major",
      ...shared,
    },
  ];
};
