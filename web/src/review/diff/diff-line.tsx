import { BugIcon } from "lucide-react";
import { Fragment, type MouseEvent, memo, type ReactNode } from "react";
import type { PointKind } from "../../../../src/domain/review/index.ts";
import { cn, cssVars } from "../../lib/utils.ts";
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
  /** Where the segment starts in the line's text. */
  readonly start: number;
}

/**
 * A range of a line's text that `render` wraps, such as a call that shows the code it runs. Marks
 * don't overlap.
 */
export interface LineMark extends CharRange {
  readonly render: (code: ReactNode) => ReactNode;
}

/**
 * Splits the tokens at the edges of the word ranges, so both can be styled at once, and at the
 * edges of `cuts`, such as marks, so a segment is in one or none.
 */
export const segments = (
  text: string,
  tokens: readonly SyntaxToken[] | null,
  ranges: readonly CharRange[],
  cuts: readonly CharRange[] = [],
): Segment[] => {
  const out: Segment[] = [];
  let offset = 0;
  for (const token of tokens ?? [{ text, type: null }]) {
    const end = offset + token.text.length;
    const cutAt = new Set([offset, end]);
    for (const range of [...ranges, ...cuts]) {
      if (range.start > offset && range.start < end) cutAt.add(range.start);
      if (range.end > offset && range.end < end) cutAt.add(range.end);
    }
    const edges = [...cutAt].sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const start = edges[i] ?? offset;
      const stop = edges[i + 1] ?? end;
      out.push({
        text: text.slice(start, stop),
        type: token.type,
        changed: ranges.some((range) => range.start <= start && stop <= range.end),
        start,
      });
    }
    offset = end;
  }
  return out;
};

export type LineLayout = "unified" | "split-old" | "split-new";

// Spelled out because Tailwind only generates the classes it finds whole in the source. The mark
// is a pseudo-element rather than the cell's background so the landing can draw it down the lines.
const POINT_MARK: Readonly<Record<PointKind, string>> = {
  finding:
    "isolate font-medium text-review-changes before:absolute before:inset-0 before:-z-1 before:bg-review-changes-bg before:shadow-[inset_-3px_0_0_var(--review-changes)]",
  risk: "isolate font-medium text-risk-contract before:absolute before:inset-0 before:-z-1 before:bg-risk-contract-bg before:shadow-[inset_-3px_0_0_var(--risk-contract-solid)]",
  decision: "",
};

export interface DiffLineProps {
  readonly line: ViewLine;
  /** The row's id, for the grid's aria-activedescendant. */
  readonly id?: string;
  readonly layout?: LineLayout;
  readonly density?: Density;
  readonly wrap?: boolean;
  readonly focused?: boolean;
  readonly selected?: boolean;
  /** A line an open comment box is on, marked by a bar at its edge. */
  readonly marked?: boolean;
  /**
   * A line one of Claude's points rests on: the number beside the code takes the kind's tint and
   * color, with a rail on its code side. A decision's lines take none.
   */
  readonly pointKind?: PointKind | null;
  /**
   * The point is landing: its place among those in view, and this line's among its lines, so its
   * mark draws down them and its wash passes over (globals.css).
   */
  readonly pointLanding?: PointLanding;
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
  /** Ranges of the code to wrap, e.g. calls; a new array each render re-renders the row. */
  readonly marks?: readonly LineMark[];
  /** A finding's card is under this line: a bug in the new number's cell. */
  readonly flagged?: boolean;
  /** After the code, e.g. a decision's chip; a new element each render re-renders the row. */
  readonly end?: ReactNode;
}

