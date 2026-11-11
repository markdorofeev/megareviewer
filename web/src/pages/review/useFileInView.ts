import { useEffect, useState } from "react";

/** A file card's path and where its top is, relative to the top of the window. */
export interface CardTop {
  readonly path: string;
  readonly top: number;
}

/** How far down the window, as a share of its height, a card has to reach to be the one in view. */
const PROBE = 0.25;

/**
 * The file the reviewer is reading: the last card whose top has passed a line a quarter down the
 * window, or the first card before any has. Scrolled to the bottom, a short last card can't reach
 * that line, so it's the last card whose top is on screen.
 */
export const fileInView = (
  cards: readonly CardTop[],
  viewportHeight: number,
  atBottom: boolean,
): string | null => {
  const line = atBottom ? viewportHeight - 1 : viewportHeight * PROBE;
  return (cards.findLast((card) => card.top <= line) ?? cards[0])?.path ?? null;
};

/** The cards' tops, or null before the page is laid out (and in tests, which have no layout). */
const cardTops = (): CardTop[] | null => {
  const cards = [
    ...document.querySelectorAll<HTMLElement>(
      "[aria-label=Changes] [data-slot=file-card][data-path]",
    ),
  ];
  const rects = cards.map((card) => card.getBoundingClientRect());
  if (rects.every((rect) => rect.height === 0)) return null;
  return cards.map((card, at) => ({ path: card.dataset.path ?? "", top: rects[at]?.top ?? 0 }));
};

/**
 * The path of the file card in view, followed as the window scrolls while `active`. While it isn't,
 * the last file in view stays, so the overview can outline its directory. `paths` are the cards'.
 */
export const useFileInView = (paths: readonly string[], active: boolean): string | null => {
  const [path, setPath] = useState<string | null>(null);
  const key = paths.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cards change when their paths do.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
      const cards = cardTops();
      if (cards === null) return;
      const found = fileInView(cards, window.innerHeight, atBottom && window.scrollY > 0);
      if (found !== null) setPath(found);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [key, active]);
  return path;
};
