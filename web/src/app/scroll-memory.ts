import { holdInPlace, holdTopLine } from "../lib/held-scroll.ts";

/** How long a page coming back has to render before its place is given up on. */
const RESTORE_MS = 5000;
const SAVE_AFTER_MS = 150;

const stateWith = (state: unknown, scrollY: number): Record<string, unknown> => ({
  ...(typeof state === "object" && state !== null ? state : {}),
  scrollY,
});

const savedScroll = (state: unknown): number | null => {
  if (typeof state !== "object" || state === null || !("scrollY" in state)) return null;
  const { scrollY } = state;
  return typeof scrollY === "number" && scrollY > 0 ? scrollY : null;
};

/** Notes the window's scroll on the current history entry, so Back and a reload come back to it. */
export const saveScroll = (): void => {
  window.history.replaceState(stateWith(window.history.state, window.scrollY), "");
};

/**
 * Scrolls back to `y` once the page is tall enough, and then holds the line of code at the top
 * while what's above it loads, until the reader moves or a moment passes.
 */
export const restoreScroll = (y: number): (() => void) => {
  let held: (() => void) | null = null;
  const put = () => {
    if (held !== null) return held();
    // A skeleton can be as tall as the page, and the code it stands for isn't there yet.
    if (document.querySelector("main [aria-busy=true]") !== null) return;
    window.scrollTo({ top: y, behavior: "instant" });
    if (Math.abs(window.scrollY - y) <= 1) held = holdTopLine("main");
  };
  // The root, since on a reload nothing is rendered in it yet, not even <main>.
  return holdInPlace("#root", put, RESTORE_MS);
};

/**
 * Keeps each page's place in its history entry and puts it back on Back, Forward and a reload.
 * The browser's own restoration runs before a page has loaded what it shows, so it lands near
 * the top of a long review.
 */
export const rememberScroll = (): (() => void) => {
  window.history.scrollRestoration = "manual";
  let timer: number | undefined;
  let release = () => {};
  const onScroll = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(saveScroll, SAVE_AFTER_MS);
  };
  const flush = () => {
    window.clearTimeout(timer);
    saveScroll();
  };
  const onPopState = (event: PopStateEvent) => {
    // A save still waiting is the page left behind's, and would land on this entry.
    window.clearTimeout(timer);
    release();
    release = () => {};
    const y = savedScroll(event.state);
    if (y === null) window.scrollTo({ top: 0, behavior: "instant" });
    else release = restoreScroll(y);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", flush);
  window.addEventListener("popstate", onPopState);
  const initial = savedScroll(window.history.state);
  if (initial !== null) release = restoreScroll(initial);
  return () => {
    release();
    window.clearTimeout(timer);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("popstate", onPopState);
  };
};
