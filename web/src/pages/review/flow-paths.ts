import {
  hunkIdOf,
  isTestFile,
  type PartId,
  partsByHunk,
  piecesOf,
} from "../../../../src/domain/diff/index.ts";
import type { Analysis } from "../../../../src/domain/review/index.ts";
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
}

/** A request a path sends to a route the pull request adds: where the path leaves its process. */
export interface PathEnd {
  /** The route's method and path. */
  readonly label: string;
  readonly partId: PartId;
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
  /** The changed files it runs, in the order it reaches them. */
  readonly stops: readonly Stop[];
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
  /** A call from one changed file into another, on some path. */
  readonly calls: readonly { readonly from: string; readonly to: string }[];
  /** Changed code no path runs. */
  readonly unreached: readonly Stop[];
  readonly also: AlsoChanged;
}

export type FlowPathsInput = Pick<
  Analysis,
  "files" | "parts" | "proofs" | "callGraph" | "generated" | "flows"
> &
  Partial<Pick<Analysis, "unchangedCallers">>;

const isDoc = (path: string): boolean => /\.(md|mdx|rst|adoc|txt)$/i.test(path);
const withoutExtension = (label: string): string => {
  const slash = label.lastIndexOf("/");
  const dot = label.lastIndexOf(".");
  return dot > slash + 1 ? label.slice(0, dot) : label;
};
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/**
 * The pull request as flow paths. A path starts where a flow of the code does, at its entry points
 * or at the definition nothing in the pull request calls, and runs every changed file its calls
 * reach, so code several flows run is a stop on each. A file outside the pull request that uses a
 * changed definition starts a path of its own. Paths that run the same files and send the same
 * requests are one path with each one's label. Tests, docs, generated and mechanical files are
 * listed apart, and code no path runs is `unreached`: every changed file is in exactly one of them
 * or on a path.
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
  const definitions = new Map(analysis.parts.map((part) => [part.id, part.definitions]));
  const fileOf = new Map(
    code.flatMap((file) =>
      piecesOf(file, byHunk)
        .filter((piece) => !mechanical.has(hunkIdOf(piece.id)))
        .map((piece) => [piece.id, file] as const),
    ),
  );
  const labels = uniqueLabels(code.map((file) => file.path));

  // Calls in the order they're made, and requests to the pull request's routes.
  const callees = new Map<PartId, PartId[]>();
  const requests = new Map<PartId, PathEnd[]>();
  for (const hint of [...analysis.callGraph].sort((a, b) => a.line - b.line)) {
    const { fromPartId: from, toPartId: to } = hint;
    if (from === to || !fileOf.has(from) || !fileOf.has(to)) continue;
    if (hint.use === "request") {
      requests.set(from, [...(requests.get(from) ?? []), { label: hint.symbol, partId: to }]);
    } else if (hint.use === "call" && !callees.get(from)?.includes(to)) {
      callees.set(from, [...(callees.get(from) ?? []), to]);
    }
  }
  const reach = (starts: readonly PartId[]): PartId[] => {
    const seen = new Set<PartId>();
    const visit = (id: PartId) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const callee of callees.get(id) ?? []) visit(callee);
    };
    for (const start of starts) visit(start);
    return [...seen];
  };

  interface Walked {
    readonly key: string;
    readonly label: string;
    readonly from: string | null;
    readonly partIds: readonly PartId[];
  }
  const walked: Walked[] = [];
  for (const [at, flow] of (analysis.flows ?? []).entries()) {
    // A shared section is code its flows run: it's a stop on their paths, not a path.
    if (flow.kind !== "flow" || flow.title.startsWith("Shared:")) continue;
    // Its entries first, then what the flow reads, each followed by the code its calls reach.
    const starts = unique([...flow.entries, ...flow.partIds]).filter((id) => fileOf.has(id));
    if (starts.length === 0) continue;
    walked.push({ key: `flow:${at}`, label: flow.title, from: null, partIds: reach(starts) });
  }
  const outside = new Map<string, PartId[]>();
  for (const { partId, uses } of analysis.unchangedCallers ?? []) {
    if (!fileOf.has(partId)) continue;
    for (const use of uses) {
      if (isTestFile(use.path)) continue;
      outside.set(use.path, unique([...(outside.get(use.path) ?? []), partId]));
    }
  }
  const outsideLabels = uniqueLabels([...outside.keys()]);
  for (const [path, starts] of [...outside].sort(([a], [b]) => byTreePath(a, b))) {
    walked.push({
      key: `outside:${path}`,
      label: outsideLabels.get(path) ?? path,
      from: path,
      partIds: reach(starts),
    });
  }

  const pathsOf = (ids: readonly PartId[]) =>
    unique(ids.flatMap((id) => fileOf.get(id)?.path ?? []));
  // How many flows and outside files run each file, before the ones alike become one path.
  const shared = new Map<string, number>();
  for (const one of walked) {
    for (const path of pathsOf(one.partIds)) shared.set(path, (shared.get(path) ?? 0) + 1);
  }
  const stop = (path: string, partIds: readonly PartId[]): Stop => ({
    path,
    label: withoutExtension(labels.get(path) ?? path),
    layer: directoryOf(path),
    status: code.find((file) => file.path === path)?.status === "added" ? "new" : "changed",
    names: unique(partIds.flatMap((id) => definitions.get(id) ?? [])),
    partIds,
    shared: shared.get(path) ?? 0,
  });
  const merged = new Map<string, FlowPath>();
  for (const one of walked) {
    const stops = pathsOf(one.partIds).map((path) =>
      stop(
        path,
        one.partIds.filter((id) => fileOf.get(id)?.path === path),
      ),
    );
    const ends = [
      ...new Map(
        one.partIds.flatMap((id) => requests.get(id) ?? []).map((end) => [end.label, end]),
      ).values(),
    ];
    const same = [
      one.from === null,
      ...stops.map((each) => each.path).sort(),
      "",
      ...ends.map((end) => end.label).sort(),
    ].join("\u0000");
    const known = merged.get(same);
    merged.set(same, {
      key: known?.key ?? one.key,
      labels: [...(known?.labels ?? []), one.label],
      inPullRequest: one.from === null,
      outside: [...(known?.outside ?? []), ...(one.from === null ? [] : [one.from])],
      stops: known?.stops ?? stops,
      ends: known?.ends ?? ends,
    });
  }
  const paths = [...merged.values()];

  const reached = new Set(walked.flatMap((one) => one.partIds));
  const calls = new Map<string, { from: string; to: string }>();
  for (const from of reached) {
    for (const to of callees.get(from) ?? []) {
      const [a, b] = [fileOf.get(from)?.path, fileOf.get(to)?.path];
      if (a !== undefined && b !== undefined && a !== b)
        calls.set(`${a}\u0000${b}`, { from: a, to: b });
    }
  }
  const unreached = code
    .filter((file) => !shared.has(file.path))
    .sort((a, b) => byTreePath(a.path, b.path))
    .map((file) =>
      stop(
        file.path,
        piecesOf(file, byHunk)
          .map((piece) => piece.id)
          .filter((id) => fileOf.has(id)),
      ),
    );

  const fileCalls = [...calls.values()];
  return { paths, layers: layersOf(paths, fileCalls), calls: fileCalls, unreached, also };
};

/**
 * The stops' directories, each after the directories that call into it: its place is the longest
 * chain of calls that reaches it. A call that closes a cycle doesn't count, and directories at the
 * same place keep the order the paths first reach them in.
 */
const layersOf = (
  paths: readonly FlowPath[],
  calls: readonly { readonly from: string; readonly to: string }[],
): Layer[] => {
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
