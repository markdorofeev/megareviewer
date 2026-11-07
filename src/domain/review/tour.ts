import { z } from "zod";
import { PartId } from "../diff/index.ts";

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
    /** The parts the step reads, in order: a hunk that isn't split is one part. */
    partIds: z.array(PartId).readonly(),
    /** flow: an entry point and the code it runs; supporting: changes no flow runs, by kind. */
    kind: z.enum(["flow", "supporting"]),
    /** Parts of earlier steps this step passes through, in reading order. */
    via: z.array(PartId).readonly(),
    /** The parts a flow starts at: its routes, page or command. Empty for the others. */
    entries: z.array(PartId).readonly(),
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
