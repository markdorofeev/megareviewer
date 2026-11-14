import { z } from "zod";
import { HunkId } from "../diff/index.ts";
import { PointLines } from "./point-lines.ts";

export const RiskClass = z.enum(["mechanical", "logic", "contract"]);
export type RiskClass = z.infer<typeof RiskClass>;

export const RiskAssessment = z
  .object({
    hunkId: HunkId,
    riskClass: RiskClass,
    reason: z.string(),
    /**
     * proof: a mechanical proof; rule: the contract rules; model: the risk pass; fallback: the
     * model didn't classify it.
     */
    source: z.enum(["proof", "rule", "model", "fallback"]),
    /** Where the model says a contract hunk's risk is decided, in that hunk; null for its first. */
    lines: PointLines.nullable().default(null),
  })
  .readonly();
export type RiskAssessment = z.infer<typeof RiskAssessment>;
