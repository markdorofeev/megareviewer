import { useEffect, useLayoutEffect, useRef } from "react";

/** Below this the page hasn't scrolled: there's nothing above to hold. */
const TOP = 1;

/**
 * Holds the line at the top of the window where it is when `key` changes, so cards opening above
 * it — Claude's points landing — don't push the code the reviewer is reading down. The anchor is
 * the first card whose top is in view, tracked as the page scrolls.
 */
export const useHeldScroll = (key: unknown, selector: string): void => {
  const anchor = useRef<{ element: Element; top: number } | null>(null);
  const seen = useRef(key);

  useEffect(() => {
    const track = () => {
      if (window.scrollY <= TOP) {
        anchor.current = null;
        return;
      }
      const inView = [...document.querySelectorAll(selector)].find(
        (card) => card.getBoundingClientRect().top > -1,
      );
      anchor.current =
        inView === undefined ? null : { element: inView, top: inView.getBoundingClientRect().top };
    };
    track();
    window.addEventListener("scroll", track, { passive: true });
    return () => window.removeEventListener("scroll", track);
  }, [selector]);

  useLayoutEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    const held = anchor.current;
    if (held === null || !held.element.isConnected) return;
    const moved = held.element.getBoundingClientRect().top - held.top;
    if (moved !== 0) window.scrollBy({ top: moved, behavior: "instant" });
  }, [key]);
};
