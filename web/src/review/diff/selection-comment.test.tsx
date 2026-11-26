import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FileChange, partHunk, partId } from "../../../../src/domain/diff/index.ts";
import { HunkCard } from "./hunk-card.tsx";
import { selectedLines } from "./selected-lines.ts";
import { SelectionComment } from "./selection-comment.tsx";
import { type Highlighter, HighlighterContext } from "./syntax.ts";
import { firstHunk, modifiedFile } from "./testing.ts";
import { UnchangedLines } from "./unchanged-lines.tsx";

const plain: Highlighter = { highlight: () => new Promise(() => {}) };

const orders = modifiedFile("src/orders.ts", [
  "@@ -10,5 +10,6 @@",
  " const first = 1;",
  "-const old = 2;",
  "-const older = 3;",
  "+const next = 2;",
  "+",
  "+const last = 4;",
  " done();",
  " end();",
]);
const other = modifiedFile("src/other.ts", ["@@ -1,1 +1,2 @@", " a();", "+b();"]);

const Card = ({
  file,
  readOnly = false,
}: {
  readonly file: FileChange;
  readonly readOnly?: boolean;
}) => (
  <HunkCard
    hunk={firstHunk(file)}
    file={file}
    risk={null}
    {...(readOnly ? {} : { onOpenComment: () => {}, onComment: () => {} })}
  />
);

const onComment = vi.fn();

/** Two cards as the map has them, with opened unchanged lines, a thread and a read-only card. */
const renderPage = () =>
  render(
    <HighlighterContext.Provider value={plain}>
      <Card file={orders} />
      <UnchangedLines
        hunkId={firstHunk(orders).id}
        lines={[{ oldNo: 20, newNo: 21, text: "unchanged();", tokens: null }]}
      />
      <p>a thread</p>
      <Card file={other} />
      <Card file={modifiedFile("src/read.ts", ["@@ -1,1 +1,1 @@", "-x();", "+y();"])} readOnly />
      <SelectionComment onComment={onComment} />
    </HighlighterContext.Provider>,
  );

/** The text node and offset `at` characters into a line's code, or into a text outside the lines. */
const point = (text: string, at: number): [Text, number] => {
  const cell = [...document.querySelectorAll("[data-slot=line-code]")].find(
    (one) => one.textContent?.replace(/^\w+ line \d+: /, "") === text,
  );
  const walker = document.createTreeWalker(cell ?? document.body, NodeFilter.SHOW_TEXT);
  if (cell !== undefined) walker.nextNode();
  let left = at;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || (cell === undefined && node.data !== text)) continue;
    if (left <= node.data.length) return [node, left];
    left -= node.data.length;
  }
  throw new Error(`no text ${text}`);
};

const select = (from: [string, number], to: [string, number]) => {
  window.getSelection()?.setBaseAndExtent(...point(...from), ...point(...to));
  fireEvent(document, new Event("selectionchange"));
};

const selected = () => {
  const selection = window.getSelection();
  return selection === null ? null : selectedLines(selection);
};

const button = () => document.querySelector<HTMLElement>("[data-slot=selection-comment]");
const visible = () => button() !== null && button()?.style.visibility !== "hidden";

/** The element the geometry finds under the selection's end: by default its own row. */
let onTop: () => Element | null;

