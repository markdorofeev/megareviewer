import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import { reviewedHunkCount } from "./model.ts";
import type { FileOverview, OverviewEdge, OverviewNode } from "./overview.ts";

// Sizes in pixels. Nodes are HTML buttons, for focus and text that fits; the edges are an inline
// SVG behind them, drawn from the same numbers.
const NODE_HEIGHT = 64;
const ROW_GAP = 56;
const NODE_GAP = 24;
const PAD = 16;
const MIN_WIDTH = 120;
const MAX_WIDTH = 300;
/** Roughly what a character takes: of the label, of the line under it, of a badge. */
const LABEL_CHAR = 7.8;
const META_CHAR = 6.6;
const BADGE_CHAR = 6.7;
/** The padding, and the reviewed count beside the label. */
const LABEL_ROOM = 72;
const TEXT_ROOM = 20;
/** The widest a node grows to fit its text; past it, the text is cut with an ellipsis. */
const MAX_FIT = 380;

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const uses = (count: number): string => (count === 1 ? "1 use" : `${count} uses`);

const metaText = (
  node: Pick<OverviewNode, "kind" | "paths" | "added" | "deleted" | "entries" | "uses">,
) =>
  node.kind === "outside"
    ? `${node.paths.length > 1 ? `${node.paths.length} files · ` : ""}outside the PR · ${uses(node.uses)}`
    : `${node.kind === "group" ? `${node.paths.length} files · ` : ""}+${node.added} −${node.deleted}${
        node.entries.length > 0 ? ` · ${node.entries.join(", ")}` : ""
      }`;

/**
 * Wider with more lines changed, up to a maximum, and at least wide enough for its label, entries
 * and badges.
 */
