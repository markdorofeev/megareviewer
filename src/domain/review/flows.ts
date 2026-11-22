import { z } from "zod";
import { PartId } from "../diff/index.ts";

/** "s1", "s2", … in reading order: stored analyses have these IDs, so the format stays. */
export const FlowId = z
  .string()
  .regex(/^s[1-9][0-9]*$/)
  .brand<"FlowId">();
export type FlowId = z.infer<typeof FlowId>;

/**
 * A flow from the call graph: an entry point a user or caller reaches and the changed code it runs,
 * or a supporting step for changes no flow runs. The overview reads them for its order and labels.
 */
export const Flow = z
  .object({
    id: FlowId,
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
export type Flow = z.infer<typeof Flow>;

/** The code's flows, in reading order: shared code first, then flows, then supporting steps. */
export const Flows = z
  .object({
    steps: z.array(Flow).readonly(),
    /**
     * Both are the code's steps from the call graph. code: with the code's titles. model: titled
     * by the tour pass, which may have merged supporting steps, on analyses stored before it was
     * removed.
     */
    builtBy: z.enum(["model", "code"]),
  })
  .readonly();
export type Flows = z.infer<typeof Flows>;
