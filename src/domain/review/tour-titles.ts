import { z } from "zod";
import { type Tour, type TourStep, TourStepId } from "./tour.ts";

/** Longest title and explanation the model may write for a step. */
export const MAX_TITLE = 80;
export const MAX_EXPLANATION = 300;

/** The model's title and explanation for one of the code's steps, by the step's ID. */
export const TourStepTitle = z
  .object({ stepId: z.string(), title: z.string(), explanation: z.string() })
  .readonly();
export type TourStepTitle = z.infer<typeof TourStepTitle>;

/** A supporting step the model reads as part of another step, with its reason. */
export const TourMerge = z
  .object({ stepId: z.string(), intoStepId: z.string(), reason: z.string() })
  .readonly();
export type TourMerge = z.infer<typeof TourMerge>;

/** What the tour pass writes on the code's tour. Step IDs are checked against the tour. */
export const TourTitles = z
  .object({
    steps: z.array(TourStepTitle).readonly(),
    merges: z.array(TourMerge).readonly(),
  })
  .readonly();
export type TourTitles = z.infer<typeof TourTitles>;

/**
 * The code's tour with the model's titles: each step keeps its parts and the code's title as
 * `codeTitle`, and a merged step's parts and `via` go to the end of the step it joins. Expects
 * titles that `validateTourTitles` accepts.
 */
export const applyTourTitles = (skeleton: Tour, titles: TourTitles): Tour => {
  const written = new Map(titles.steps.map((step) => [step.stepId, step]));
  const stepById = new Map<string, TourStep>(skeleton.steps.map((step) => [step.id, step]));
  const merging = new Set(titles.merges.map((merge) => merge.stepId));
  const steps = skeleton.steps
    .filter((step) => !merging.has(step.id))
    .map((step, at): TourStep => {
      const joining = titles.merges.flatMap((merge) => {
        const merged = stepById.get(merge.stepId);
        return merge.intoStepId === step.id && merged !== undefined
          ? [{ step: merged, reason: merge.reason.trim() }]
          : [];
      });
      const own = written.get(step.id);
      return {
        ...step,
        id: TourStepId.parse(`s${at + 1}`),
        title: own?.title.trim() ?? step.title,
        explanation: own?.explanation.trim() ?? step.explanation,
        codeTitle: step.title,
        partIds: [...step.partIds, ...joining.flatMap(({ step }) => step.partIds)],
        via: [...new Set([...step.via, ...joining.flatMap(({ step }) => step.via)])],
        merged: joining.map(({ step, reason }) => ({ title: step.title, reason })),
      };
    });
  return { steps, builtBy: "model" };
};
