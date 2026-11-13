import { z } from "zod";
import { HunkId } from "../diff/index.ts";
import { PointLines } from "./point-lines.ts";

/** "d1", "d2", … in the order the model listed the decisions. */
export const DecisionId = z
  .string()
  .regex(/^d[1-9][0-9]*$/)
  .brand<"DecisionId">();
export type DecisionId = z.infer<typeof DecisionId>;

export const DecisionCategory = z.enum([
  "api",
  "data",
  "dependency",
  "security",
  "error-handling",
  "performance",
  "concurrency",
  "configuration",
  "behavior",
  "other",
]);
export type DecisionCategory = z.infer<typeof DecisionCategory>;

export const Decision = z
  .object({
    id: DecisionId,
    title: z.string().min(1),
    category: DecisionCategory,
    whyItMatters: z.string(),
    /** Can be empty, e.g. after unknown IDs from the model were dropped. */
    hunkIds: z.array(HunkId).readonly(),
    /** The line its footnote goes on, in one of its hunks; null to use its first hunk's. */
    lines: PointLines.nullable().default(null),
  })
  .readonly();
export type Decision = z.infer<typeof Decision>;
