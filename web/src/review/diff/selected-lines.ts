import { PartId } from "../../../../src/domain/diff/index.ts";
import type { LinePlace } from "./hunk-card.tsx";

/** The lines of a part a selection of code covers, and where on the page it ends. */
export interface SelectedLines {
  readonly partId: PartId;
  readonly place: LinePlace;
  /** The row the selection ends on, and what it holds of that row's code. */
  readonly row: HTMLElement;
  readonly code: Range;
  /** Made upwards or to the left, so it ends at its first character. */
  readonly backward: boolean;
}

/**
 * The lines a selection covers in the part it ends in, on the side of the line it ends on; null
 * when it ends anywhere but on code a comment can go on.
 */
export const selectedLines = (selection: Selection): SelectedLines | null => {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const { focusNode } = selection;
  const backward =
    range.startContainer === focusNode && range.startOffset === selection.focusOffset;
  const covered = rowsIn(range).flatMap((row) => {
    const code = selectedCode(range, row);
    return code === null ? [] : [{ row, code }];
  });
  const end = backward ? covered[0] : covered.at(-1);
  if (end === undefined || !endsOnCode(range, focusNode, end.row, backward)) return null;
  const at = placeOf(end.row);
  const card = end.row.closest<HTMLElement>("[data-slot=hunk-card]");
  const partId = PartId.safeParse(card?.dataset.part);
  if (at === null || card === null || !partId.success) return null;
  const lines = covered.flatMap(({ row }) => {
    const place = card.contains(row) ? placeOf(row) : null;
    return place?.side === at.side ? [place.line] : [];
  });
  const [first, last] = [Math.min(...lines), Math.max(...lines)];
  return {
    partId: partId.data,
    place: { side: at.side, line: last, ...(first === last ? {} : { startLine: first }) },
    ...end,
    backward,
  };
};

const elementOf = (node: Node | null): Element | null =>
  node instanceof Element ? node : (node?.parentElement ?? null);

const rowsIn = (range: Range): HTMLElement[] => {
  const root = elementOf(range.commonAncestorContainer);
  const row = root?.closest<HTMLElement>("[data-line]");
  if (row != null) return [row];
  return [...(root?.querySelectorAll<HTMLElement>("[data-line]") ?? [])].filter((one) =>
    range.intersectsNode(one),
  );
};

const placeOf = (row: HTMLElement): LinePlace | null => {
  const [, side, line] = /^(old|new):(\d+)$/.exec(row.dataset.place ?? "") ?? [];
  return line === undefined ? null : { side: side === "old" ? "old" : "new", line: Number(line) };
};

/** What a range holds of a row's code. A blank line is held whole by a range that runs over it. */
const selectedCode = (range: Range, row: HTMLElement): Range | null => {
  const cell = row.querySelector("[data-slot=line-code]");
  if (cell === null || cell.firstChild === null) return null;
  const code = document.createRange();
  code.selectNodeContents(cell);
  // The cell begins with the line's spoken kind and number.
  code.setStartAfter(cell.firstChild);
  if (range.compareBoundaryPoints(Range.START_TO_END, code) <= 0) return null;
  if (range.compareBoundaryPoints(Range.END_TO_START, code) >= 0) return null;
  const blank = code.toString() === "";
  if (range.compareBoundaryPoints(Range.START_TO_START, code) > 0) {
    code.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, code) < 0) {
    code.setEnd(range.endContainer, range.endOffset);
  }
  return blank || code.toString() !== "" ? code : null;
};

/**
 * Whether the selection ends on the lines rather than in something after them, such as a thread. A
 * triple click ends at the start of whatever comes next, with nothing of it selected.
 */
const endsOnCode = (
  range: Range,
  focusNode: Node | null,
  row: HTMLElement,
  backward: boolean,
): boolean => {
  if (elementOf(focusNode)?.closest("[data-line]") != null) return true;
  const rest = range.cloneRange();
  if (backward) rest.setEndBefore(row);
  else rest.setStartAfter(row);
  return rest.toString().trim() === "";
};