export const nodeWidth = (node: OverviewNode): number => {
  const badges = node.badges.reduce(
    (sum, test) => sum + basename(test).length * BADGE_CHAR + 14,
    0,
  );
  const fit = Math.min(
    Math.max(
      node.label.length * LABEL_CHAR + LABEL_ROOM,
      metaText(node).length * META_CHAR + TEXT_ROOM,
      badges + TEXT_ROOM,
    ),
    MAX_FIT,
  );
  const bySize = MIN_WIDTH + Math.sqrt(node.added + node.deleted) * 9;
  return Math.round(Math.max(fit, Math.min(bySize, MAX_WIDTH)));
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Room on the right for edges that close a cycle, which run up the side. */
const BACK_ROOM = 72;

/** Each node's box: rows top to bottom, each row centered on the widest. */
const layout = (rows: FileOverview["rows"], backEdges: boolean) => {
  const widths = rows.map((row) =>
    row.reduce((sum, node, at) => sum + nodeWidth(node) + (at > 0 ? NODE_GAP : 0), 0),
  );
  const inner = Math.max(0, ...widths) + 2 * PAD;
  const width = inner + (backEdges ? BACK_ROOM : 0);
  const boxes = new Map<string, Box>();
  rows.forEach((row, at) => {
    let x = (inner - (widths[at] ?? 0)) / 2;
    for (const node of row) {
      const nodeW = nodeWidth(node);
      boxes.set(node.key, { x, y: PAD + at * (NODE_HEIGHT + ROW_GAP), width: nodeW });
      x += nodeW + NODE_GAP;
    }
  });
  const height =
    rows.length === 0 ? 0 : 2 * PAD + rows.length * NODE_HEIGHT + (rows.length - 1) * ROW_GAP;
  return { boxes, width, height };
};

/**
 * Solid for a call, dash-dot for a request, dashed for an import only, dotted for a type. From
 * outside the pull request, faded.
 */
const edgeStyle = (edge: OverviewEdge): string =>
  edge.outside
    ? "outside"
    : edge.uses.includes("call")
      ? "call"
      : edge.uses.includes("request")
        ? "request"
        : edge.uses.every((use) => use === "import")
          ? "import"
          : "type";

/**
 * Where each edge leaves its caller and enters its callee, spread across the middle of the node in
 * the order of the nodes at the other end, so edges into one file don't meet at a point.
 */
const anchors = (edges: readonly OverviewEdge[], boxes: ReadonlyMap<string, Box>) => {
  const center = (key: string) => {
    const box = boxes.get(key);
    return box === undefined ? 0 : box.x + box.width / 2;
  };
  const spread = (
    ends: readonly OverviewEdge[],
    key: string,
    other: (edge: OverviewEdge) => string,
  ) => {
    const box = boxes.get(key);
    const sorted = [...ends].sort((a, b) => center(other(a)) - center(other(b)));
    return new Map(
      sorted.map((edge, at) => [
        edge,
        box === undefined
          ? 0
          : box.x +
            box.width * (0.5 + (sorted.length === 1 ? 0 : (at / (sorted.length - 1) - 0.5) * 0.5)),
      ]),
    );
  };
  const forward = edges.filter((edge) => !edge.back && !edge.outside);
  const out = new Map<OverviewEdge, number>();
  const into = new Map<OverviewEdge, number>();
  for (const key of boxes.keys()) {
    for (const [edge, x] of spread(
      forward.filter((one) => one.from === key),
      key,
      (one) => one.to,
    ))
      out.set(edge, x);
    for (const [edge, x] of spread(
      forward.filter((one) => one.to === key),
      key,
      (one) => one.from,
    ))
      into.set(edge, x);
  }
  return { out, into };
};

const edgePath = (
  from: Box,
  to: Box,
  back: boolean,
  width: number,
  x1 = from.x + from.width / 2,
  x2 = to.x + to.width / 2,
): string => {
  if (back) {
    // Out of the caller's right side, up the right of the diagram, into the callee's right side.
    const x1 = from.x + from.width;
    const x2 = to.x + to.width;
    const y1 = from.y + NODE_HEIGHT / 2;
    const y2 = to.y + NODE_HEIGHT / 2;
    const side = width - BACK_ROOM / 2;
    return `M ${x1} ${y1} C ${side} ${y1} ${side} ${y2} ${x2} ${y2}`;
  }
  if (from.y > to.y) {
    // From a file outside the pull request, up into the bottom of the file it uses.
    const y1 = from.y;
    const y2 = to.y + NODE_HEIGHT;
    const bend = Math.max(ROW_GAP / 2, (y1 - y2) / 2);
    return `M ${x1} ${y1} C ${x1} ${y1 - bend} ${x2} ${y2 + bend} ${x2} ${y2}`;
  }
  const y1 = from.y + NODE_HEIGHT;
  const y2 = to.y;
  const bend = Math.max(ROW_GAP / 2, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
};

const USE_NAMES = {
  import: "imports",
  call: "calls",
  type: "uses types from",
  request: "sends requests to",
} as const;

const describeEdge = (edge: OverviewEdge, labelOf: (key: string) => string): string => {
  const uses = edge.uses.map((use) => USE_NAMES[use]).join(", ");
  const symbols = edge.symbols.length > 0 ? `: ${edge.symbols.join(", ")}` : "";
  return `${labelOf(edge.from)} ${uses} ${labelOf(edge.to)}${symbols}`;
};

/** Hunks reviewed: a split hunk counts once all its parts are. */
const reviewedState = (node: OverviewNode, reviewed: ReadonlySet<PartId>) => {
  const { done, total } = reviewedHunkCount(node.partIds, reviewed);
  return { done, total, all: done === total };
};

const NodeButton = ({
  node,
  box,
  reviewed,
  active,
  onOpen,
  onFocus,
}: {
  readonly node: OverviewNode;
  readonly box?: Box;
  readonly reviewed: ReadonlySet<PartId>;
  readonly active: boolean;
  readonly onOpen: (node: OverviewNode) => void;
  readonly onFocus: (node: OverviewNode | null) => void;
}) => {
  const state = reviewedState(node, reviewed);
  const group = node.kind === "group";
  const outside = node.kind === "outside";
  const name = (
    outside
      ? [node.label, metaText(node)]
      : [
          node.label,
          group ? `${node.paths.length} files` : null,
          ...node.entries,
          node.risk,
          node.generated ? "generated" : null,
          state.all ? "reviewed" : `${state.done} of ${state.total} hunks reviewed`,
        ]
  )
    .filter((part) => part !== null)
    .join(", ");
  return (
    <button
      type="button"
      className={`overview-node ${outside ? "outside" : `risk-${node.risk}`}${node.generated ? " generated" : ""}${group ? " group" : ""}${active ? " active" : ""}`}
      data-key={node.key}
      aria-label={name}
      title={node.paths.length === 1 ? node.paths[0] : undefined}
      style={
        box === undefined
          ? { width: nodeWidth(node) }
          : { left: box.x, top: box.y, width: box.width, height: NODE_HEIGHT }
      }
      onClick={() => onOpen(node)}
      onFocus={() => onFocus(node)}
      onMouseEnter={() => onFocus(node)}
      onMouseLeave={() => onFocus(null)}
    >
      <span className="overview-node-head">
        <span className="overview-label">{node.label}</span>
        {outside ? null : state.all ? (
          <span className="overview-tick" role="img" aria-label="reviewed">
            ✓
          </span>
        ) : (
          <span className="overview-count">
            {state.done}/{state.total}
          </span>
        )}
      </span>
      <span className="overview-meta">{metaText(node)}</span>
      {node.badges.length > 0 && (
        <span className="overview-badges">
          {node.badges.map((test) => (
            <span key={test} className="overview-badge">
              {basename(test)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
};

type Hovered =
  | { readonly kind: "node"; readonly node: OverviewNode }
  | { readonly kind: "edge"; readonly edge: OverviewEdge };

/**
 * The changed files as a layered diagram: entry points on top, each file one row below its
 * lowest caller. A click, or Enter, opens the file's code; arrows move between files.
 */
export const Overview = ({
  overview,
  reviewed,
  focusKey,
  onOpen,
  onCollapse,
  expandedGroups,
  onFocusNode,
}: {
  readonly overview: FileOverview;
  readonly reviewed: ReadonlySet<PartId>;
  /** A file to focus, at its place: its node, or one it's a badge on. A counter tells requests apart. */
  readonly focusKey: { readonly key: string; readonly n: number } | null;
  readonly onOpen: (node: OverviewNode) => void;
  readonly onCollapse: (groupKey: string) => void;
  readonly expandedGroups: readonly string[];
  readonly onFocusNode: (key: string) => void;
}) => {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const { boxes, width, height } = useMemo(
    () =>
      layout(
        overview.rows,
        overview.edges.some((edge) => edge.back),
      ),
    [overview],
  );
  const ends = useMemo(() => anchors(overview.edges, boxes), [overview.edges, boxes]);
  const labels = useMemo(
    () =>
      new Map([...overview.rows.flat(), ...overview.strip].map((node) => [node.key, node.label])),
    [overview],
  );
  const labelOf = (key: string) => labels.get(key) ?? key;
  // Rows, then the strip as one more row, for the arrows.
  const grid = useMemo(
    () => [...overview.rows, overview.strip].filter((row) => row.length > 0),
    [overview],
  );

  // A node that a group opened or closed over is gone, so is what it said.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the diagram changes.
  useEffect(() => setHovered(null), [overview]);

  // A request is done once its file's place is focused. Until then, a later diagram, such as one
  // with the file's group opened, tries again.
  const focused = useRef(-1);
  useEffect(() => {
    if (focusKey === null || focused.current === focusKey.n) return;
    const key = overview.placeOf.get(focusKey.key) ?? focusKey.key;
    const node = box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (node === null || node === undefined || key.startsWith("group:")) return;
    focused.current = focusKey.n;
    node.focus();
    node.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusKey, overview]);

  const focusNode = (key: string) =>
    box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = (event.target as HTMLElement).dataset.key;
    if (key === undefined) return;
    const row = grid.findIndex((one) => one.some((node) => node.key === key));
    const at = grid[row]?.findIndex((node) => node.key === key) ?? -1;
    const centerOf = (node: OverviewNode) => {
      const rect = box.current
        ?.querySelector(`[data-key="${CSS.escape(node.key)}"]`)
        ?.getBoundingClientRect();
      return rect === undefined ? 0 : rect.left + rect.width / 2;
    };
    let next: OverviewNode | undefined;
    if (event.key === "ArrowRight") next = grid[row]?.[at + 1];
    else if (event.key === "ArrowLeft") next = grid[row]?.[at - 1];
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // The nearest file in the row above or below.
      const target = grid[row + (event.key === "ArrowDown" ? 1 : -1)] ?? [];
      const here = grid[row]?.[at];
      const x = here === undefined ? 0 : centerOf(here);
      next = [...target].sort((a, b) => Math.abs(centerOf(a) - x) - Math.abs(centerOf(b) - x))[0];
    } else return;
    event.preventDefault();
    if (next !== undefined) focusNode(next.key);
  };

  const hoveredNode = hovered?.kind === "node" ? hovered.node.key : null;
  const touches = (edge: OverviewEdge) => edge.from === hoveredNode || edge.to === hoveredNode;
  const onNodeFocus = (node: OverviewNode | null) => {
    if (node !== null) onFocusNode(node.key);
    setHovered(node === null ? null : { kind: "node", node });
  };
  const nodeProps = (node: OverviewNode) => ({
    node,
    reviewed,
    active: hoveredNode === node.key,
    onOpen,
    onFocus: onNodeFocus,
  });

  return (
    <section
      className="overview"
      aria-label="Overview of the changed files"
      ref={box}
      onKeyDown={onKeyDown}
    >
      <p className="overview-legend muted">
        Files that nothing in the pull request calls are on top; each file sits below its callers.
        Solid lines are calls, dash-dot ones HTTP requests to a route, dashed ones imports, dotted
        ones types. Tests show on the files they call.
        {overview.edges.some((edge) => edge.outside) &&
          " Faded files at the bottom are outside the pull request and use what it changes."}
      </p>
      {expandedGroups.length > 0 && (
        <p className="overview-expanded">
          {expandedGroups.map((key) => (
            <button
              key={key}
              type="button"
              className="button quiet"
              onClick={() => onCollapse(key)}
            >
              Collapse {key.slice("group:".length)}/
            </button>
          ))}
        </p>
      )}
      {overview.rows.length > 0 ? (
        <div className="overview-scroll">
          <div className="overview-diagram" style={{ width, height }}>
            <svg className="overview-edges" width={width} height={height} aria-hidden="true">
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
                  <path d="M 0 0 L 8 4 L 0 8 z" className="overview-arrow" />
                </marker>
              </defs>
              {overview.edges.map((edge) => {
                const from = boxes.get(edge.from);
                const to = boxes.get(edge.to);
                if (from === undefined || to === undefined) return null;
                const d = edgePath(
                  from,
                  to,
                  edge.back,
                  width,
                  ends.out.get(edge),
                  ends.into.get(edge),
                );
                const lit = touches(edge) || (hovered?.kind === "edge" && hovered.edge === edge);
                const dim = hovered !== null && !lit;
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: a hovered edge names what it carries; for the keyboard, the focused file's detail names its edges.
                  <g
                    key={`${edge.from}>${edge.to}`}
                    className={`overview-edge ${edgeStyle(edge)}${lit ? " lit" : ""}${dim ? " dim" : ""}`}
                    onMouseEnter={() => setHovered({ kind: "edge", edge })}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <path d={d} className="overview-edge-hit" />
                    <path d={d} className="overview-edge-line" markerEnd={`url(#${id}-arrow)`} />
                    <title>{describeEdge(edge, labelOf)}</title>
                  </g>
                );
              })}
            </svg>
            {overview.rows.flat().map((node) => (
              <NodeButton key={node.key} box={boxes.get(node.key)} {...nodeProps(node)} />
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">No changed file calls or imports another.</p>
      )}
      {overview.strip.length > 0 && (
        <section className="overview-strip" aria-label="Not linked">
          <h3>Not linked</h3>
          <div className="overview-strip-nodes">
            {overview.strip.map((node) => (
              <NodeButton key={node.key} {...nodeProps(node)} />
            ))}
          </div>
        </section>
      )}
      <p className="overview-detail" aria-live="polite">
        {hovered === null
          ? "Hover or focus a file to see its flows and tests."
          : hovered.kind === "edge"
            ? describeEdge(hovered.edge, labelOf)
            : nodeDetail(hovered.node, overview.edges, labelOf)}
      </p>
    </section>
  );
};

/** A file's path, flows, the files it reaches with what each edge carries, and its tests. */
const nodeDetail = (
  node: OverviewNode,
  edges: readonly OverviewEdge[],
  labelOf: (key: string) => string,
): string => {
  const out = edges
    .filter((edge) => edge.from === node.key)
    .map((edge) => {
      const symbols = edge.symbols.length > 0 ? ` (${edge.symbols.join(", ")})` : "";
      return `${labelOf(edge.to)}${symbols}`;
    });
  if (node.kind === "outside") {
    const where =
      node.paths.length > 1 ? `${node.label}: ${node.paths.length} files` : node.paths[0];
    return `${where} · outside the pull request · uses ${out.join(", ")}.`;
  }
  const parts = [
    node.kind === "group"
      ? `${node.label}: ${node.paths.length} files, Enter expands`
      : node.paths[0],
    node.flows.length > 0 ? `read in ${node.flows.join("; ")}` : "in no flow",
    ...(out.length > 0 ? [`reaches ${out.join(", ")}`] : []),
    ...(node.badges.length > 0 ? [`tested in ${node.badges.map(basename).join(", ")}`] : []),
  ];
  return `${parts.join(" · ")}.`;
};
