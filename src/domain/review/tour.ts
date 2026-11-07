import { z } from "zod";
import { HunkId } from "../diff/index.ts";

/** "s1", "s2", … in tour order. */
export const TourStepId = z
  .string()
  .regex(/^s[1-9][0-9]*$/)
  .brand<"TourStepId">();
export type TourStepId = z.infer<typeof TourStepId>;

export const TourStep = z
  .object({
    id: TourStepId,
    title: z.string().min(1),
    explanation: z.string(),
    hunkIds: z.array(HunkId).readonly(),
    /** flow: an entry point and the code it runs; supporting: changes no flow runs, by kind. */
    kind: z.enum(["flow", "supporting"]),
    /** Hunks of earlier steps this step passes through, in reading order. */
    via: z.array(HunkId).readonly(),
    /** The hunks a flow starts at: its routes, page or command. Empty for the others. */
    entries: z.array(HunkId).readonly(),
  })
  .readonly();
export type TourStep = z.infer<typeof TourStep>;

export const Tour = z
  .object({
    steps: z.array(TourStep).readonly(),
    /** model: the tour pass; code: from the call graph, without the model or when its tour failed. */
    builtBy: z.enum(["model", "code"]),
  })
  .readonly();
export type Tour = z.infer<typeof Tour>;
