import { ArrowRightIcon, LayoutGridIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { type BowTieNode, bowTie } from "./flow-bow-tie.ts";
import {
  type FlowFolds,
  FlowLegend,
  type FlowViewProps,
  NoPaths,
  OffThePaths,
  STOP_STYLE,
  StatusGlyph,
  useFocusedStop,
} from "./flow-parts.tsx";

// Sizes in pixels. Nodes are HTML buttons and the edges an inline SVG behind them, drawn from the
// same numbers, as in the overview.
const NODE_WIDTH = 240;
const NODE_HEIGHT = 48;
const NODE_GAP = 12;
const COLUMN_GAP = 96;
const PAD = 16;
const HEADING = 28;

const COLUMNS = ["Reached from", "Runs through", "Ends in"] as const;

const columnX = (column: number): number => PAD + column * (NODE_WIDTH + COLUMN_GAP);

const nodeName = (node: BowTieNode): string =>
  [
    node.label,
    node.note,
    node.kind === "files" ? (node.status === "new" ? "new" : "changed") : null,
    node.stops.length > 1 ? node.stops.map((stop) => stop.label).join(", ") : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

/**
 * The pull request as a bow tie: where the change is reached on the left, the changed code it runs
 * through in the middle, by directory, and what it ends in on the right. A directory's box opens in
 * place to a box per file.
 */
export const FlowBowTie = ({
  flow,
  onOpenPart,
  onOpenFile,
  focusKey,
  opened,
  onToggle,
}: FlowViewProps & FlowFolds) => {
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  useFocusedStop(box, focusKey);
  const tie = useMemo(() => bowTie(flow, opened), [flow, opened]);
  const { nodes, edges } = tie;
  const { boxes, height } = useMemo(() => {
    const columns = [0, 1, 2].map((column) => nodes.filter((node) => node.column === column));
    const tall = (count: number) => Math.max(0, count * (NODE_HEIGHT + NODE_GAP) - NODE_GAP);
    const inner = Math.max(...columns.map((column) => tall(column.length)));
    const placed = new Map<string, { readonly x: number; readonly y: number }>();
    for (const [column, inIt] of columns.entries()) {
      const top = PAD + HEADING + (inner - tall(inIt.length)) / 2;
      for (const [at, node] of inIt.entries()) {
        placed.set(node.key, { x: columnX(column), y: top + at * (NODE_HEIGHT + NODE_GAP) });
      }
    }
    return { boxes: placed, height: 2 * PAD + HEADING + inner };
  }, [nodes]);
  const width = columnX(2) + NODE_WIDTH + PAD;
  const hoveredNode = nodes.find((node) => node.key === hovered);

  // The button that opened or collapsed a directory is gone with it, so the focus goes to the
  // directory's first file, or back to its box.
  const toggled = useRef<string | null>(null);
  const toggle = (group: string) => {
    toggled.current = group;
    setHovered(null);
    onToggle(group);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a directory opened or collapsed.
  useEffect(() => {
    if (toggled.current === null) return;
    box.current
      ?.querySelector<HTMLElement>(`[data-group="${CSS.escape(toggled.current)}"]`)
      ?.focus();
    toggled.current = null;
  }, [tie]);

  return (
    <section
      ref={box}
      data-slot="flow-bow-tie"
      aria-label="Where the change is reached, what it runs through and what it ends in"
      className="flex min-w-0 flex-col gap-3"
    >
      <FlowLegend>
        Left, where the change is reached. Middle, the changed directories it runs through. Right,
        the changed code that calls nothing else that changed, and the requests it sends.
      </FlowLegend>
      {tie.opened.length > 0 && (
        <p className="flex flex-wrap gap-2">
          {tie.opened.map(({ key, label, column }) => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              className="h-auto min-h-7 max-w-full text-left wrap-anywhere whitespace-normal"
              onClick={() => toggle(key)}
            >
              Collapse {label} · {COLUMNS[column]}
            </Button>
          ))}
        </p>
      )}
      {flow.paths.length === 0 ? (
        <NoPaths />
      ) : (
        <div
          data-slot="flow-bow-tie-scroll"
          className="overflow-x-auto rounded-lg border bg-surface-subtle"
        >
          <div className="relative mx-auto" style={{ width, height }}>
            {COLUMNS.map((heading, column) => (
              <span
                key={heading}
                className="absolute text-caption font-medium text-muted-foreground"
                style={{ left: columnX(column), top: PAD }}
              >
                {heading}
              </span>
            ))}
            <svg
              className="absolute inset-0 overflow-visible"
              width={width}
              height={height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={`${id}-arrow`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" className="fill-input" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = boxes.get(edge.from);
                const to = boxes.get(edge.to);
                if (from === undefined || to === undefined) return null;
                const [x1, y1] = [from.x + NODE_WIDTH, from.y + NODE_HEIGHT / 2];
                const [x2, y2] = [to.x, to.y + NODE_HEIGHT / 2];
                const bend = (x2 - x1) / 2;
                const lit = hovered === edge.from || hovered === edge.to;
                return (
                  <path
                    key={`${edge.from}>${edge.to}`}
                    data-slot="flow-bow-tie-edge"
                    d={`M ${x1} ${y1} C ${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`}
                    className={cn(
                      "fill-none stroke-input [stroke-width:1.5]",
                      lit && "stroke-primary [stroke-width:2]",
                      hovered !== null && !lit && "opacity-30",
                    )}
                    markerEnd={`url(#${id}-arrow)`}
                  />
                );
              })}
            </svg>
            {nodes.map((node) => {
              const at = boxes.get(node.key);
              const [first] = node.stops;
              const { group } = node;
              const several = node.stops.length > 1;
              return (
                <div
                  key={node.key}
                  className="absolute"
                  style={{ left: at?.x, top: at?.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                >
                  <button
                    type="button"
                    data-slot="flow-bow-tie-node"
                    data-kind={node.kind}
                    data-group={group ?? undefined}
                    // A path from outside isn't the file it uses, which has a box of its own.
                    data-path={node.status === "outside" ? undefined : first?.path}
                    data-holds={
                      several ? node.stops.map((stop) => stop.path).join("\n") : undefined
                    }
                    className={cn(
                      "grid size-full content-center gap-0.5 overflow-hidden rounded-md border px-2 text-left text-caption",
                      node.kind === "request"
                        ? "border-dashed border-input bg-card text-foreground"
                        : STOP_STYLE[node.status],
                      hovered === node.key && "border-primary",
                    )}
                    aria-label={nodeName(node)}
                    title={node.stops.map((stop) => stop.path).join("\n") || node.label}
                    onClick={() =>
                      node.partId !== null && onOpenPart(node.partId, first?.path ?? null)
                    }
                    onFocus={() => setHovered(node.key)}
                    onBlur={() => setHovered(null)}
                    onMouseEnter={() => setHovered(node.key)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span className={cn("flex min-w-0 items-center gap-1", several && "pr-6")}>
                      {node.kind === "request" ? (
                        <ArrowRightIcon aria-hidden="true" className="size-3 shrink-0" />
                      ) : (
                        node.status !== "outside" && <StatusGlyph status={node.status} />
                      )}
                      <span className="truncate font-mono text-code-compact font-semibold">
                        {node.label}
                      </span>
                    </span>
                    <span className="truncate">{node.note}</span>
                  </button>
                  {several && group !== null && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1 right-1 text-current"
                      aria-label={`Show the files of ${node.label} under ${COLUMNS[node.column]}`}
                      title="Show its files"
                      onClick={() => toggle(group)}
                    >
                      <LayoutGridIcon aria-hidden="true" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p
        data-slot="flow-bow-tie-detail"
        className="min-h-5 wrap-anywhere text-muted-foreground"
        aria-live="polite"
      >
        {hoveredNode === undefined
          ? "Hover or focus a box to see its files and what it links to."
          : hoveredNode.stops.length > 1
            ? `${hoveredNode.label} ${hoveredNode.stops.map((stop) => stop.label).join(", ")}.`
            : (hoveredNode.stops[0]?.path ?? hoveredNode.label)}
      </p>
      <OffThePaths
        flow={flow}
        hot={hot}
        onHot={setHot}
        onOpenPart={onOpenPart}
        onOpenFile={onOpenFile}
      />
    </section>
  );
};
