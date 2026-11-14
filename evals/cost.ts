import type { Baseline } from "./baseline.ts";

/** Per case before anything was measured, at API prices: a few cents of Haiku passes plus the Opus judge. */
export const UNMEASURED_COST_PER_CASE_USD = 0.15;

export interface CostEstimate {
  readonly totalUsd: number;
  /** Cases priced at what they cost on the baseline. */
  readonly measured: number;
  /** Cases priced at the baseline's average, or the assumed figure without a baseline. */
  readonly assumed: number;
  readonly assumedPerCaseUsd: number;
}

/**
 * What a run of these cases will cost: each case at its cost on the baseline when it has one,
 * the rest at the baseline's average per case, or at the assumed figure before any baseline.
 */
export const estimateCost = (cases: readonly string[], baseline: Baseline | null): CostEstimate => {
  const known = baseline === null ? [] : Object.values(baseline.cases);
  const assumedPerCaseUsd =
    known.length === 0
      ? UNMEASURED_COST_PER_CASE_USD
      : known.reduce((total, c) => total + c.costUsd, 0) / known.length;
  const costs = cases.map((name) => baseline?.cases[name]?.costUsd);
  const measured = costs.filter((cost) => cost !== undefined);
  return {
    totalUsd:
      measured.reduce((total, cost) => total + cost, 0) +
      (cases.length - measured.length) * assumedPerCaseUsd,
    measured: measured.length,
    assumed: cases.length - measured.length,
    assumedPerCaseUsd,
  };
};
