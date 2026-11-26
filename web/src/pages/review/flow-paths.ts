import {
  type DefinitionCalls,
  type FileChange,
  hunkIdOf,
  isTestFile,
  type PartId,
  partsByHunk,
  piecesOf,
} from "../../../../src/domain/diff/index.ts";
import type { Analysis, Flow } from "../../../../src/domain/review/index.ts";
import { byTreePath, directoryOf, treePath } from "../../review/tree/paths.ts";
import { uniqueLabels } from "./overview.ts";

// The overview's preview layouts: the pull request as flow paths, each from where the change is
// reached through the changed files it runs. It imports only domain code, as the overview does.

/** A file the pull request adds is new; any other it changes is changed. */
export type StopStatus = "new" | "changed";

/** A changed file on a flow path. */
export interface Stop {
  readonly path: string;
  /** The file's name without its extension, with as many directories as tell it from the others. */
  readonly label: string;
  /** Its directory: the column it's drawn in. */
  readonly layer: string;
  readonly status: StopStatus;
  /** The changed definitions the path runs in it. */
  readonly names: readonly string[];
  /** Its parts on the path, callers first: a click opens the first. */
  readonly partIds: readonly PartId[];
  /** How many flow paths run it. */
  readonly shared: number;
  /**
   * The path of the stop it's drawn under: of those that call it, the one fewest calls from where
   * the path starts. Null where it starts.
   */
  readonly from: string | null;
  /** The labels of every stop on the path that calls it. */
  readonly calledBy: readonly string[];
}

/** A call from one changed file into another. */
export interface FileCall {
  readonly from: string;
  readonly to: string;
}

/** A request a path sends to a route the pull request adds: where the path leaves its process. */
export interface PathEnd {
  /** The route's method and path. */
  readonly label: string;
  readonly partId: PartId;
  /** The path of the stop that sends it. */
  readonly from: string;
}

export interface FlowPath {
  readonly key: string;
  /**
   * Where it's reached: a route, a page, a command, the definition nothing calls, or a file
   * outside. Several when they run the same changed files.
   */
  readonly labels: readonly string[];
  /** False for files the pull request doesn't change that use what it changes. */
  readonly inPullRequest: boolean;
  /** Outside the pull request, the files' paths. */
  readonly outside: readonly string[];
  /** The changed files it runs: where it starts, then what those call, and so on. */
  readonly stops: readonly Stop[];
  /** The calls it makes between them: no form links two stops without one. */
  readonly calls: readonly FileCall[];
  readonly ends: readonly PathEnd[];
}

export interface Layer {
  /** The directory. */
  readonly key: string;
  readonly label: string;
}

/** Changed files that aren't code to follow: every one is listed, none is a stop. */
export interface AlsoChanged {
  readonly tests: readonly string[];
  readonly docs: readonly string[];
  readonly generated: readonly string[];
  /** Proved mechanical in every hunk. */
  readonly mechanical: readonly string[];
  /** Files in no language megareviewer parses, such as configuration. */
  readonly other: readonly string[];
}

export interface FlowPaths {
  readonly paths: readonly FlowPath[];
  /** The stops' directories, callers before callees. */
  readonly layers: readonly Layer[];
  /** The calls of every path. */
  readonly calls: readonly FileCall[];
  /** Changed code no path runs. */
  readonly unreached: readonly Stop[];
  readonly also: AlsoChanged;
}

export type FlowPathsInput = Pick<
  Analysis,
  "files" | "parts" | "proofs" | "callGraph" | "generated" | "flows"
> &
  Partial<Pick<Analysis, "definitionCalls" | "unchangedCallers">>;

const isDoc = (path: string): boolean => /\.(md|mdx|rst|adoc|txt)$/i.test(path);
const withoutExtension = (label: string): string => {
  const slash = label.lastIndexOf("/");
  const dot = label.lastIndexOf(".");
  return dot > slash + 1 ? label.slice(0, dot) : label;
};
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Names a label spells out before "and N more". */
const MAX_NAMES = 3;

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const listed = (names: readonly string[]): string =>
  names.length <= MAX_NAMES
    ? names.join(", ")
    : `${names.slice(0, MAX_NAMES).join(", ")} and ${names.length - MAX_NAMES} more`;

/**
 * The changed definitions and what each runs. An analysis stored before they were kept has only the
 * hints, a part to each definition; a part that holds no definition is one by itself.
 */
