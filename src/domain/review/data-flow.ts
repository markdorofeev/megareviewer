import { z } from "zod";
import {
  type CallGraphHint,
  type DefinitionCalls,
  type FileChange,
  type FileLink,
  type HunkId,
  hunkIdOf,
  type PartId,
} from "../diff/index.ts";

/** Fewer stations than this aren't a flow: nothing is handed on. */
export const MIN_STATIONS = 2;
export const MAX_STATIONS = 7;

/**
 * A place on the data flow: a role in the change, not a file. `files` are the changed files that
 * play it, `shapes` the changed files that only define what it hands on.
 */
export const Station = z
  .object({
    name: z.string(),
    /** When or where it runs, where the stations differ in it. */
    when: z.string().nullable(),
    /** It holds the data for a later station to read. */
    keeps: z.boolean(),
    files: z.array(z.string()).readonly(),
    /** What it hands the next station, or leaves where the data ends up. */
    gives: z.string().nullable(),
    shapes: z.array(z.string()).readonly(),
  })
  .readonly();
export type Station = z.infer<typeof Station>;

/**
 * How data moves through the change: where it comes in, the stations it passes through in the order
 * it moves, and where it ends up. One path, the main one.
 */
export const DataFlow = z
  .object({
    source: z.string().nullable(),
    stations: z.array(Station).readonly(),
    end: z.string().nullable(),
  })
  .readonly();
export type DataFlow = z.infer<typeof DataFlow>;

/** What can be wrong with the flow the model wrote, by station index. */
export type DataFlowProblem =
  | {
      readonly kind: "unknown-file" | "repeated-file";
      readonly station: number;
      readonly path: string;
    }
  | { readonly kind: "unnamed" | "no-files" | "too-many"; readonly station: number }
  /** Nothing the code found joins `station` to the next one kept. */
  | { readonly kind: "unlinked"; readonly station: number; readonly next: number };

export interface DataFlowContext {
  /** The pull request's changed files. */
  readonly paths: ReadonlySet<string>;
  /** Whether the code found a call, a use, a request or an import between two of them, either way. */
  readonly linked: (a: string, b: string) => boolean;
}

/** What the code knows a flow can be checked against: the changed files and what joins them. */
export const dataFlowContext = (analysis: {
  readonly files: readonly FileChange[];
  readonly callGraph: readonly CallGraphHint[];
  readonly definitionCalls: readonly DefinitionCalls[];
  readonly fileLinks: readonly FileLink[];
}): DataFlowContext => {
  const pathOfHunk = new Map<HunkId, string>(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path] as const)),
  );
  const pathOf = (id: PartId | HunkId): string | undefined => pathOfHunk.get(hunkIdOf(id));
  const pairs = new Set<string>();
  const join = (a: string | undefined, b: string | undefined) => {
    if (a === undefined || b === undefined || a === b) return;
    pairs.add(`${a}\u0000${b}`);
    pairs.add(`${b}\u0000${a}`);
  };
  for (const hint of analysis.callGraph) join(pathOf(hint.fromPartId), pathOf(hint.toPartId));
  for (const link of analysis.fileLinks) join(link.from, link.to);
  const definitionPath = (at: number): string | undefined => {
    const [first] = analysis.definitionCalls[at]?.partIds ?? [];
    return first === undefined ? undefined : pathOf(first);
  };
  for (const [at, definition] of analysis.definitionCalls.entries()) {
    for (const callee of definition.calls) join(definitionPath(at), definitionPath(callee));
    for (const request of definition.requests) join(definitionPath(at), pathOf(request.toPartId));
  }
  return {
    paths: new Set(analysis.files.map((file) => file.path)),
    linked: (a, b) => pairs.has(`${a}\u0000${b}`),
  };
};

const blank = (text: string | null): boolean => text === null || text.trim() === "";

interface Placed {
  readonly files: readonly string[];
  readonly shapes: readonly string[];
  readonly problems: readonly DataFlowProblem[];
  /** Why the station isn't kept; null when it is. */
  readonly dropped: "unnamed" | "no-files" | "too-many" | null;
}

/**
 * Each station with its files and shapes that are the pull request's and placed nowhere before, and
 * whether it's kept: it has a name and a file, and is one of the first seven that do.
 */
const place = (flow: DataFlow, { paths }: DataFlowContext): Placed[] => {
  const taken = new Set<string>();
  let kept = 0;
  return flow.stations.map((station, index) => {
    const problems: DataFlowProblem[] = [];
    const keep = (path: string): boolean => {
      if (!paths.has(path)) {
        problems.push({ kind: "unknown-file", station: index, path });
        return false;
      }
      if (taken.has(path)) {
        problems.push({ kind: "repeated-file", station: index, path });
        return false;
      }
      taken.add(path);
      return true;
    };
    const files = station.files.filter(keep);
    const shapes = station.shapes.filter(keep);
    const dropped = blank(station.name)
      ? "unnamed"
      : files.length === 0
        ? "no-files"
        : kept >= MAX_STATIONS
          ? "too-many"
          : null;
    if (dropped === null) kept += 1;
    return { files, shapes, problems, dropped };
  });
};

/**
 * Every problem with the model's flow: files that aren't the pull request's or are in two places, a
 * station without a name or without a file, stations past the seventh, and two neighbors nothing in
 * the code joins. Neighbors are the stations that would be kept.
 */
export const validateDataFlow = (flow: DataFlow, context: DataFlowContext): DataFlowProblem[] => {
  const stations = place(flow, context);
  const kept = stations.flatMap((station, index) => (station.dropped === null ? [index] : []));
  const all = (index: number) => [
    ...(stations[index]?.files ?? []),
    ...(stations[index]?.shapes ?? []),
  ];
  return [
    ...stations.flatMap((station) => station.problems),
    ...stations.flatMap((station, index): DataFlowProblem[] =>
      station.dropped === null ? [] : [{ kind: station.dropped, station: index }],
    ),
    ...kept.flatMap((index, at): DataFlowProblem[] => {
      const next = kept[at + 1];
      if (next === undefined) return [];
      const joined = all(index).some((a) => all(next).some((b) => context.linked(a, b)));
      return joined ? [] : [{ kind: "unlinked", station: index, next }];
    }),
  ];
};

const text = (one: string | null): string | null => (blank(one) ? null : (one?.trim() ?? null));

/**
 * The flow kept after the retry: a file that isn't the pull request's or is already placed is
 * dropped, and so is a station left without a file or a name, and every station past the seventh.
 * Neighbors nothing joins are kept, since the page says so on their arrow. Fewer than two stations
 * left is no flow.
 */
export const keptDataFlow = (flow: DataFlow, context: DataFlowContext): DataFlow | null => {
  const placed = place(flow, context);
  const stations = flow.stations.flatMap((station, index) => {
    const at = placed[index];
    return at === undefined || at.dropped !== null
      ? []
      : [
          {
            name: station.name.trim(),
            when: text(station.when),
            keeps: station.keeps,
            files: at.files,
            gives: text(station.gives),
            shapes: at.shapes,
          },
        ];
  });
  return stations.length < MIN_STATIONS
    ? null
    : { source: text(flow.source), stations, end: text(flow.end) };
};
