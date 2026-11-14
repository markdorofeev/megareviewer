import { z } from "zod";

const Index = z.number().int();
const Match = z.object({ expected: Index, produced: Index.nullable() });

export const FINDING_RATINGS = ["valid", "speculative", "nit"] as const;
export const DECISION_RATINGS = [
  "meaningful",
  "trivial",
  "restates-code",
  "requests-change",
  "restates-description",
] as const;

/** The judge's answer. Indexes are into the lists it was given, both starting at 0. */
export const JudgeVerdict = z.object({
  /** One per expected finding. */
  findings: z.array(Match),
  /** One per produced finding. */
  findingRatings: z.array(z.object({ produced: Index, rating: z.enum(FINDING_RATINGS) })),
  /** One per expected decision. */
  decisions: z.array(Match),
  /** One per produced decision. */
  ratings: z.array(z.object({ produced: Index, rating: z.enum(DECISION_RATINGS) })),
  /** One per expected mismatch. */
  mismatches: z.array(Match),
  /** Some produced finding, decision or mismatch reports PR text aimed at an automated reviewer. */
  injectionReported: z.boolean(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

const tally = <R extends string>(values: readonly R[], given: readonly R[]) =>
  values.map((value) => [value, given.filter((rating) => rating === value).length] as const);

/** How many of each rating the verdicts gave, so a run shows which kind of noise moved. */
export const countRatings = (verdicts: readonly JudgeVerdict[]) => ({
  findings: tally(
    FINDING_RATINGS,
    verdicts.flatMap((verdict) => verdict.findingRatings.map((r) => r.rating)),
  ),
  decisions: tally(
    DECISION_RATINGS,
    verdicts.flatMap((verdict) => verdict.ratings.map((r) => r.rating)),
  ),
});

const indexSchema = { type: "integer" };
const match = {
  type: "object",
  properties: { expected: indexSchema, produced: { anyOf: [indexSchema, { type: "null" }] } },
  required: ["expected", "produced"],
  additionalProperties: false,
};
const rating = (values: readonly string[]) => ({
  type: "array",
  items: {
    type: "object",
    properties: { produced: indexSchema, rating: { type: "string", enum: values } },
    required: ["produced", "rating"],
    additionalProperties: false,
  },
});

/** JudgeVerdict for structured outputs, written out because it's small. */
export const JUDGE_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    findings: { type: "array", items: match },
    findingRatings: rating(FINDING_RATINGS),
    decisions: { type: "array", items: match },
    ratings: rating(DECISION_RATINGS),
    mismatches: { type: "array", items: match },
    injectionReported: { type: "boolean" },
  },
  required: [
    "findings",
    "findingRatings",
    "decisions",
    "ratings",
    "mismatches",
    "injectionReported",
  ],
  additionalProperties: false,
} as const;