const definitionsOf = (analysis: FlowPathsInput): DefinitionCalls[] => {
  const byHunk = partsByHunk(analysis.parts);
  const ids = analysis.files.flatMap((file) => piecesOf(file, byHunk).map((piece) => piece.id));
  const names = new Map(analysis.parts.map((part) => [part.id, part.definitions.join(", ")]));
  const kept = analysis.definitionCalls ?? [];
  if (kept.length > 0) {
    const held = new Set(kept.flatMap((one) => one.partIds));
    return [
      ...kept,
      ...ids
        .filter((id) => !held.has(id))
        .map((id) => ({ name: names.get(id) ?? "", partIds: [id], calls: [], requests: [] })),
    ];
  }
  const place = new Map(ids.map((id, at) => [id, at]));
  const hints = [...analysis.callGraph].sort((a, b) => a.line - b.line);
  return ids.map((id) => {
    const own = hints.filter((hint) => hint.fromPartId === id);
    return {
      name: names.get(id) ?? "",
      partIds: [id],
      calls: unique(
        own.flatMap((hint) => (hint.use === "call" ? (place.get(hint.toPartId) ?? []) : [])),
      ),
      requests: own.flatMap(({ use, symbol, toPartId }) =>
        use === "request" ? [{ symbol, toPartId }] : [],
      ),
    };
  });
};

/** The definitions of the files that are code, by their place in the analysis's list. */
const codeGraph = (analysis: FlowPathsInput, fileOf: ReadonlyMap<PartId, FileChange>) => {
  const definitions = definitionsOf(analysis).map(({ name, partIds, calls, requests }) => ({
    name,
    partIds: partIds.filter((id) => fileOf.has(id)),
    calls,
    requests: requests.filter((request) => fileOf.has(request.toPartId)),
  }));
  const pathAt = (at: number): string | undefined => {
    const [first] = definitions[at]?.partIds ?? [];
    return first === undefined ? undefined : fileOf.get(first)?.path;
  };
  const calleesOf = (at: number): number[] =>
    (definitions[at]?.calls ?? []).filter((to) => to !== at && pathAt(to) !== undefined);
  const all = [...definitions.keys()].filter((at) => pathAt(at) !== undefined);
  /** The definitions that run from `starts`, in the order calls reach them. */
  const reach = (starts: readonly number[]): number[] => {
    const seen = new Set<number>();
    const visit = (at: number) => {
      if (seen.has(at)) return;
      seen.add(at);
      for (const callee of calleesOf(at)) visit(callee);
    };
    for (const start of starts) visit(start);
    return [...seen];
  };
  /** The files definitions are in. */
  const pathsOf = (ats: readonly number[]) => unique(ats.flatMap((at) => pathAt(at) ?? []));
  return { definitions, all, pathAt, calleesOf, reach, pathsOf };
};

/** The calls between files the definitions make. */
const fileCallsOf = (
  runs: readonly number[],
  { pathAt, calleesOf }: ReturnType<typeof codeGraph>,
): FileCall[] => {
  const calls = new Map<string, FileCall>();
  for (const at of runs) {
    for (const callee of calleesOf(at)) {
      const [from, to] = [pathAt(at), pathAt(callee)];
      if (from !== undefined && to !== undefined && from !== to)
        calls.set(`${from}\u0000${to}`, { from, to });
    }
  }
  return [...calls.values()];
};

/** Each file with the one that calls it nearest the starts, in the order calls reach them. */
const calledFrom = (
  starts: readonly string[],
  calls: readonly FileCall[],
): ReadonlyMap<string, string | null> => {
  const from = new Map<string, string | null>(starts.map((path) => [path, null]));
  // A map's iteration takes in what's added to it as it goes: breadth first.
  for (const path of from.keys()) {
    for (const call of calls) {
      if (call.from === path && !from.has(call.to)) from.set(call.to, path);
    }
  }
  return from;
};

/** A path before it's drawn: where it starts and the definitions it runs. */
interface Walk {
  readonly key: string;
  readonly label: string;
  /** Outside the pull request, the file it starts in. */
  readonly from: string | null;
  readonly starts: readonly number[];
  readonly runs: readonly number[];
}

/**
 * The paths the pull request starts itself: at the flows' entries, then at each file's definitions
 * that no changed code calls, those that run the most files first and only where no path yet runs
 * every one, then in files that only call each other in a circle.
 */
