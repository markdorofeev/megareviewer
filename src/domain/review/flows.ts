import { z } from "zod";
import { PartId } from "../diff/index.ts";

/**
 * One of the code's flows, found from the call graph: an entry point a user or caller reaches and
 * the changed code it runs, or a supporting flow of changes no flow runs, by kind. The overview
 * reads them for its order, its entry points and its labels.
 */
export const Flow = z
  .object({
    title: z.string().min(1),
    /** The parts it reads, in order: a hunk that isn't split is one part. */
    partIds: z.array(PartId).readonly(),
    /** flow: an entry point and the code it runs; supporting: changes no flow runs, by kind. */
    kind: z.enum(["flow", "supporting"]),
    /** The parts a flow starts at: its routes, page or command. Empty for the others. */
    entries: z.array(PartId).readonly(),
  })
  .readonly();
export type Flow = z.infer<typeof Flow>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The flows as stored: an array, or `{ steps, builtBy }` from before the field was one, under
 * `tour` or `flows`. A flow the model's tour pass titled kept the code's title as `codeTitle`,
 * which is the title the overview shows.
 */
export const storedFlows = (stored: unknown): unknown => {
  const steps = isRecord(stored) ? stored.steps : stored;
  if (!Array.isArray(steps)) return steps;
  return steps.map((step: unknown) =>
    isRecord(step) && typeof step.codeTitle === "string" && step.codeTitle !== ""
      ? { ...step, title: step.codeTitle }
      : step,
  );
};
