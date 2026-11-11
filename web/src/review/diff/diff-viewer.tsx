import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileChange, Hunk } from "../../../../src/domain/diff/index.ts";
import { isMac, type ShortcutId, shortcutFor, useSingleKeyShortcuts } from "../../lib/keymap.ts";
import { FILE_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group.tsx";
import { type Density, DiffLine, EmptyHalf, ROW_HEIGHT } from "./diff-line.tsx";
import { CollapsedHunk, type ExpandDirection, HunkHeader } from "./hunk-header.tsx";
import {
  linesOf,
  type SideBySideRow,
  type SplitRow,
  selectedRange,
  splitRows,
  type UnifiedRow,
  unifiedRows,
  type ViewLine,
} from "./rows.ts";
import type { HunkTokens } from "./syntax.ts";

export type DiffView = "unified" | "split";

/** Rows past this make the viewer draw only what's in view. */
export const VIRTUALIZE_ABOVE = 300;

const GRID_KEYS: readonly ShortcutId[] = [
  "lineDown",
  "lineUp",
  "extendDown",
  "extendUp",
  "comment",
];

export interface DiffViewerProps {
  readonly file: FileChange;
  readonly view?: DiffView;
  readonly onViewChange?: (view: DiffView) => void;
  readonly density?: Density;
  /** Long lines wrap instead of scrolling sideways. Split views wrap by default. */
  readonly wrap?: boolean;
  /** Syntax tokens per hunk, from a SyntaxHighlighter; plain text without them. */
  readonly tokens?: readonly (HunkTokens | null)[] | null;
  /** Draw only the rows in view; "auto" does above VIRTUALIZE_ABOVE rows. */
  readonly virtualize?: boolean | "auto";
  /** The height of a virtualized viewer's scrolling area, a CSS length. */
  readonly height?: string;
  /** Why the diff waits for a click before it's drawn, e.g. "Generated file, 4,210 lines". */
  readonly deferred?: string;
  /** Comment on the focused line, or the selected lines. Without it there's no comment button. */
  readonly onComment?: (lines: readonly ViewLine[]) => void;
  /** Open unchanged lines before a hunk. Without it gaps only say how many lines they hide. */
  readonly onExpand?: (before: Hunk["id"], direction: ExpandDirection) => void;
  /** Gaps whose lines are being fetched, by the hunk after them. */
  readonly expanding?: ReadonlySet<Hunk["id"]>;
  /** More controls for the file header, after the view switch. */
  readonly actions?: ReactNode;
  /** Starts folded to its header. */
  readonly defaultCollapsed?: boolean;
  /** The line, by its `hunkId:index` key, that starts with the focus. */
  readonly defaultFocus?: string;
  /** The other end of a starting selection, from `defaultFocus`. */
  readonly defaultAnchor?: string;
}

type Row = UnifiedRow | SideBySideRow;

const rowSize = (row: Row, density: Density): number =>
  row.type === "gap" ? 32 : row.type === "hunk" ? 28 : ROW_HEIGHT[density];

/** A file's diff: a sticky header, then its hunks as a grid of lines, unified or side by side. */
export const DiffViewer = ({
  file,
  view: viewProp,
  onViewChange,
  density = "default",
  wrap: wrapProp,
  tokens = null,
  virtualize = "auto",
  height = "70vh",
  deferred,
  onComment,
  onExpand,
  expanding,
  actions,
  defaultCollapsed = false,
  defaultFocus,
  defaultAnchor,
}: DiffViewerProps) => {
  const [ownView, setOwnView] = useState<DiffView>("unified");
  const view = viewProp ?? ownView;
  const setView = (next: DiffView) => {
    setOwnView(next);
    onViewChange?.(next);
  };
  const wrap = wrapProp ?? view === "split";
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [loaded, setLoaded] = useState(deferred === undefined);
  const [singleKeys] = useSingleKeyShortcuts();

  const rows: readonly Row[] = useMemo(
    () => (view === "split" ? splitRows(file, tokens) : unifiedRows(file, tokens)),
    [file, tokens, view],
  );
  const lines = useMemo(() => linesOf(rows), [rows]);
  /** The row holding each line, for the grid's active descendant. */
  const rowOfLine = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.type === "line") map.set(row.line.key, index);
      if (row.type === "split") {
        if (row.old !== null) map.set(row.old.key, index);
        if (row.new !== null) map.set(row.new.key, index);
      }
    });
    return map;
  }, [rows]);

  const [focus, setFocus] = useState<string | null>(defaultFocus ?? null);
  const [anchor, setAnchor] = useState<string | null>(defaultAnchor ?? null);
  const selected = useMemo(
    () =>
      focus !== null && anchor !== null ? selectedRange(lines, anchor, focus) : new Set<string>(),
    [lines, anchor, focus],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = virtualize === "auto" ? rows.length > VIRTUALIZE_ABOVE : virtualize;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row === undefined ? ROW_HEIGHT[density] : rowSize(row, density);
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 24,
    enabled: virtual,
  });

  const idPrefix = useId();
  const lineId = useCallback((key: string) => `${idPrefix}-${key}`, [idPrefix]);

  const moveFocus = useCallback(
    (step: 1 | -1, extend: boolean) => {
      const current = focus === null ? -1 : lines.findIndex((line) => line.key === focus);
      const next = lines[Math.min(lines.length - 1, Math.max(0, current + step))];
      if (next === undefined) return;
      setAnchor(extend ? (anchor ?? focus ?? next.key) : null);
      setFocus(next.key);
      const index = rowOfLine.get(next.key);
      if (index === undefined) return;
      if (virtual) virtualizer.scrollToIndex(index, { align: "auto" });
      else
        scrollRef.current
          ?.querySelector(`#${CSS.escape(lineId(next.key))}`)
          ?.scrollIntoView({ block: "nearest" });
    },
    [focus, anchor, lines, rowOfLine, virtual, virtualizer, lineId],
  );

  const comment = useCallback(() => {
    if (onComment === undefined || focus === null) return;
    const chosen =
      selected.size > 0
        ? lines.filter((line) => selected.has(line.key))
        : lines.filter((line) => line.key === focus);
    onComment(chosen);
  }, [onComment, focus, selected, lines]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const id = shortcutFor(event, GRID_KEYS, { mac: isMac(), singleKeys });
    if (id === null) return;
    event.preventDefault();
    if (id === "lineDown") moveFocus(1, false);
    if (id === "lineUp") moveFocus(-1, false);
    if (id === "extendDown") moveFocus(1, true);
    if (id === "extendUp") moveFocus(-1, true);
    if (id === "comment") comment();
  };

  const onGutterClick = useCallback(
    (line: ViewLine, event: MouseEvent) => {
      setAnchor(event.shiftKey ? (anchor ?? focus ?? line.key) : null);
      setFocus(line.key);
    },
    [anchor, focus],
  );
  const onLineComment = useCallback(
    (line: ViewLine) => {
      setFocus(line.key);
      onComment?.(selected.has(line.key) ? lines.filter((each) => selected.has(each.key)) : [line]);
    },
    [onComment, selected, lines],
  );

  const renderRow = (row: Row): ReactNode => {
    if (row.type === "gap")
      return (
        <CollapsedHunk
          hidden={row.hidden}
          onExpand={
            onExpand === undefined ? undefined : (direction) => onExpand(row.before, direction)
          }
          expanding={expanding?.has(row.before) ?? false}
        />
      );
    if (row.type === "hunk")
      return <HunkHeader hunk={row.hunk} position={row.position} count={file.hunks.length} />;
    const lineProps = {
      lineId,
      density,
      wrap,
      onGutterClick,
      onComment: onComment === undefined ? undefined : onLineComment,
    };
    if (row.type === "line")
      return (
        <DiffLine
          line={row.line}
          id={lineId(row.line.key)}
          density={density}
          wrap={wrap}
          onGutterClick={onGutterClick}
          onComment={lineProps.onComment}
          focused={row.line.key === focus}
          selected={selected.has(row.line.key)}
        />
      );
    return <SplitLine row={row} focus={focus} selected={selected} lineProps={lineProps} />;
  };

  const status = FILE_STATUS[file.status];
  const slash = file.path.lastIndexOf("/");
  const body = (() => {
    if (file.binary) return <Notice>Binary file, not shown.</Notice>;
    if (file.hunks.length === 0)
      return (
        <Notice>
          {file.status === "renamed"
            ? "Renamed, with no changes to its lines."
            : "No changes to its lines."}
        </Notice>
      );
    if (!loaded)
      return (
        <Notice>
          {deferred}
          <Button variant="outline" size="sm" onClick={() => setLoaded(true)}>
            Load diff
          </Button>
        </Notice>
      );
    return (
      <div
        ref={scrollRef}
        role="grid"
        tabIndex={0}
        aria-label={`Diff of ${file.path}`}
        aria-multiselectable={onComment !== undefined || undefined}
        aria-activedescendant={focus === null ? undefined : lineId(focus)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (focus === null && lines[0] !== undefined) setFocus(lines[0].key);
        }}
        className="overflow-auto -outline-offset-2"
        style={virtual ? { height } : undefined}
      >
        {virtual ? (
          <div
            className={cn("relative", wrap ? "w-full" : "w-max min-w-full")}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={wrap ? virtualizer.measureElement : undefined}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {renderRow(row)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={wrap ? "w-full" : "w-max min-w-full"}>
            {rows.map((row) => (
              <div key={row.key}>{renderRow(row)}</div>
            ))}
          </div>
        )}
      </div>
    );
  })();

  return (
    <section aria-label={file.path} className="overflow-clip rounded-lg border bg-card">
      {/* A page with its own sticky header sets --diff-sticky-top to its height. */}
      <header className="sticky top-[var(--diff-sticky-top,0px)] z-10 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span
            aria-hidden="true"
            className={cn(
              "transition-transform duration-(--duration-fast) ease-standard",
              collapsed && "-rotate-90",
            )}
          >
            ▾
          </span>
        </Button>
        <span className={cn("w-3 font-mono text-caption font-semibold", status.className)}>
          <span aria-hidden="true">{status.glyph}</span>
          <span className="sr-only">{status.label}</span>
        </span>
        <h3 className="min-w-0 flex-1 truncate font-mono text-code">
          {file.oldPath !== null && file.oldPath !== file.path && (
            <span className="text-muted-foreground">{file.oldPath} → </span>
          )}
          <span className="text-muted-foreground">{file.path.slice(0, slash + 1)}</span>
          {file.path.slice(slash + 1)}
        </h3>
        <span className="tabular font-mono text-code-compact">
          <span className="text-diff-add-fg">+{file.additions}</span>{" "}
          <span className="text-diff-del-fg">−{file.deletions}</span>
          <span className="sr-only">
            {` ${file.additions} lines added, ${file.deletions} removed`}
          </span>
        </span>
        <ToggleGroup
          size="sm"
          variant="outline"
          value={[view]}
          onValueChange={(next) => {
            const chosen = next[0];
            if (chosen === "unified" || chosen === "split") setView(chosen);
          }}
          aria-label="Diff view"
        >
          <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
          <ToggleGroupItem value="split">Split</ToggleGroupItem>
        </ToggleGroup>
        {actions}
      </header>
      {!collapsed && body}
    </section>
  );
};

