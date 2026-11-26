import { MessageSquareIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import { Button } from "../../ui/button.tsx";
import type { LinePlace } from "./hunk-card.tsx";
import { type SelectedLines, selectedLines } from "./selected-lines.ts";

/** Between the button and the line the selection ends on. */
const GAP = 4;

/**
 * A button at the end of a selection of code, which comments on the lines it covers. One per page:
 * it finds the part and the lines by their rows. For the pointer alone, as the selection is: a
 * line's number is the keyboard's and a screen reader's way to the same.
 */
export const SelectionComment = ({
  onComment,
}: {
  readonly onComment: (id: PartId, place: LinePlace) => void;
}) => {
  const [lines, setLines] = useState<SelectedLines | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let pressed = false;
    const read = () => {
      if (pressed) return;
      const selection = window.getSelection();
      setLines(selection === null ? null : selectedLines(selection));
    };
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && button.current?.contains(event.target) === true) return;
      if (event.button !== 0) return;
      pressed = true;
      setLines(null);
    };
    const release = () => {
      if (!pressed) return;
      pressed = false;
      // A click in the selection collapses it only after the pointer's event.
      window.setTimeout(read);
    };
    document.addEventListener("selectionchange", read);
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    return () => {
      document.removeEventListener("selectionchange", read);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
  }, []);

  useLayoutEffect(() => {
    const shown = button.current;
    if (lines === null || shown === null) return;
    const put = () => {
      const spot = spotOf(lines, shown.offsetWidth, shown.offsetHeight);
      shown.style.visibility = spot === null ? "hidden" : "visible";
      if (spot === null) return;
      shown.style.left = `${spot.left}px`;
      shown.style.top = `${spot.top}px`;
    };
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || shown.style.visibility === "hidden") return;
      event.stopPropagation();
      setLines(null);
    };
    put();
    window.addEventListener("scroll", put, { capture: true, passive: true });
    window.addEventListener("resize", put);
    window.addEventListener("keydown", close, true);
    const moved = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(put);
    moved?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", put, true);
      window.removeEventListener("resize", put);
      window.removeEventListener("keydown", close, true);
      moved?.disconnect();
    };
  }, [lines]);

  if (lines === null) return null;
  return createPortal(
    <Button
      ref={button}
      variant="outline"
      size="sm"
      data-slot="selection-comment"
      aria-hidden="true"
      tabIndex={-1}
      className="invisible fixed z-30 shadow-md"
      // Keeps the selection, and the focus where it was.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        window.getSelection()?.removeAllRanges();
        setLines(null);
        onComment(lines.partId, lines.place);
      }}
    >
      <MessageSquareIcon />
      Comment
    </Button>,
    document.body,
  );
};

/**
 * Where the button goes: under the end of the selection, or above one made upwards, within what
 * its card shows of a line that scrolls sideways. Null when the line is out of sight or covered.
 */
const spotOf = (
  { row, code, backward }: SelectedLines,
  width: number,
  height: number,
): { readonly left: number; readonly top: number } | null => {
  const rects = [...code.getClientRects()];
  const end = (backward ? rects[0] : rects.at(-1)) ?? row.getBoundingClientRect();
  const view = scrollerOf(row).getBoundingClientRect();
  const right = Math.min(view.right, document.documentElement.clientWidth);
  const left = clamp(backward ? end.left : end.right, Math.max(view.left, 0), right - width);
  const over = document.elementFromPoint(left, (end.top + end.bottom) / 2);
  if (!row.contains(over)) return null;
  const above = end.top - GAP - height;
  const below = end.bottom + GAP;
  const fits = below + height <= window.innerHeight;
  return { left, top: (backward && above >= 0) || !fits ? above : below };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/** The card's own sideways scroll. */
const scrollerOf = (row: HTMLElement): Element => {
  let at: Element | null = row.parentElement;
  while (at !== null && !/auto|scroll/.test(getComputedStyle(at).overflowX)) at = at.parentElement;
  return at ?? document.documentElement;
};
