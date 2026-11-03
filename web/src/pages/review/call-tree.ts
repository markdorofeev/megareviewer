import type { CallGraphHint, HunkId } from "../../../../src/domain/diff/index.ts";

/** One row of the call tree: a hunk at its place, or a later mention of one placed above. */
export type CallTreeRow =
  | {
      readonly kind: "hunk";
      readonly hunkId: HunkId;
      readonly depth: number;
      /** What the parent calls to get here; null for a root. */
      readonly symbol: string | null;
      readonly parent: HunkId | null;
    }
  | {
      readonly kind: "reference";
      readonly hunkId: HunkId;
      readonly depth: number;
      readonly symbol: string;
      readonly parent: HunkId;
    };

export interface CallTree {
  readonly rows: readonly CallTreeRow[];
  /** Hunks no hint links to another hunk to review, by file in the order given. */
  readonly offPath: readonly { readonly path: string; readonly hunkIds: readonly HunkId[] }[];
}

interface Edge {
  readonly to: HunkId;
  readonly symbol: string;
  readonly line: number;
}

/**
 * The hunks to review as a tree from the entry points. `hunkIds` are the nodes, in the order
 * roots are picked: a root is a hunk no other hunk calls, and in a cycle with none, the first hunk
 * in that order. The walk is depth first, children in the order their calls appear in the code.
 * Each hunk is placed once, and a later mention is a reference row. Hints match symbols by name,
 * so a link can be wrong, but every hunk is in the tree or under `offPath` exactly once.
 */
export const callTree = (
  hunkIds: readonly HunkId[],
  callGraph: readonly CallGraphHint[],
  pathOf: (id: HunkId) => string,
): CallTree => {
  const rank = new Map(hunkIds.map((id, at) => [id, at]));
  const edges = new Map<HunkId, Edge[]>();
  const called = new Set<HunkId>();
  const linked = new Set<HunkId>();
  for (const { fromHunkId, toHunkId, symbol, line } of callGraph) {
    if (fromHunkId === toHunkId || !rank.has(fromHunkId) || !rank.has(toHunkId)) continue;
    const out = edges.get(fromHunkId) ?? [];
    const same = out.find((edge) => edge.to === toHunkId);
    // One child per called hunk, named by its first call.
    if (same === undefined || line < same.line) {
      edges.set(fromHunkId, [
        ...out.filter((edge) => edge !== same),
        { to: toHunkId, symbol, line },
      ]);
    }
    called.add(toHunkId);
    linked.add(fromHunkId).add(toHunkId);
  }
  for (const out of edges.values()) {
    out.sort(
      (a, b) =>
        a.line - b.line ||
        (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0) ||
        (rank.get(a.to) ?? 0) - (rank.get(b.to) ?? 0),
    );
  }

  const rows: CallTreeRow[] = [];
  const placed = new Set<HunkId>();
  // Iterative, so a long chain can't overflow the stack.
  const walk = (root: HunkId) => {
    const stack: (Edge & { readonly depth: number; readonly parent: HunkId | null })[] = [
      { to: root, symbol: "", line: 0, depth: 0, parent: null },
    ];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      const { to, symbol, depth, parent } = next;
      if (parent !== null && placed.has(to)) {
        rows.push({ kind: "reference", hunkId: to, depth, symbol, parent });
        continue;
      }
      placed.add(to);
      rows.push({
        kind: "hunk",
        hunkId: to,
        depth,
        symbol: parent === null ? null : symbol,
        parent,
      });
      const children = edges.get(to) ?? [];
      for (let at = children.length - 1; at >= 0; at--) {
        const child = children[at];
        if (child !== undefined) stack.push({ ...child, depth: depth + 1, parent: to });
      }
    }
  };
  for (const id of hunkIds) if (linked.has(id) && !called.has(id)) walk(id);
  for (const id of hunkIds) if (linked.has(id) && !placed.has(id)) walk(id);

  const offPath = new Map<string, HunkId[]>();
  for (const id of hunkIds) {
    if (linked.has(id)) continue;
    const path = pathOf(id);
    offPath.set(path, [...(offPath.get(path) ?? []), id]);
  }
  return {
    rows,
    offPath: [...offPath].map(([path, ids]) => ({ path, hunkIds: ids })),
  };
};

/** The hunks in the tree's order: placed rows, then those off any call path. */
export const treeOrder = (tree: CallTree): HunkId[] => [
  ...tree.rows.flatMap((row) => (row.kind === "hunk" ? [row.hunkId] : [])),
  ...tree.offPath.flatMap((group) => group.hunkIds),
];
