import { useLayoutEffect, useRef, useState } from "react";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { holdTopLine } from "./heldScroll.ts";

const CODE = "[aria-label=Changes]";

/** The guardrail call of the run on show has ended: its marks are what changed. */
const marksArrive = (shown: Analysis, next: Analysis): boolean =>
  shown.id === next.id && shown.guardrails === "running" && next.guardrails !== "running";

/**
 * The analysis to show. When a run's guardrail call ends after the review has landed, its marks
 * go in one render later, once the line of code at the top of the window is noted, and that line
 * is put back where it was before the frame is painted: lines opening on cards above it don't move
 * the code being read. Every other change shows at once.
 */
export const useMarksHeld = (analysis: Analysis): Analysis => {
  const [shown, setShown] = useState(analysis);
  const restore = useRef<(() => void) | null>(null);
  const held = shown !== analysis && marksArrive(shown, analysis);

  useLayoutEffect(() => {
    if (shown === analysis) {
      restore.current?.();
      restore.current = null;
      return;
    }
    if (marksArrive(shown, analysis)) restore.current = holdTopLine(CODE);
    setShown(analysis);
  }, [analysis, shown]);

  return held ? shown : analysis;
};
