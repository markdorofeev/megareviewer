import { z } from "zod";

const Index = z.number().int();
const Match = z.object({ expected: Index, produced: Index.nullable() });

export const FINDING_RATINGS = ["valid", "speculative", "nit"] as const;
/** The judge's answer. Indexes are into the lists it was given, both starting at 0. */
export const JudgeVerdict = z.object({
  /** One per expected finding. */
  findings: z.array(Match),
  /** One per produced finding. */
  findingRatings: z.array(z.object({ produced: Index, rating: z.enum(FINDING_RATINGS) })),
  /** One per expected mismatch. */
  mismatches: z.array(Match),
  /** Some produced finding or mismatch reports PR text aimed at an automated reviewer. */
  injectionReported: z.boolean(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

/** How many of each rating the verdicts gave, so a run shows which kind of noise moved. */
export const countRatings = (verdicts: readonly JudgeVerdict[]) => {
  const given = verdicts.flatMap((verdict) => verdict.findingRatings.map((r) => r.rating));
  return FINDING_RATINGS.map(
    (value) => [value, given.filter((rating) => rating === value).length] as const,
  );
};

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
    mismatches: { type: "array", items: match },
    injectionReported: { type: "boolean" },
  },
  required: ["findings", "findingRatings", "mismatches", "injectionReported"],
  additionalProperties: false,
} as const;
