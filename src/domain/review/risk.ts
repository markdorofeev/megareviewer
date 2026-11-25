import { z } from "zod";
import { HunkId } from "../diff/index.ts";

export const RiskClass = z.enum(["mechanical", "logic", "contract"]);
export type RiskClass = z.infer<typeof RiskClass>;

export const RiskAssessment = z
  .object({
    hunkId: HunkId,
    riskClass: RiskClass,
    reason: z.string(),
    /**
     * proof: a mechanical proof; rule: the contract rules. model and fallback are read from analyses
     * stored while the model classified hunks.
     */
    source: z.enum(["proof", "rule", "model", "fallback"]),
  })
  .readonly();
export type RiskAssessment = z.infer<typeof RiskAssessment>;
