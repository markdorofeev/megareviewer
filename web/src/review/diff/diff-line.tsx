import { type MouseEvent, memo } from "react";
import type { CharRange } from "../../diff/intra-line.ts";
import { cn } from "../../lib/utils.ts";
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
}: DiffLineProps) {
  const kind = KIND[line.kind];
  const number = line.newNo ?? line.oldNo;
  const gutter = (value: number | null, side: "old" | "new") => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the grid's ↑ and ↓, with shift, do the same.
    <span
      role="gridcell"
      onClick={onGutterClick === undefined ? undefined : (event) => onGutterClick(line, event)}
      className={cn(
        "tabular relative w-12 shrink-0 select-none pr-2 text-right",
        kind.gutter,
        onGutterClick !== undefined && "cursor-pointer hover:text-foreground",
      )}
    >
      {side === "new" && onComment !== undefined && (
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
      {value ?? ""}
    </span>
  );

  return (
    <div
      role="row"
      id={id}
      aria-selected={selected || undefined}
      data-line={line.key}
      data-kind={line.kind}
      data-focused={focused || undefined}
      className={cn(
        "group/line relative flex min-w-full font-mono",
        DENSITY[density],
        kind.row,
        // A tint over the row's own, so a selected added line still reads as added.
        // Above the gutters, which are positioned and would paint over them otherwise.
        selected &&
          "before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-primary/15",
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
        role="gridcell"
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
            className={cn(
              segment.type !== null && SYNTAX[segment.type],
              segment.changed && cn(kind.word, "rounded-sm"),
            )}
          >
            {segment.text}
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
