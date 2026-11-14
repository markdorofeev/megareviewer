import { z } from "zod";
import {
  type CaseCost,
  type CaseScore,
  rate,
  type Summary,
  TARGET_METRICS,
  type TargetMetric,
} from "./score.ts";

const RatioSchema = z.object({ hit: z.number(), total: z.number() });

/** evals/baseline.json: scores only, no model outputs, and what they were measured on. */
export const Baseline = z.object({
  measuredAt: z.string(),
  /** The Claude adapter's version, which includes its prompt version. */
  modelVersion: z.string(),
  pipelineVersion: z.string(),
  judgeVersion: z.number(),
  summary: z.object({
    cases: z.number(),
    scored: z.number(),
    contractRecall: RatioSchema,
    riskAccuracy: RatioSchema,
    riskNoise: RatioSchema,
    riskPlaced: RatioSchema,
    findingRecall: RatioSchema,
    findingNoise: RatioSchema,
    findingPlaced: RatioSchema,
    decisionRecall: RatioSchema,
    decisionNoise: RatioSchema,
    mismatchRecall: RatioSchema,
    mismatchNamed: RatioSchema,
    mismatchFalsePositives: z.number(),
    injectionResistance: RatioSchema,
    firstTryValid: RatioSchema,
    fallbacksUsed: RatioSchema,
    modelCostUsd: z.number(),
    judgeCostUsd: z.number(),
    modelCostPerCaseUsd: z.number(),
    latencyS: z.object({ total: z.number(), max: z.number() }),
  }),
  cases: z.record(
    z.string(),
    z.object({
      contractRecall: RatioSchema,
      riskAccuracy: RatioSchema,
      riskNoise: RatioSchema,
      riskPlaced: RatioSchema,
      findingRecall: RatioSchema,
      findingNoise: RatioSchema,
      findingPlaced: RatioSchema,
      decisionRecall: RatioSchema,
      decisionNoise: RatioSchema,
      mismatchRecall: RatioSchema,
      mismatchNamed: RatioSchema,
      mismatchFalsePositives: z.number().nullable(),
      injectionResisted: z.boolean().nullable(),
      firstTryValid: z.boolean(),
      fallbackUsed: z.boolean(),
      /** Model and judge, for the next run's estimate. */
      costUsd: z.number(),
    }),
  ),
});
export type Baseline = z.infer<typeof Baseline>;

/** Summary metrics compared with a baseline, in the order the table prints them. */
export const COMPARED = [
  "contractRecall",
  "riskAccuracy",
  "riskNoise",
  "riskPlaced",
  "findingRecall",
  "findingNoise",
  "findingPlaced",
  "decisionRecall",
  "decisionNoise",
  "mismatchRecall",
  "mismatchNamed",
  "mismatchFalsePositives",
  "injectionResistance",
  "firstTryValid",
  "fallbacksUsed",
] as const;
export type ComparedMetric = (typeof COMPARED)[number];

const LOWER_IS_BETTER: ReadonlySet<ComparedMetric> = new Set([
  "riskNoise",
  "findingNoise",
  "decisionNoise",
  "mismatchFalsePositives",
  "fallbacksUsed",
]);

export const metricValue = (summary: Baseline["summary"] | Summary, metric: ComparedMetric) => {
  const value = summary[metric];
  return typeof value === "number" ? value : rate(value);
};

export interface Comparison {
  readonly metric: ComparedMetric;
  readonly baseline: number | null;
  readonly current: number | null;
  /** current − baseline, or null when either wasn't measured. */
  readonly delta: number | null;
  readonly worse: boolean;
}

export const compareWithBaseline = (summary: Summary, baseline: Baseline): Comparison[] =>
  COMPARED.map((metric) => {
    const before = metricValue(baseline.summary, metric);
    const now = metricValue(summary, metric);
    const delta = before === null || now === null ? null : now - before;
    return {
      metric,
      baseline: before,
      current: now,
      delta,
      worse: delta !== null && (LOWER_IS_BETTER.has(metric) ? delta > 0 : delta < 0),
    };
  });

/** Cases whose score on a target metric got worse, to look at first. */
export const regressedCases = (
  scores: ReadonlyMap<string, CaseScore>,
  baseline: Baseline,
): { name: string; metric: TargetMetric }[] =>
  [...scores].flatMap(([name, score]) => {
    const before = baseline.cases[name];
    if (before === undefined) return [];
    return TARGET_METRICS.flatMap((metric): { name: string; metric: TargetMetric }[] => {
      if (metric === "injectionResistance") {
        return before.injectionResisted === true && score.injectionResisted === false
          ? [{ name, metric }]
          : [];
      }
      if (metric === "mismatchFalsePositives") {
        return (score.mismatchFalsePositives ?? 0) > (before.mismatchFalsePositives ?? 0)
          ? [{ name, metric }]
          : [];
      }
      const was = rate(before[metric]);
      const is = rate(score[metric]);
      if (was === null || is === null) return [];
      return (LOWER_IS_BETTER.has(metric) ? is > was : is < was) ? [{ name, metric }] : [];
    });
  });

export const toBaseline = (
  versions: { modelVersion: string; pipelineVersion: string; judgeVersion: number },
  measuredAt: string,
  summary: Summary,
  scores: ReadonlyMap<string, CaseScore>,
  costs: ReadonlyMap<string, CaseCost>,
): Baseline => ({
  measuredAt,
  ...versions,
  summary,
  cases: Object.fromEntries(
    [...scores].map(([name, score]) => {
      const cost = costs.get(name);
      return [name, { ...score, costUsd: cost === undefined ? 0 : cost.modelUsd + cost.judgeUsd }];
    }),
  ),
});
