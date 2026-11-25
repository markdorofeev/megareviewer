import type { PartId } from "../../../../src/domain/diff/index.ts";
import type { FlowPath, FlowPaths, Stop, StopStatus } from "./flow-paths.ts";

// The bow tie: where the change is reached on the left, the changed code it runs through in the
// middle, and what it ends in on the right.

export interface BowTieNode {
  readonly key: string;
  /** 0: where it's reached. 1: what it runs through. 2: what it ends in. */
  readonly column: 0 | 1 | 2;
  readonly kind: "path" | "files" | "request";
  readonly label: string;
  /** Under the label: the other labels of a path, or how many files a directory holds. */
  readonly note: string;
  readonly status: StopStatus | "outside";
  /** A directory's files, or a path's first. */
  readonly stops: readonly Stop[];
  /** The directory's box it is, or was before that was opened to its files. */
  readonly group: string | null;
  /** The part a click opens. */
  readonly partId: PartId | null;
}

export interface BowTie {
  readonly nodes: readonly BowTieNode[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  /** The directories' boxes opened to their files. */
  readonly opened: readonly {
    readonly key: string;
    readonly column: 1 | 2;
    readonly label: string;
  }[];
}

const statusOf = (stops: readonly Stop[]): StopStatus =>
  stops.every((stop) => stop.status === "new") ? "new" : "changed";

const pathNote = (path: FlowPath): string => {
  const more = path.labels.length - 1;
  const others = more === 0 ? "" : ` · and ${more} more`;
  return `${path.inPullRequest ? "In this PR" : "Not in this PR"}${others}`;
};

/**
 * A path is a node on the left, standing for the file it starts in. Every other file a path runs
 * is in the middle, by directory, when it calls another changed file, and on the right when it
 * calls none. A path links to each directory it runs through, and to an end only when nothing it
 * runs through calls that end; a directory links to the ends its files call. Requests to the pull
 * request's routes are ends too. A directory named in `opened` by its box's key is a box per file,
 * each with its own links.
 */
export const bowTie = (flow: FlowPaths, opened: ReadonlySet<string> = new Set()): BowTie => {
  const calling = new Set(flow.calls.map((call) => call.from));
  const callsTo = new Map<string, Set<string>>();
  for (const { from, to } of flow.calls)
    callsTo.set(from, (callsTo.get(from) ?? new Set()).add(to));
  const layerLabel = new Map(flow.layers.map((layer) => [layer.key, layer.label]));
  const layerAt = new Map(flow.layers.map((layer, at) => [layer.key, at]));

  // The stops a path runs after the file it starts in; outside the pull request, all of them.
  const runs = (path: FlowPath) => (path.inPullRequest ? path.stops.slice(1) : path.stops);
  const groups = new Map<
    string,
    { readonly layer: string; readonly column: 1 | 2; readonly stops: Map<string, Stop> }
  >();
  const groupOf = (stop: Stop) => `${calling.has(stop.path) ? "through" : "end"}:${stop.layer}`;
  for (const path of flow.paths) {
    for (const stop of runs(path)) {
      const key = groupOf(stop);
      const group = groups.get(key) ?? {
        layer: stop.layer,
        column: calling.has(stop.path) ? 1 : 2,
        stops: new Map<string, Stop>(),
      };
      group.stops.set(stop.path, stop);
      groups.set(key, group);
    }
  }
  const isOpened = (key: string) => opened.has(key) && (groups.get(key)?.stops.size ?? 0) > 1;
  const boxOf = (stop: Stop) => {
    const key = groupOf(stop);
    return isOpened(key) ? `${key}\u0000${stop.path}` : key;
  };
  const directory = (layer: string) => layerLabel.get(layer) ?? layer;

  const left = flow.paths.map((path): BowTieNode => {
    const [first] = path.stops;
    return {
      key: path.key,
      column: 0,
      kind: "path",
      label: path.labels[0] ?? "",
      note: pathNote(path),
      status: path.inPullRequest ? (first?.status ?? "changed") : "outside",
      stops: first === undefined ? [] : [first],
      group: null,
      partId: first?.partIds[0] ?? null,
    };
  });
  const inOrder = [...groups].sort(
    ([, a], [, b]) => (layerAt.get(a.layer) ?? 0) - (layerAt.get(b.layer) ?? 0),
  );
  const files = inOrder.flatMap(([group, { layer, column, stops }]): BowTieNode[] => {
    const node = (key: string, inIt: readonly Stop[]): BowTieNode => {
      const [first] = inIt;
      const one = inIt.length === 1;
      return {
        key,
        column,
        kind: "files",
        label: one && first !== undefined ? first.label : `${directory(layer)}/`,
        note: one ? directory(layer) : `${inIt.length} files`,
        status: statusOf(inIt),
        stops: inIt,
        group,
        partId: first?.partIds[0] ?? null,
      };
    };
    const inIt = [...stops.values()];
    return isOpened(group) ? inIt.map((stop) => node(boxOf(stop), [stop])) : [node(group, inIt)];
  });
  const requests = new Map(
    flow.paths.flatMap((path) => path.ends).map((end) => [`request:${end.label}`, end]),
  );
  const ends = [...requests].map(
    ([key, end]): BowTieNode => ({
      key,
      column: 2,
      kind: "request",
      label: end.label,
      note: "Request to a route in this PR",
      status: "changed",
      stops: [],
      group: null,
      partId: end.partId,
    }),
  );

  const edges = new Map<string, { from: string; to: string }>();
  const link = (from: string, to: string) => edges.set(`${from}\u0000${to}`, { from, to });
  for (const path of flow.paths) {
    const through = runs(path).filter((stop) => calling.has(stop.path));
    for (const stop of runs(path)) {
      const reachedThrough = through.some((other) => callsTo.get(other.path)?.has(stop.path));
      if (calling.has(stop.path) || !reachedThrough) link(path.key, boxOf(stop));
    }
    for (const stop of through) {
      for (const to of runs(path)) {
        if (!calling.has(to.path) && callsTo.get(stop.path)?.has(to.path)) {
          link(boxOf(stop), boxOf(to));
        }
      }
    }
    for (const end of path.ends) link(path.key, `request:${end.label}`);
  }
  return {
    nodes: [...left, ...files, ...ends],
    edges: [...edges.values()],
    opened: inOrder.flatMap(([key, { layer, column }]) =>
      isOpened(key) ? [{ key, column, label: `${directory(layer)}/` }] : [],
    ),
  };
};
