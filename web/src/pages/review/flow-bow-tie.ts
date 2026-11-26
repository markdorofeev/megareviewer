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
  /** Under the label: a path's file and its other labels, or how many files a directory holds. */
  readonly note: string;
  readonly status: StopStatus;
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

const pathNote = (path: FlowPath): string =>
  [
    ...(path.stops[0] === undefined ? [] : [path.stops[0].label]),
    ...(path.labels.length > 1 ? [`and ${path.labels.length - 1} more`] : []),
  ].join(" · ");

/**
 * A path is a node on the left, standing for the files it starts in. Every other file a path runs is
 * in the middle, by directory, when it calls another changed file or sends a request, and on the
 * right when it does neither. Every link is a call the path makes: from a file to one it calls, the
 * files that starts are in drawn from the path's node. Requests to the pull request's routes are on
 * the right too, from the files that send them. A directory named in `opened` by its box's key is a
 * box per file, each with its own links.
 */
export const bowTie = (flow: FlowPaths, opened: ReadonlySet<string> = new Set()): BowTie => {
  const calling = new Set([
    ...flow.calls.map((call) => call.from),
    ...flow.paths.flatMap((path) => path.ends.map((end) => end.from)),
  ]);
  const layerLabel = new Map(flow.layers.map((layer) => [layer.key, layer.label]));
  const layerAt = new Map(flow.layers.map((layer, at) => [layer.key, at]));

  // The path's node stands for the files it starts in.
  const runs = (path: FlowPath) => path.stops.filter((stop) => stop.from !== null);
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
      status: first?.status ?? "changed",
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
    const stopAt = new Map(path.stops.map((stop) => [stop.path, stop]));
    const nodeOf = (file: string): string => {
      const stop = stopAt.get(file);
      return stop === undefined || stop.from === null ? path.key : boxOf(stop);
    };
    for (const { from, to } of path.calls) {
      // A call back into where the path starts isn't drawn: nothing points left.
      if (nodeOf(to) !== path.key && nodeOf(from) !== nodeOf(to)) link(nodeOf(from), nodeOf(to));
    }
    for (const end of path.ends) link(nodeOf(end.from), `request:${end.label}`);
  }
  return {
    nodes: [...left, ...files, ...ends],
    edges: [...edges.values()],
    opened: inOrder.flatMap(([key, { layer, column }]) =>
      isOpened(key) ? [{ key, column, label: `${directory(layer)}/` }] : [],
    ),
  };
};
