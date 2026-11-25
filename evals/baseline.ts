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
const ByTypeSchema = z.object({
  logic: RatioSchema,
  contract: RatioSchema,
  architecture: RatioSchema,
});

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
    findingRecall: RatioSchema,
    findingNoise: RatioSchema,
    findingPlaced: RatioSchema,
    // Absent from baselines measured before findings had a type.
    findingRecallByType: ByTypeSchema.optional(),
    findingNoiseByType: ByTypeSchema.optional(),
    typeRight: RatioSchema.optional(),
    unwantedFindings: z.number().optional(),
    mismatchRecall: RatioSchema,
    mismatchNamed: RatioSchema,
    mismatchFalsePositives: z.number(),
    injectionResistance: RatioSchema,
    // Absent from baselines measured before the passes read the reviewer's guidance.
    guidanceFollowed: RatioSchema.optional(),
    leftOutRight: RatioSchema.optional(),
    guidanceWrong: RatioSchema.optional(),
    modelCostUsd: z.number(),
    judgeCostUsd: z.number(),
    modelCostPerCaseUsd: z.number(),
    latencyS: z.object({ total: z.number(), max: z.number() }),
  }),
  cases: z.record(
    z.string(),
    z.object({
      findingRecall: RatioSchema,
      findingNoise: RatioSchema,
      findingPlaced: RatioSchema,
      findingRecallByType: ByTypeSchema.optional(),
      findingNoiseByType: ByTypeSchema.optional(),
      typeRight: RatioSchema.optional(),
      unwantedFindings: z.number().nullable().optional(),
      mismatchRecall: RatioSchema,
      mismatchNamed: RatioSchema,
      mismatchFalsePositives: z.number().nullable(),
      injectionResisted: z.boolean().nullable(),
      guidanceFollowed: RatioSchema.optional(),
      leftOutRight: RatioSchema.optional(),
      guidanceWrong: RatioSchema.optional(),
      /** Model and judge, for the next run's estimate. */
      costUsd: z.number(),
    }),
  ),
});
export type Baseline = z.infer<typeof Baseline>;

/** Summary metrics compared with a baseline, in the order the table prints them. */
export const COMPARED = [
  "findingRecall",
  "findingNoise",
  "findingPlaced",
  "typeRight",
  "unwantedFindings",
  "mismatchRecall",
  "mismatchNamed",
  "mismatchFalsePositives",
  "injectionResistance",
  "guidanceFollowed",
  "leftOutRight",
  "guidanceWrong",
] as const;
export type ComparedMetric = (typeof COMPARED)[number];

const LOWER_IS_BETTER: ReadonlySet<ComparedMetric> = new Set([
  "findingNoise",
  "unwantedFindings",
  "mismatchFalsePositives",
  "guidanceWrong",
]);

export const metricValue = (summary: Baseline["summary"] | Summary, metric: ComparedMetric) => {
  const value = summary[metric];
  return value === undefined ? null : typeof value === "number" ? value : rate(value);
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
      if (metric === "mismatchFalsePositives" || metric === "unwantedFindings") {
        return (score[metric] ?? 0) > (before[metric] ?? 0) ? [{ name, metric }] : [];
      }
      const earlier = before[metric];
      if (earlier === undefined) return [];
      const was = rate(earlier);
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
