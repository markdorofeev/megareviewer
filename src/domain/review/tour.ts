import { z } from "zod";
import { type FileChange, HunkId } from "../diff/index.ts";

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
  })
  .readonly();
export type TourStep = z.infer<typeof TourStep>;

export const Tour = z
  .object({
    steps: z.array(TourStep).readonly(),
    /**
     * model: the tour pass; code: from the call graph, without the model; file-order: one step
     * per file, when nothing better could be built.
     */
    builtBy: z.enum(["model", "code", "file-order"]),
  })
  .readonly();
export type Tour = z.infer<typeof Tour>;

const FALLBACK_EXPLANATION =
  "Shown in file order because the guided tour couldn't be built for this pull request.";

/** One step per file in path order, hunks in file order. Only required hunks appear. */
export const fallbackTour = (
  files: readonly FileChange[],
  requiredHunkIds: ReadonlySet<HunkId>,
): Tour => {
  const byPath = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const steps: TourStep[] = [];
  for (const file of byPath) {
    const hunkIds = file.hunks.map((hunk) => hunk.id).filter((id) => requiredHunkIds.has(id));
    if (hunkIds.length > 0) {
      steps.push({
        id: TourStepId.parse(`s${steps.length + 1}`),
        title: file.path,
        explanation: FALLBACK_EXPLANATION,
        hunkIds,
      });
    }
  }
  return { steps, builtBy: "file-order" };
};
