import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PointId } from "../../../../src/domain/review/index.ts";
import { holdTopLine } from "./heldScroll.ts";

/**
 * Where the landing of Claude's results is. "measure" is one render that's never painted: the
 * page as it was, with the new cards taking no room, to find which are in view. "landing" plays
 * the timeline once; "done" is at rest.
 */
export type LandingPhase = "measure" | "landing" | "done";

/** The code the scroll is held in. */
const CODE = "[aria-label=Changes]";

/** A motion token in milliseconds: 0 when it isn't set, and under reduced motion. */
export const tokenMs = (name: string): number => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  return value.endsWith("ms") ? number : value.endsWith("s") ? number * 1000 : number;
};

export interface Landing {
  readonly phase: LandingPhase;
  /** Claude's run as the page shows it: still running until the landing's first painted frame. */
  readonly running: boolean;
  /** A point the page didn't show before the run. */
  readonly fresh: (id: PointId) => boolean;
  /**
   * The fresh points in the window, by their place in the code's order from the top: their
   * cards unfold. The others are in place from the start. Empty unless landing.
   */
  readonly inView: ReadonlyMap<PointId, number>;
}

/** What the document's title says while the tab is hidden, once the model's run has ended. */
export const readyTitle = (family: string): string => `✓ ${family} is done`;

const NONE: ReadonlySet<PointId> = new Set();
const NOWHERE: ReadonlyMap<PointId, number> = new Map();

/**
 * The one owner of the landing's timeline. It plays only when this page saw Claude's run go from
 * running to ended, so an analysis opened again is at rest. The receipt, the tree and the code
 * read the phase from `data-landing` on the page and their place in it from `--landing-i`; CSS
 * does the rest, timed by the motion tokens.
 */
export const useLanding = (
  running: boolean,
  pointIds: readonly PointId[],
  family = "Claude",
): Landing => {
  const [seen, setSeen] = useState<{ running: boolean; before: ReadonlySet<PointId> }>({
    running,
    before: NONE,
  });
  const [phase, setPhase] = useState<LandingPhase>("done");
  const [inView, setInView] = useState(NOWHERE);
  const [ended, setEnded] = useState(0);
  if (running !== seen.running) {
    // While it runs, the page shows the points from before it; those aren't landing.
    setSeen({ running, before: running ? new Set(pointIds) : seen.before });
    setPhase(running ? "done" : "measure");
    setInView(NOWHERE);
    if (!running) setEnded(ended + 1);
  }

  // A reviewer who went to another tab while Claude read sees in its title that it's done.
  useEffect(() => {
    if (ended === 0 || !document.hidden) return;
    const title = document.title;
    document.title = `${readyTitle(family)} · ${title}`;
    const back = () => {
      if (!document.hidden) document.title = title;
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      document.title = title;
    };
  }, [ended, family]);

  const restore = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (phase !== "measure") return;
    restore.current = holdTopLine(CODE);
    // Zero under reduced motion: every step is an instant change.
    if (tokenMs("--landing-total") === 0) {
      setPhase("done");
      return;
    }
    const found = new Map<PointId, number>();
    for (const fold of document.querySelectorAll<HTMLElement>(
      "[data-slot=point-fold][data-fresh]",
    )) {
      const { top } = fold.getBoundingClientRect();
      const id = PointId.safeParse(fold.dataset.pointId);
      if (id.success && top >= 0 && top < window.innerHeight) found.set(id.data, found.size);
    }
    setInView(found);
    setPhase("landing");
  }, [phase]);

  // The cards out of view are open now, before the first frame: put the top line back.
  useLayoutEffect(() => {
    if (phase === "measure" || restore.current === null) return;
    restore.current();
    restore.current = null;
  }, [phase]);

  useEffect(() => {
    if (phase !== "landing") return;
    const last = Math.max(0, inView.size - 1) * tokenMs("--landing-step-code");
    const timer = setTimeout(() => setPhase("done"), tokenMs("--landing-total") + last);
    return () => clearTimeout(timer);
  }, [phase, inView]);

  const { before } = seen;
  const fresh = useCallback((id: PointId) => phase !== "done" && !before.has(id), [phase, before]);
  return {
    phase,
    running: running || phase === "measure",
    fresh,
    inView: phase === "landing" ? inView : NOWHERE,
  };
};
