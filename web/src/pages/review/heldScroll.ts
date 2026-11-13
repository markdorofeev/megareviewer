/** Below this the page hasn't scrolled: there's nothing above to hold. */
const TOP = 1;
/** How far down the window to look for a line, past a sticky file header. */
const LOOK = 240;
const STEP = 6;

const nothing = () => {};

/** The first line of code under the window's top edge, below any sticky file header. */
const topLine = (box: DOMRect): Element | null => {
  const x = box.left + box.width / 2;
  for (let y = TOP; y < Math.min(window.innerHeight, LOOK); y += STEP) {
    const found = document.elementFromPoint(x, y);
    if (found === null || found.closest("[data-slot=file-card-header]") !== null) continue;
    const row = found.closest("[role=row]");
    if (row !== null) return row;
  }
  return null;
};

/**
 * Notes the line at the top of the window and returns what puts it back there, so cards opening
 * above it — Claude's points landing — don't push the code the reviewer is reading down. A line
 * rather than a file card: the card holding it often starts far above the window.
 */
export const holdTopLine = (area: string): (() => void) => {
  const box = document.querySelector(area)?.getBoundingClientRect();
  // With the code's top in the window, nothing above it can open.
  if (
    window.scrollY <= TOP ||
    box === undefined ||
    box.top >= 0 ||
    typeof document.elementFromPoint !== "function"
  )
    return nothing;
  const line = topLine(box);
  if (line === null) return nothing;
  const top = line.getBoundingClientRect().top;
  return () => {
    if (!line.isConnected) return;
    const moved = line.getBoundingClientRect().top - top;
    if (moved !== 0) window.scrollBy({ top: moved, behavior: "instant" });
  };
};