const walksOf = (
  flows: readonly Flow[],
  graph: ReturnType<typeof codeGraph>,
  files: readonly string[],
): Walk[] => {
  const { definitions, all, pathAt, calleesOf, reach, pathsOf } = graph;
  const labels = uniqueLabels(files);
  const walks: Walk[] = [];
  const entered = new Set<number>();
  for (const [at, flow] of flows.entries()) {
    const starts = all.filter((one) =>
      definitions[one]?.partIds.some((id) => flow.entries.includes(id)),
    );
    if (starts.length === 0) continue;
    for (const start of starts) entered.add(start);
    walks.push({ key: `flow:${at}`, label: flow.title, from: null, starts, runs: reach(starts) });
  }

  const called = new Set(all.flatMap(calleesOf));
  const walkFrom = (path: string, include: (at: number) => boolean): Walk[] => {
    const starts = all.filter(
      (at) => pathAt(at) === path && calleesOf(at).length > 0 && include(at),
    );
    if (starts.length === 0) return [];
    const names = unique(starts.flatMap((at) => definitions[at]?.name || []));
    const label =
      names.length === 0 ? (labels.get(path) ?? path) : `${listed(names)} in ${basename(path)}`;
    return [{ key: `file:${path}`, label, from: null, starts, runs: reach(starts) }];
  };
  const candidates = files
    .flatMap((path) => walkFrom(path, (at) => !called.has(at) && !entered.has(at)))
    .sort((a, b) => pathsOf(b.runs).length - pathsOf(a.runs).length);
  for (const one of candidates) {
    const run = pathsOf(one.runs);
    const known = walks.map((other) => pathsOf(other.runs));
    if (!known.some((other) => run.every((path) => other.includes(path)))) walks.push(one);
  }
  for (const path of files) {
    if (walks.some((one) => pathsOf(one.runs).includes(path))) continue;
    walks.push(...walkFrom(path, () => true));
  }
  return walks;
};

/**
 * The pull request as flow paths. A path starts at a flow's entry points, a route, a page or a
 * command, or else at the definitions of a file that nothing in the pull request calls, and runs
 * the definitions their calls reach: a file is a stop only where one of those is in it, so code
 * several paths run is a stop on each. One that starts at no entry isn't drawn when another path
 * runs every file on it. A file outside the pull request that uses a changed definition starts a
 * path of its own. Paths that start in the same files, run the same ones and send the same requests
 * are one path with each one's label. Tests, docs, generated and mechanical files are listed apart, and code no path runs
 * is `unreached`: every changed file is in exactly one of them or on a path.
 */
export const flowPaths = (analysis: FlowPathsInput): FlowPaths => {
  const mechanical = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const generated = new Set(analysis.generated);
  const also = {
    tests: [] as string[],
    docs: [] as string[],
    generated: [] as string[],
    mechanical: [] as string[],
    other: [] as string[],
  };
  const code = analysis.files.filter((file) => {
    const group = file.hunks.every((hunk) => mechanical.has(hunk.id))
      ? also.mechanical
      : isTestFile(file.path)
        ? also.tests
        : isDoc(file.path)
          ? also.docs
          : generated.has(file.path)
            ? also.generated
            : file.language === null
              ? also.other
              : null;
    group?.push(file.path);
    return group === null;
  });

  const byHunk = partsByHunk(analysis.parts);
  const fileOf = new Map(
    code.flatMap((file) =>
      piecesOf(file, byHunk)
        .filter((piece) => !mechanical.has(hunkIdOf(piece.id)))
        .map((piece) => [piece.id, file] as const),
    ),
  );
  const labels = uniqueLabels(code.map((file) => file.path));

  const graph = codeGraph(analysis, fileOf);
  const { definitions, all, pathAt, calleesOf, reach, pathsOf } = graph;
  const inTreeOrder = code.map((file) => file.path).sort(byTreePath);
  const walked = walksOf(analysis.flows ?? [], graph, inTreeOrder);
  const outside = new Map<string, number[]>();
  for (const { partId, symbol, uses } of analysis.unchangedCallers ?? []) {
    const changing = all.filter((at) => definitions[at]?.partIds.includes(partId));
    const named = changing.filter((at) => definitions[at]?.name === symbol);
    const used = named.length > 0 ? named : changing;
    for (const use of uses) {
      if (isTestFile(use.path) || used.length === 0) continue;
      outside.set(use.path, unique([...(outside.get(use.path) ?? []), ...used]));
    }
  }
  const outsideLabels = uniqueLabels([...outside.keys()]);
  for (const [path, starts] of [...outside].sort(([a], [b]) => byTreePath(a, b))) {
    walked.push({
      key: `outside:${path}`,
      label: outsideLabels.get(path) ?? path,
      from: path,
      starts,
      runs: reach(starts),
    });
  }

  // How many flows and outside files run each file, before the ones alike become one path.
  const shared = new Map<string, number>();
  for (const one of walked) {
    for (const path of pathsOf(one.runs)) shared.set(path, (shared.get(path) ?? 0) + 1);
  }
  const labelOf = (path: string) => withoutExtension(labels.get(path) ?? path);
  const stop = (
    path: string,
    ats: readonly number[],
    { from, calledBy }: Pick<Stop, "from" | "calledBy">,
  ): Stop => ({
    path,
    label: labelOf(path),
    layer: directoryOf(path),
    status: code.find((file) => file.path === path)?.status === "added" ? "new" : "changed",
    names: unique(ats.flatMap((at) => definitions[at]?.name || [])),
    partIds: unique(ats.flatMap((at) => definitions[at]?.partIds ?? [])),
    shared: shared.get(path) ?? 0,
    from,
    calledBy,
  });
  /** A path of the walks that start in the same files, run the same ones and send the same. */
  const drawn = (alike: readonly Walk[]): FlowPath[] => {
    const [first] = alike;
    if (first === undefined) return [];
    const runs = unique(alike.flatMap((one) => one.runs));
    const calls = fileCallsOf(runs, graph);
    const from = calledFrom(pathsOf(first.starts), calls);
    const ends = runs.flatMap((at) =>
      (definitions[at]?.requests ?? []).map(({ symbol, toPartId }) => ({
        label: symbol,
        partId: toPartId,
        from: pathAt(at) ?? "",
      })),
    );
    return [
      {
        key: first.key,
        labels: alike.map((one) => one.label),
        inPullRequest: first.from === null,
        outside: alike.flatMap((one) => one.from ?? []),
        stops: [...from].map(([path, caller]) =>
          stop(
            path,
            runs.filter((at) => pathAt(at) === path),
            {
              from: caller,
              calledBy: calls.filter((call) => call.to === path).map((call) => labelOf(call.from)),
            },
          ),
        ),
        calls,
        ends: [...new Map(ends.map((end) => [`${end.from}\u0000${end.label}`, end])).values()],
      },
    ];
  };
  const alike = new Map<string, Walk[]>();
  for (const one of walked) {
    const sent = one.runs.flatMap((at) => definitions[at]?.requests.map((end) => end.symbol) ?? []);
    const key = [
      one.from === null,
      ...pathsOf(one.starts).sort(),
      "",
      ...pathsOf(one.runs).sort(),
      "",
      ...unique(sent).sort(),
    ].join("\u0000");
    alike.set(key, [...(alike.get(key) ?? []), one]);
  }
  const paths = [...alike.values()].flatMap(drawn);

  const unreached = inTreeOrder
    .filter((path) => !shared.has(path))
    .map((path) =>
      stop(
        path,
        all.filter((at) => pathAt(at) === path),
        { from: null, calledBy: [] },
      ),
    );

  const fileCalls = fileCallsOf(unique(walked.flatMap((one) => one.runs)), graph);
  return { paths, layers: layersOf(paths, fileCalls), calls: fileCalls, unreached, also };
};

