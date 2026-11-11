import { directoryOf } from "../../review/tree/paths.ts";
import { boxDirectory, type FileOverview, type OverviewNode, uniqueLabels } from "./overview.ts";
import { layout } from "./overview-layout.ts";

// The overview as a miniature in the rail: the full overview's boxes, scaled to the rail's width,
// with directories grouped by their leading segments when the diagram is too wide to read there.

/** The width the miniature has in the rail, in pixels. */
export const RAIL_WIDTH = 264;
/**
 * The smallest share of its full size a box keeps in the miniature and stays legible: 13px tall,
 * room for one line of 10px text.
 */
export const MIN_SCALE = 0.2;

export interface MiniOverview {
  readonly overview: FileOverview;
  /** Directories cut to this many leading segments to fit; null when they're the full overview's. */
  readonly depth: number | null;
}

/** The full overview's size: what the miniature scales down from. */
export const fullSize = (overview: FileOverview) =>
  layout(
    overview.rows,
    overview.edges.some((edge) => edge.back),
  );

const scaleOf = (overview: FileOverview): number => {
  const { width } = fullSize(overview);
  return width === 0 ? 1 : RAIL_WIDTH / width;
};

/**
 * The overview for the rail: the full one when it fits, else the one with directories cut to the
 * deepest number of leading segments that fits. When none fits, the narrowest, which is the full
 * one when grouping doesn't narrow it, such as when the widest row is files outside the PR.
 * `build` makes the overview with directories cut to `depth` segments, or uncut.
 */
export const fitMiniOverview = (
  build: (depth?: number) => FileOverview,
  paths: readonly string[],
): MiniOverview => {
  let best: MiniOverview & { readonly scale: number } = {
    overview: build(),
    depth: null,
    scale: 0,
  };
  best = { ...best, scale: scaleOf(best.overview) };
  if (best.scale >= MIN_SCALE) return { overview: best.overview, depth: null };
  const deepest = Math.max(0, ...paths.map((path) => directoryOf(path).split("/").length));
  for (let depth = deepest - 1; depth >= 1; depth--) {
    const grouped = build(depth);
    const scale = scaleOf(grouped);
    if (scale >= MIN_SCALE) return { overview: grouped, depth };
    if (scale > best.scale) best = { overview: grouped, depth, scale };
  }
  return { overview: best.overview, depth: best.depth };
};

/**
 * Each box's label in the miniature: its directory's last segment, with as many parents as it takes
 * to tell two boxes apart. Files outside the pull request keep their own label's last segments.
 */
export const miniLabels = (nodes: readonly OverviewNode[]): ReadonlyMap<string, string> => {
  const nameOf = (node: OverviewNode): string =>
    node.kind === "group"
      ? node.key.slice("group:".length) || "."
      : node.label.endsWith("/")
        ? node.label.slice(0, -1)
        : node.label;
  const names = nodes.map(nameOf);
  const unique = uniqueLabels(names);
  return new Map(
    nodes.map((node) => {
      const name = nameOf(node);
      const short = unique.get(name) ?? name;
      const directory = node.kind === "group" || node.label.endsWith("/");
      return [node.key, directory ? `${short}/` : short];
    }),
  );
};

export interface MiniLists {
  /** The directory of the file in view, as the miniature's boxes cut it. */
  readonly directory: string;
  /** The files in that directory, in page order. */
  readonly here: readonly string[];
  /** Files in other directories that call the file in view, in page order. */
  readonly calledBy: readonly string[];
  /** Files in other directories the file in view calls, in page order. */
  readonly calls: readonly string[];
}

/** What the rail lists under the miniature for the file in view. */
export const miniLists = (
  current: string,
  paths: readonly string[],
  neighbors: ReadonlyMap<string, ReadonlySet<string>>,
  depth: number | null,
): MiniLists => {
  const boxOf = (path: string) => boxDirectory(path, depth ?? undefined);
  const directory = boxOf(current);
  const elsewhere = paths.filter((path) => boxOf(path) !== directory);
  return {
    directory,
    here: paths.filter((path) => boxOf(path) === directory),
    calledBy: elsewhere.filter((path) => neighbors.get(path)?.has(current) === true),
    calls: elsewhere.filter((path) => neighbors.get(current)?.has(path) === true),
  };
};
