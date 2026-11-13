import type { FileOverview, OverviewEdge, OverviewNode } from "./overview.ts";

// The overview's layout.

// Sizes in pixels. Nodes are HTML buttons, for focus and text that fits; the edges are an inline
// SVG behind them, drawn from the same numbers.
export const NODE_HEIGHT = 64;
const ROW_GAP = 56;
const NODE_GAP = 24;
const PAD = 16;
const MIN_WIDTH = 120;
const MAX_WIDTH = 300;
/** Roughly what a character takes: of the label, of the line under it, of a badge. */
const LABEL_CHAR = 8.6;
const META_CHAR = 6.6;
const BADGE_CHAR = 6.7;
/** The padding beside the label, and the expand button beside a directory's. */
const LABEL_ROOM = 32;
const EXPAND_ROOM = 24;
const TEXT_ROOM = 20;
/** The widest a node grows to fit its text; past it, the text is cut with an ellipsis. */
const MAX_FIT = 380;

export const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const uses = (count: number): string => (count === 1 ? "1 use" : `${count} uses`);

export const files = (count: number): string => (count === 1 ? "1 file" : `${count} files`);

export const metaText = (
  node: Pick<OverviewNode, "kind" | "paths" | "added" | "deleted" | "entries" | "uses">,
) =>
  node.kind === "outside"
    ? `${node.paths.length > 1 ? `${files(node.paths.length)} · ` : ""}outside the PR · ${uses(node.uses)}`
    : [
        node.kind === "group" ? files(node.paths.length) : `+${node.added} −${node.deleted}`,
        ...node.entries,
      ].join(" · ");

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
      node.label.length * LABEL_CHAR +
        LABEL_ROOM +
        (node.kind === "group" && node.paths.length > 1 ? EXPAND_ROOM : 0),
      metaText(node).length * META_CHAR + TEXT_ROOM,
      badges + TEXT_ROOM,
    ),
    MAX_FIT,
  );
  const bySize = MIN_WIDTH + Math.sqrt(node.added + node.deleted) * 9;
  return Math.round(Math.max(fit, Math.min(bySize, MAX_WIDTH)));
};

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Room on the right for edges that close a cycle, which run up the side. */
const BACK_ROOM = 72;

/** Each node's box: rows top to bottom, each row centered on the widest. */
export const layout = (rows: FileOverview["rows"], backEdges: boolean) => {
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
 * Dash-dot for a request, which crosses into another process, even merged with calls; else solid
 * for a call, dashed for an import only, dotted for a type. From outside the pull request, faded.
 */
export const edgeStyle = (edge: OverviewEdge): string =>
  edge.outside
    ? "outside"
    : edge.uses.includes("request")
      ? "request"
      : edge.uses.includes("call")
        ? "call"
        : edge.uses.every((use) => use === "import")
          ? "import"
          : "type";

/**
 * Where each edge leaves its caller and enters its callee, spread across the middle of the node in
 * the order of the nodes at the other end, so edges into one file don't meet at a point.
 */
export const anchors = (edges: readonly OverviewEdge[], boxes: ReadonlyMap<string, Box>) => {
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

export const edgePath = (
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