beforeEach(() => {
  onComment.mockClear();
  onTop = () => selected()?.row ?? null;
  // jsdom has no layout.
  Range.prototype.getClientRects = () =>
    Object.assign([new DOMRect(100, 100, 50, 20)], { item: () => null });
  document.elementFromPoint = () => onTop();
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("selectedLines", () => {
  const lines = (from: [string, number], to: [string, number]) => {
    select(from, to);
    const found = selected();
    return found === null ? null : { part: found.partId, ...found.place };
  };
  const part = firstHunk(orders).id;

  it("is the line a selection within one is on", () => {
    renderPage();
    expect(lines(["const next = 2;", 0], ["const next = 2;", 5])).toEqual({
      part,
      side: "new",
      line: 11,
    });
    expect(lines(["const old = 2;", 2], ["const old = 2;", 6])).toEqual({
      part,
      side: "old",
      line: 11,
    });
  });

  it("covers the lines of the side it ends on, and skips the other side's", () => {
    renderPage();
    expect(lines(["const first = 1;", 3], ["const last = 4;", 2])).toEqual({
      part,
      side: "new",
      line: 13,
      startLine: 10,
    });
    expect(lines(["const first = 1;", 3], ["const older = 3;", 2])).toEqual({
      part,
      side: "old",
      line: 12,
      startLine: 11,
    });
  });

  it("ends where the pointer let go, when the selection was made upwards", () => {
    renderPage();
    // Let go on the deleted line, so the deleted side's lines.
    expect(lines(["const last = 4;", 3], ["const old = 2;", 2])).toEqual({
      part,
      side: "old",
      line: 12,
      startLine: 11,
    });
    expect(lines(["done();", 3], ["const next = 2;", 2])).toEqual({
      part,
      side: "new",
      line: 14,
      startLine: 11,
    });
  });

  it("leaves out a line none of whose code is selected", () => {
    renderPage();
    // From the end of one line to the start of another, as a triple click ends.
    expect(lines(["const first = 1;", 16], ["end();", 0])).toEqual({
      part,
      side: "new",
      line: 14,
      startLine: 11,
    });
  });

  it("is in the part it ends in, across files", () => {
    renderPage();
    expect(lines(["done();", 0], ["b();", 2])).toEqual({
      part: firstHunk(other).id,
      side: "new",
      line: 2,
      startLine: 1,
    });
    expect(lines(["b();", 2], ["done();", 0])).toEqual({
      part,
      side: "new",
      line: 15,
      startLine: 14,
    });
  });

  it("names the part of a split hunk", () => {
    const hunk = firstHunk(orders);
    const id = partId(hunk.id, 2);
    render(
      <HunkCard
        id={id}
        hunk={partHunk(hunk, { start: 5, end: 8 })}
        file={orders}
        risk={null}
        onOpenComment={() => {}}
        onComment={() => {}}
      />,
    );
    expect(lines(["const last = 4;", 0], ["done();", 4])).toEqual({
      part: id,
      side: "new",
      line: 14,
      startLine: 13,
    });
  });

  it("is none outside the lines a comment can go on", () => {
    renderPage();
    expect(lines(["unchanged();", 0], ["unchanged();", 4])).toBeNull();
    expect(lines(["done();", 0], ["unchanged();", 4])).toBeNull();
    expect(lines(["done();", 0], ["a thread", 4])).toBeNull();
    expect(lines(["x();", 0], ["y();", 2])).toBeNull();
    expect(lines(["done();", 2], ["done();", 2])).toBeNull();
  });
});

describe("SelectionComment", () => {
  it("shows a button when code is selected, and opens the box on its lines with a click", () => {
    renderPage();
    expect(button()).toBeNull();
    select(["const next = 2;", 3], ["const last = 4;", 3]);
    expect(visible()).toBe(true);
    expect(button()?.textContent).toBe("Comment");
    const shown = button();
    if (shown === null) throw new Error("no button");
    // The press doesn't take the selection.
    fireEvent.pointerDown(shown);
    expect(fireEvent.mouseDown(shown)).toBe(false);
    fireEvent.pointerUp(shown);
    fireEvent.click(shown);
    expect(onComment).toHaveBeenCalledWith(firstHunk(orders).id, {
      side: "new",
      line: 13,
      startLine: 11,
    });
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(button()).toBeNull();
  });

  it("is for the pointer alone: out of the Tab order and the accessibility tree", () => {
    renderPage();
    select(["done();", 0], ["done();", 4]);
    expect(button()?.getAttribute("tabindex")).toBe("-1");
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  });

  it("waits until the pointer is up", async () => {
    renderPage();
    fireEvent.pointerDown(document.body);
    select(["done();", 0], ["done();", 4]);
    expect(button()).toBeNull();
    fireEvent.pointerUp(document.body);
    await vi.waitFor(() => expect(visible()).toBe(true));
    // And goes with the next press.
    fireEvent.pointerDown(document.body);
    expect(button()).toBeNull();
  });

  it("goes when the selection collapses or leaves the part", () => {
    renderPage();
    select(["done();", 0], ["done();", 4]);
    expect(visible()).toBe(true);
    select(["done();", 4], ["done();", 4]);
    expect(button()).toBeNull();
    select(["done();", 0], ["done();", 4]);
    select(["done();", 0], ["a thread", 4]);
    expect(button()).toBeNull();
  });

  it("goes on Esc, which does nothing else, until the selection changes", () => {
    renderPage();
    const page = vi.fn();
    window.addEventListener("keydown", page);
    select(["done();", 0], ["done();", 4]);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(button()).toBeNull();
    expect(page).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(page).toHaveBeenCalledTimes(1);
    select(["done();", 0], ["end();", 3]);
    expect(visible()).toBe(true);
    window.removeEventListener("keydown", page);
  });

  it("goes while the selection's end is scrolled out of sight", async () => {
    renderPage();
    select(["done();", 0], ["done();", 4]);
    expect(visible()).toBe(true);
    // A sticky header is over the line.
    onTop = () => document.body;
    fireEvent.scroll(document);
    await vi.waitFor(() => expect(visible()).toBe(false));
    onTop = () => selected()?.row ?? null;
    fireEvent.scroll(document);
    await vi.waitFor(() => expect(visible()).toBe(true));
  });
});
