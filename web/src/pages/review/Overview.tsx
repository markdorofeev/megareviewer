import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FileOverview, OverviewEdge, OverviewNode } from "./overview.ts";
import {
  anchors,
  type Box,
  basename,
  edgePath,
  edgeStyle,
  files,
  layout,
  metaText,
  NODE_HEIGHT,
  nodeWidth,
} from "./overview-layout.ts";

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

/** A file's box, or a directory's, with a button that opens the directory in place. */
const NodeButton = ({
  node,
  box,
  active,
  current,
  onOpen,
  onExpand,
  onFocus,
}: {
  readonly node: OverviewNode;
  readonly box?: Box;
  readonly active: boolean;
  /** It holds the file last in view in the code. */
  readonly current: boolean;
  readonly onOpen: (node: OverviewNode) => void;
  readonly onExpand: (node: OverviewNode) => void;
  readonly onFocus: (node: OverviewNode | null) => void;
}) => {
  const group = node.kind === "group";
  const outside = node.kind === "outside";
  const name = (
    outside
      ? [node.label, metaText(node)]
      : [
          node.label,
          group ? files(node.paths.length) : null,
          node.contract > 0 ? `${node.contract} contract` : null,
          ...node.entries,
          node.risk,
          node.generated ? "generated" : null,
          current ? "in view in the code" : null,
        ]
  )
    .filter((part) => part !== null)
    .join(", ");
  const classes = [
    "overview-node",
    outside ? "outside" : `risk-${node.risk}`,
    node.generated && "generated",
    group && "group",
    active && "active",
    current && "current",
  ];
  return (
    <div
      className="overview-node-box"
      style={
        box === undefined
          ? { width: nodeWidth(node) }
          : { left: box.x, top: box.y, width: box.width, height: NODE_HEIGHT }
      }
    >
      <button
        type="button"
        className={classes.filter(Boolean).join(" ")}
        data-key={node.key}
        aria-label={name}
        aria-current={current ? "location" : undefined}
        title={group ? node.label : node.paths.length === 1 ? node.paths[0] : undefined}
        onClick={() => onOpen(node)}
        onFocus={() => onFocus(node)}
        onMouseEnter={() => onFocus(node)}
        onMouseLeave={() => onFocus(null)}
      >
        <span className="overview-node-head">
          <span className="overview-label">{node.label}</span>
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
      {group && node.paths.length > 1 && (
        <button
          type="button"
          className="overview-expand"
          aria-label={`Show the files of ${node.label}`}
          title="Show its files"
          onClick={() => onExpand(node)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
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
  focusKey,
  currentPath,
  onOpen,
  onExpand,
  onCollapse,
  expandedGroups,
  onFocusNode,
}: {
  readonly overview: FileOverview;
  /** The file last in view in the code: its directory is outlined. */
  readonly currentPath: string | null;
  readonly onExpand: (groupKey: string) => void;
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
    if (node === null || node === undefined) return;
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
  const currentKey = currentPath === null ? null : (overview.placeOf.get(currentPath) ?? null);
  const nodeProps = (node: OverviewNode) => ({
    node,
    active: hoveredNode === node.key,
    current: currentKey === node.key,
    onOpen,
    onExpand: (one: OverviewNode) => onExpand(one.key),
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
        Each box is a directory. Directories that nothing in the pull request calls are on top; each
        sits below its callers. Solid lines are calls, dash-dot ones HTTP requests to a route,
        dashed ones imports, dotted ones types. Tests show on the directories they call. The
        outlined box holds the file last in view in the code.
        {overview.edges.some((edge) => edge.outside) &&
          " Faded files are outside the pull request, under the code whose changes they use."}
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
          ? "Hover or focus a directory to see its files, flows and tests."
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
    node.kind === "group" ? `${node.label}: ${node.paths.map(basename).join(", ")}` : node.paths[0],
    node.flows.length > 0 ? `read in ${node.flows.join("; ")}` : "in no flow",
    ...(out.length > 0 ? [`reaches ${out.join(", ")}`] : []),
    ...(node.badges.length > 0 ? [`tested in ${node.badges.map(basename).join(", ")}`] : []),
  ];
  return `${parts.join(" · ")}.`;
};
