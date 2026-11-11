import { type MouseEvent, memo } from "react";
import { cn } from "../../lib/utils.ts";
import type { CharRange } from "./intra-line.ts";
import type { LineKind, ViewLine } from "./rows.ts";
import type { SyntaxToken, SyntaxTokenType } from "./syntax.ts";

// A diff row is the hot path: thousands render at once, so it's plain elements with no primitives
// or context, memoized on its props.

export type Density = "compact" | "default" | "comfy";

/** Row height in pixels per density, matching the type scale's line heights. */
export const ROW_HEIGHT: Readonly<Record<Density, number>> = {
  compact: 18,
  default: 20,
  comfy: 22,
};

const DENSITY: Readonly<Record<Density, string>> = {
  compact: "text-code-compact",
  default: "text-code",
  comfy: "text-code-comfy",
};

const KIND: Readonly<
  Record<
    LineKind,
    {
      readonly row: string;
      readonly gutter: string;
      readonly word: string;
      readonly marker: string;
      readonly label: string;
    }
  >
> = {
  add: {
    row: "bg-diff-add-bg",
    gutter: "bg-diff-add-gutter text-diff-add-fg",
    word: "bg-diff-add-word",
    marker: "+",
    label: "added",
  },
  del: {
    row: "bg-diff-del-bg",
    gutter: "bg-diff-del-gutter text-diff-del-fg",
    word: "bg-diff-del-word",
    marker: "−",
    label: "removed",
  },
  context: {
    row: "bg-background",
    gutter: "bg-diff-gutter-bg text-diff-gutter-fg",
    word: "",
    marker: " ",
    label: "unchanged",
  },
};

const SYNTAX: Readonly<Record<SyntaxTokenType, string>> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  function: "text-syntax-function",
  comment: "text-syntax-comment",
  number: "text-syntax-number",
};

interface Segment {
  readonly text: string;
  readonly type: SyntaxTokenType | null;
  readonly changed: boolean;
}

/** Splits the tokens at the edges of the word ranges, so both can be styled at once. */
export const segments = (
  text: string,
  tokens: readonly SyntaxToken[] | null,
  ranges: readonly CharRange[],
): Segment[] => {
  const out: Segment[] = [];
  let offset = 0;
  for (const token of tokens ?? [{ text, type: null }]) {
    const end = offset + token.text.length;
    const cuts = new Set([offset, end]);
    for (const range of ranges) {
      if (range.start > offset && range.start < end) cuts.add(range.start);
      if (range.end > offset && range.end < end) cuts.add(range.end);
    }
    const edges = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const start = edges[i] ?? offset;
      const stop = edges[i + 1] ?? end;
      out.push({
        text: text.slice(start, stop),
        type: token.type,
        changed: ranges.some((range) => range.start <= start && stop <= range.end),
      });
    }
    offset = end;
  }
  return out;
};

export type LineLayout = "unified" | "split-old" | "split-new";

