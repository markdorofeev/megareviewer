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
    /**
     * The code's own title, when the tour pass wrote `title`: a flow's entry label, or what a
     * supporting step holds. Null when `title` is the code's.
     */
    codeTitle: z.string().nullable(),
    /** Supporting steps the model merged into this one: their code title and the model's reason. */
    merged: z.array(z.object({ title: z.string(), reason: z.string() }).readonly()).readonly(),
  })
  .readonly();
export type TourStep = z.infer<typeof TourStep>;

export const Tour = z
  .object({
    steps: z.array(TourStep).readonly(),
    /**
     * Both are the code's steps from the call graph. code: with the code's titles. model: titled
     * by the tour pass, which may have merged supporting steps, on analyses stored before it was
     * removed.
     */
    builtBy: z.enum(["model", "code"]),
  })
  .readonly();
export type Tour = z.infer<typeof Tour>;