export interface PointLanding {
  readonly at: number;
  readonly line: number;
  readonly lines: number;
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
  marked = false,
  pointKind = null,
  pointLanding,
  onComment,
  onGutterClick,
  numberButton,
  onRowClick,
  cellRole = "gridcell",
  marks = NO_MARKS,
  flagged = false,
  end,
}: DiffLineProps) {
  const kind = KIND[line.kind];
  const number = line.newNo ?? line.oldNo;
  const markSide = layout === "split-old" ? "old" : "new";
  const gutter = (value: number | null, side: "old" | "new") => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the grid's ↑ and ↓, with shift, do the same.
    // biome-ignore lint/a11y/noStaticElementInteractions: a cell of the grid; only the grid clicks it.
    <span
      role={cellRole}
      onClick={onGutterClick === undefined ? undefined : (event) => onGutterClick(line, event)}
      data-point-mark={
        pointKind !== null && pointKind !== "decision" && side === markSide ? pointKind : undefined
      }
      className={cn(
        "tabular relative w-12 shrink-0 select-none text-right",
        // The number button takes the padding, so its fill reaches the cell's edges.
        numberButton?.side === side && value !== null ? "pr-0" : "pr-2",
        kind.gutter,
        pointKind !== null && side === markSide && POINT_MARK[pointKind],
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
      {side === "new" && flagged && value !== null && value < 1000 && (
        // Gives way to the plus the row shows under the mouse.
        <BugIcon
          aria-hidden="true"
          data-slot="finding-flag"
          className="pointer-events-none absolute top-1/2 left-1 size-3 -translate-y-1/2 text-review-changes group-hover/line:hidden"
        />
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
      data-marked={marked || undefined}
      data-point={pointKind ?? undefined}
      data-point-line={pointLanding === undefined ? undefined : pointLanding.line}
      style={
        pointLanding === undefined
          ? undefined
          : cssVars({
              "--landing-i": pointLanding.at,
              "--point-line": pointLanding.line,
              "--point-lines": pointLanding.lines,
            })
      }
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
        (focused || marked) &&
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
        {markedCode(
          segments(line.text, line.tokens, line.wordRanges, marks).map((segment) => ({
            start: segment.start,
            element: (
              <span
                key={segment.start}
                data-changed={segment.changed || undefined}
                className={cn(
                  segment.type !== null && SYNTAX[segment.type],
                  segment.changed && cn(kind.word, "rounded-sm"),
                )}
              >
                {segment.text}
              </span>
            ),
          })),
          marks,
        )}
        {line.notes.map((note) => (
          <span
            key={note}
            className="ml-2 rounded-sm border px-1 align-middle font-sans text-caption text-muted-foreground"
          >
            {note}
          </span>
        ))}
        {end}
      </span>
    </div>
  );
});

const NO_MARKS: readonly LineMark[] = [];

/** A line's segments as elements, the runs inside a mark wrapped by its `render`. */
const markedCode = (
  elements: readonly { readonly start: number; readonly element: ReactNode }[],
  marks: readonly LineMark[],
): ReactNode[] => {
  if (marks.length === 0) return elements.map(({ element }) => element);
  const runs: { mark: LineMark | null; code: ReactNode[] }[] = [];
  for (const { start, element } of elements) {
    const mark = marks.find((one) => start >= one.start && start < one.end) ?? null;
    const last = runs.at(-1);
    if (mark !== null && last?.mark === mark) last.code.push(element);
    else runs.push({ mark, code: [element] });
  }
  return runs.flatMap(({ mark, code }) =>
    mark === null ? code : [<Fragment key={`mark-${mark.start}`}>{mark.render(code)}</Fragment>],
  );
};

/**
 * An empty stretch after a line, in its row's and its new number's colors, as if the line ran on:
 * room for a scrollbar drawn over the code.
 */
export const LineEnd = ({
  kind,
  className,
}: {
  readonly kind: LineKind;
  readonly className?: string;
}) => (
  <div
    aria-hidden="true"
    data-slot="line-end"
    data-kind={kind}
    className={cn("flex min-w-full", KIND[kind].row, className)}
  >
    <span className={cn("w-12 shrink-0", KIND[kind].gutter)} />
  </div>
);

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