export interface DiffLineProps {
  readonly line: ViewLine;
  /** The row's id, for the grid's aria-activedescendant. */
  readonly id?: string;
  readonly layout?: LineLayout;
  readonly density?: Density;
  readonly wrap?: boolean;
  readonly focused?: boolean;
  readonly selected?: boolean;
  /** Shows a comment button in the gutter on hover and focus. */
  readonly onComment?: (line: ViewLine) => void;
  /** A gutter click; shift-click extends the selection. */
  readonly onGutterClick?: (line: ViewLine, event: MouseEvent) => void;
  /**
   * Makes one side's line number a button in the tab order, e.g. "Comment on line 12", for
   * places without the grid's keyboard. It replaces the hover button.
   */
  /** "cell" inside a table, as on a part's card; "gridcell" inside the viewer's grid. */
  readonly cellRole?: "gridcell" | "cell";
  readonly numberButton?: {
    readonly side: "old" | "new";
    readonly label: string;
    readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  };
  /** A click anywhere on the row, e.g. to comment on it. */
  readonly onRowClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

/** One line of a diff: the old and new numbers, the + / − marker, and the code. */
export const DiffLine = memo(function DiffLine({
  line,
  id,
  layout = "unified",
  density = "default",
  wrap = false,
  focused = false,
  selected = false,
  onComment,
  onGutterClick,
  numberButton,
  onRowClick,
  cellRole = "gridcell",
}: DiffLineProps) {
  const kind = KIND[line.kind];
  const number = line.newNo ?? line.oldNo;
  const gutter = (value: number | null, side: "old" | "new") => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the grid's ↑ and ↓, with shift, do the same.
    // biome-ignore lint/a11y/noStaticElementInteractions: a cell of the grid; only the grid clicks it.
    <span
      role={cellRole}
      onClick={onGutterClick === undefined ? undefined : (event) => onGutterClick(line, event)}
      className={cn(
        "tabular relative w-12 shrink-0 select-none text-right",
        // The number button takes the padding, so its fill reaches the cell's edges.
        numberButton?.side === side && value !== null ? "pr-0" : "pr-2",
        kind.gutter,
        onGutterClick !== undefined && "cursor-pointer hover:text-foreground",
      )}
    >
      {numberButton?.side === side && value !== null ? (
        <button
          type="button"
          aria-label={numberButton.label}
          onClick={numberButton.onClick}
          // As tall as a line of code: WCAG 2.5.8's inline exception, as for a link in a sentence.
          data-inline-target
          className={cn(
            "h-full w-full pr-2 text-right hover:bg-primary hover:text-primary-foreground focus-visible:-outline-offset-2",
            // Under the mouse the whole cell fills, square and full height, so it and the row's
            // tint read as one band; a chip inside the gutter read as apart from the line.
            onRowClick !== undefined &&
              "group-hover/line:bg-primary group-hover/line:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground",
            // A plus beside the number says a click comments; the cell fits it only up to four
            // digits, so from 10,000 the fill alone says it.
            onRowClick !== undefined &&
              value < 10_000 &&
              "before:mr-1 before:content-none group-hover/line:before:content-['+'] focus-visible:before:content-['+']",
          )}
        >
          {value}
        </button>
      ) : (
        (value ?? "")
      )}
      {side === "new" && onComment !== undefined && numberButton === undefined && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Comment on line ${number ?? ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onComment(line);
          }}
          className="absolute top-0 left-0 hidden h-full w-5 items-center justify-center rounded-sm bg-primary text-primary-foreground group-hover/line:flex group-data-focused/line:flex"
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
    </span>
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the line number is the keyboard's way to the same action.
    <div
      role="row"
      id={id}
      onClick={onRowClick}
      aria-selected={selected || undefined}
      data-line={line.key}
      data-kind={line.kind}
      data-focused={focused || undefined}
      className={cn(
        "group/line relative flex min-w-full font-mono",
        onRowClick !== undefined && "cursor-pointer",
        DENSITY[density],
        kind.row,
        // A tint over the row's own, so a selected added line still reads as added.
        // Above the gutters, which are positioned and would paint over them otherwise.
        selected &&
          "before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-primary/15",
        // The same tint, fainter, says the row under the mouse can be commented on.
        !selected &&
          onRowClick !== undefined &&
          "hover:before:pointer-events-none hover:before:absolute hover:before:inset-0 hover:before:z-[1] hover:before:bg-primary/8",
        focused &&
          "after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:z-[1] after:w-[3px] after:bg-ring",
      )}
    >
      {layout !== "split-new" && gutter(line.oldNo, "old")}
      {layout !== "split-old" && gutter(line.newNo, "new")}
      <span
        aria-hidden="true"
        className={cn(
          "w-5 shrink-0 select-none text-center font-semibold",
          line.kind === "add" && "text-diff-add-fg",
          line.kind === "del" && "text-diff-del-fg",
        )}
      >
        {kind.marker}
      </span>
      <span
        role={cellRole}
        className={cn(
          "pr-4",
          wrap ? "min-w-0 flex-1 whitespace-pre-wrap break-all" : "whitespace-pre",
        )}
      >
        <span className="sr-only">{`${kind.label} line ${number ?? ""}: `}</span>
        {segments(line.text, line.tokens, line.wordRanges).map((segment, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the line's segments never reorder.
            key={index}
            data-changed={segment.changed || undefined}
            className={cn(
              segment.type !== null && SYNTAX[segment.type],
              segment.changed && cn(kind.word, "rounded-sm"),
            )}
          >
            {segment.text}
          </span>
        ))}
        {line.notes.map((note) => (
          <span
            key={note}
            className="ml-2 rounded-sm border px-1 align-middle font-sans text-caption text-muted-foreground"
          >
            {note}
          </span>
        ))}
      </span>
    </div>
  );
});

/** An empty half of a split row, beside a line the other side doesn't have. */
export const EmptyHalf = ({ density = "default" }: { readonly density?: Density }) => (
  <div
    aria-hidden="true"
    className={cn("flex min-w-full bg-surface-subtle font-mono", DENSITY[density])}
  >
    <span className="w-12 shrink-0 bg-diff-gutter-bg" />
    <span className="flex-1">{" "}</span>
  </div>
);
