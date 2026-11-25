import { useLayoutEffect, useRef, useState } from "react";
import { type Analysis, MODEL_STAGES, STEPS_STAGE } from "../../../../src/domain/review/index.ts";
import { holdTopLine } from "./heldScroll.ts";

const CODE = "[aria-label=Changes]";

/** The guardrail call of the run on show has ended: its marks are what changed. */
const marksArrive = (shown: Analysis, next: Analysis): boolean =>
  shown.guardrails === "running" && next.guardrails !== "running";

/**
 * The callers outside the PR have come, or won't. With a run that ends at once with them, the
 * landing holds the code itself.
 */
const callersArrive = (shown: Analysis, next: Analysis): boolean =>
  shown.checkout === "downloading" &&
  next.checkout !== "downloading" &&
  RUN_STAGES.every((stage) => shown.stages[stage] === next.stages[stage]);

const RUN_STAGES = [...MODEL_STAGES, STEPS_STAGE] as const;

const arrives = (shown: Analysis, next: Analysis): boolean =>
  shown.id === next.id && (marksArrive(shown, next) || callersArrive(shown, next));

/**
 * The analysis to show. When a run's guardrail call ends after the review has landed, or the
 * callers outside the PR come after the page opened, what they add goes in one render later, once
 * the line of code at the top of the window is noted, and that line is put back where it was before
 * the frame is painted: lines opening on cards above it don't move the code being read. Every other
 * change shows at once.
 */
export const useMarksHeld = (analysis: Analysis): Analysis => {
  const [shown, setShown] = useState(analysis);
  const restore = useRef<(() => void) | null>(null);
  const held = shown !== analysis && arrives(shown, analysis);

  useLayoutEffect(() => {
    if (shown === analysis) {
      restore.current?.();
      restore.current = null;
      return;
    }
    if (arrives(shown, analysis)) restore.current = holdTopLine(CODE);
    setShown(analysis);
  }, [analysis, shown]);

  return held ? shown : analysis;
};
