import type { ModelPass } from "../../../domain/review/index.ts";

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** ARCHITECTURE.md's pass table. */
export const PASS_EFFORT: Readonly<Record<ModelPass, Effort>> = {
  intent: "medium",
  findings: "high",
  risk: "low",
  decisions: "high",
  tour: "medium",
};