/**
 * The stops' directories, each after the directories that call into it: its place is the longest
 * chain of calls that reaches it. A call that closes a cycle doesn't count, and directories at the
 * same place keep the order the paths first reach them in.
 */
const layersOf = (paths: readonly FlowPath[], calls: readonly FileCall[]): Layer[] => {
  const keys = unique(paths.flatMap((path) => path.stops.map((one) => one.layer)));
  const out = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const { from, to } of calls) {
    const [a, b] = [directoryOf(from), directoryOf(to)];
    if (a !== b && out.has(b) && !out.get(a)?.includes(b)) out.get(a)?.push(b);
  }
  // Depth first from the directories the paths start in: a call back into one being walked closes
  // a cycle. What's left has no cycle, so the longest chain to each directory is finite.
  const forward = new Map<string, string[]>(keys.map((key) => [key, []]));
  const state = new Map<string, "walking" | "done">();
  const walk = (key: string) => {
    state.set(key, "walking");
    for (const to of out.get(key) ?? []) {
      if (state.get(to) === "walking") continue;
      forward.get(key)?.push(to);
      if (!state.has(to)) walk(to);
    }
    state.set(key, "done");
  };
  for (const key of keys) if (!state.has(key)) walk(key);
  const callers = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const [from, tos] of forward) for (const to of tos) callers.get(to)?.push(from);
  const depth = new Map<string, number>();
  const depthOf = (key: string): number => {
    const known = depth.get(key);
    if (known !== undefined) return known;
    const at = Math.max(-1, ...(callers.get(key) ?? []).map(depthOf)) + 1;
    depth.set(key, at);
    return at;
  };
  const order = [...keys].sort(
    (a, b) => depthOf(a) - depthOf(b) || keys.indexOf(a) - keys.indexOf(b),
  );
  // As the tree shows a directory, without a Java module's repeat of its name.
  const shown = new Map(
    order.map((key) => [key, key === "" ? "." : directoryOf(treePath(`${key}/x`))]),
  );
  const labels = uniqueLabels([...shown.values()]);
  return order.map((key) => ({ key, label: labels.get(shown.get(key) ?? key) ?? key }));
};

/** Every changed file the view accounts for, to check none is left out. */
export const filesOf = ({ paths, unreached, also }: FlowPaths): string[] =>
  unique([
    ...paths.flatMap((path) => path.stops.map((one) => one.path)),
    ...unreached.map((one) => one.path),
    ...Object.values(also).flat(),
  ]);