const Notice = ({ children }: { readonly children: ReactNode }) => (
  <p className="flex items-center gap-3 px-4 py-3 text-muted-foreground">{children}</p>
);

interface LineProps {
  readonly lineId: (key: string) => string;
  readonly density: Density;
  readonly wrap: boolean;
  readonly onGutterClick: (line: ViewLine, event: MouseEvent) => void;
  readonly onComment: ((line: ViewLine) => void) | undefined;
}

const SplitLine = ({
  row,
  focus,
  selected,
  lineProps,
}: {
  readonly row: SplitRow;
  readonly focus: string | null;
  readonly selected: ReadonlySet<string>;
  readonly lineProps: LineProps;
}) => {
  const { lineId, ...shared } = lineProps;
  return (
    <div className="grid grid-cols-2 divide-x divide-border *:min-w-0">
      {[row.old, row.new].map((line, side) =>
        line === null ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the two halves are fixed: old, then new.
          <EmptyHalf key={side} density={lineProps.density} />
        ) : (
          <DiffLine
            // biome-ignore lint/suspicious/noArrayIndexKey: the two halves are fixed: old, then new.
            key={side}
            line={line}
            // A context line is on both sides; its id and focus go on the new one.
            id={side === 1 || row.new !== row.old ? lineId(line.key) : undefined}
            layout={side === 0 ? "split-old" : "split-new"}
            focused={line.key === focus && (side === 1 || row.new !== row.old)}
            selected={selected.has(line.key)}
            {...shared}
          />
        ),
      )}
    </div>
  );
};
