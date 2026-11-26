import { type FileChange, hunkIdOf, isTestFile } from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  dataFlowContext,
  hasModelRun,
  validateDataFlow,
} from "../../../../src/domain/review/index.ts";
import { byTreePath, directoryOf, nameOf } from "../../review/tree/paths.ts";

// The Overview as the change's data flow: the model's stations, with what the code knows of their
// files, and a count of everything the flow leaves out. It imports only domain code.

export interface Lines {
  readonly added: number;
  readonly deleted: number;
}

/** A changed file on the flow. */
export interface FlowFile extends Lines {
  readonly path: string;
  /** Its name without its extension. */
  readonly name: string;
  /** A file the pull request adds is new; any other is existing code it edits. */
  readonly status: "new" | "changed";
  /** For existing code: the definitions it calls in the flow's other files. */
  readonly calls: readonly string[];
  /** For existing code: its definitions the flow's other files call. */
  readonly calledFor: readonly string[];
}

/** Files of one directory whose names end alike, shown as one: "4 × …InstrumentationPhase". */
export interface FileFamily extends Lines {
  readonly key: string;
  /** What the names end with; null for a file alone. */
  readonly suffix: string | null;
  readonly files: readonly FlowFile[];
}

export interface FlowStation extends Lines {
  readonly name: string;
  readonly when: string | null;
  readonly keeps: boolean;
  readonly families: readonly FileFamily[];
  /** What it hands the next station, or leaves where the data ends up. */
  readonly gives: string | null;
  /** The files that only define what it hands on. */
  readonly shapes: readonly FileFamily[];
  /** The code joins it to the next station; true for the last. */
  readonly joined: boolean;
}

export type OffFlowId = "code" | "tests" | "docs" | "generated" | "other";

/** Changed files the flow leaves out, by kind. */
export interface OffFlow extends Lines {
  readonly id: OffFlowId;
  readonly label: string;
  readonly files: readonly (Lines & { readonly path: string })[];
}

export interface DataFlowView {
  readonly source: string | null;
  readonly stations: readonly FlowStation[];
  readonly end: string | null;
  readonly off: readonly OffFlow[];
  /** The changed lines of the files on the flow, and of the pull request. */
  readonly shown: Lines;
  readonly total: Lines;
}

export type DataFlowInput = Pick<
  Analysis,
  "dataFlow" | "files" | "proofs" | "generated" | "callGraph" | "definitionCalls" | "fileLinks"
>;

const OFF_LABELS: Readonly<Record<OffFlowId, string>> = {
  code: "Other changed code",
  tests: "Tests",
  docs: "Docs",
  generated: "Generated and mechanical",
  other: "Other files",
};

/** Fewer files than this ending alike stay apart. */
const MIN_FAMILY = 3;

const isDoc = (path: string): boolean => /\.(md|mdx|rst|adoc|txt)$/i.test(path);
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const withoutExtension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const linesOf = (file: FileChange): Lines => ({
  added: file.hunks.reduce(
    (sum, hunk) => sum + hunk.lines.filter((l) => l.kind === "add").length,
    0,
  ),
  deleted: file.hunks.reduce(
    (sum, hunk) => sum + hunk.lines.filter((l) => l.kind === "del").length,
    0,
  ),
});

const sum = (all: readonly Lines[]): Lines => ({
  added: all.reduce((total, one) => total + one.added, 0),
  deleted: all.reduce((total, one) => total + one.deleted, 0),
});

/** A name's words: `BranchProfileKey` and `branch_profile_key` are three each. */
const wordsOf = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter((word) => word !== "");

/** The end of a name from its `count`th word from the end, as written. */
const endOf = (name: string, count: number): string => {
  const words = wordsOf(name);
  const tail = words.slice(-count).join("");
  const loose = name.replace(/[\s_\-.]/g, "");
  return loose.endsWith(tail) ? name.slice(name.length - endLength(name, tail)) : tail;
};
/** How much of `name`'s end spells `tail`, separators counted. */
const endLength = (name: string, tail: string): number => {
  let left = tail.length;
  let at = name.length;
  while (left > 0 && at > 0) {
    at -= 1;
    if (!/[\s_\-.]/.test(name.charAt(at))) left -= 1;
  }
  return name.length - at;
};

/**
 * The files as families: those of one directory whose names end with the same words are one, the
 * longest ending first, when at least three share it and it isn't a whole name. The rest are alone.
 * Families come in the order of their first file.
 */
export const familiesOf = (files: readonly FlowFile[]): FileFamily[] => {
  const family = new Map<string, string>();
  const longest = Math.max(0, ...files.map((file) => wordsOf(file.name).length - 1));
  for (let count = longest; count >= 1; count -= 1) {
    const ends = new Map<string, FlowFile[]>();
    for (const file of files) {
      if (family.has(file.path) || wordsOf(file.name).length <= count) continue;
      const key = `${directoryOf(file.path)}\u0000${wordsOf(file.name).slice(-count).join(" ").toLowerCase()}`;
      ends.set(key, [...(ends.get(key) ?? []), file]);
    }
    for (const [key, members] of ends) {
      if (members.length >= MIN_FAMILY) for (const file of members) family.set(file.path, key);
    }
  }
  const groups = new Map<string, FlowFile[]>();
  for (const file of files) {
    const key = family.get(file.path) ?? file.path;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  return [...groups].map(([key, members]) => {
    const [first] = members;
    const words = key.includes("\u0000") ? (key.split("\u0000")[1]?.split(" ").length ?? 0) : 0;
    return {
      key,
      suffix: first === undefined || words === 0 ? null : endOf(first.name, words),
      files: members,
      ...sum(members),
    };
  });
};

/**
 * What the Overview draws of the analysis's data flow, or null without one. A file's lines are
 * counted where it is: on a station, on what a station hands on, or in what the flow leaves out,
 * which together are the pull request's.
 */
export const dataFlowOf = (analysis: DataFlowInput): DataFlowView | null => {
  const flow = analysis.dataFlow;
  if (flow === null) return null;
  const byPath = new Map(analysis.files.map((file) => [file.path, file]));
  const onFlow = new Set(flow.stations.flatMap((station) => [...station.files, ...station.shapes]));

  const pathOfHunk = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path] as const)),
  );
  const definitions = analysis.definitionCalls.map((definition) => {
    const [first] = definition.partIds;
    return {
      name: definition.name,
      path: first === undefined ? undefined : pathOfHunk.get(hunkIdOf(first)),
      calls: definition.calls,
    };
  });
  const calls = new Map<string, string[]>();
  const calledFor = new Map<string, string[]>();
  const note = (into: Map<string, string[]>, path: string, name: string) =>
    into.set(path, [...(into.get(path) ?? []), name]);
  for (const from of definitions) {
    for (const at of from.calls) {
      const to = definitions[at];
      if (to === undefined || from.path === undefined || to.path === undefined) continue;
      if (from.path === to.path || !onFlow.has(from.path) || !onFlow.has(to.path)) continue;
      if (to.name === "") continue;
      note(calls, from.path, to.name);
      note(calledFor, to.path, to.name);
    }
  }

  const fileOf = (path: string): FlowFile[] => {
    const file = byPath.get(path);
    if (file === undefined) return [];
    const existing = file.status !== "added";
    return [
      {
        path,
        name: withoutExtension(nameOf(path)),
        status: existing ? "changed" : "new",
        calls: existing ? unique(calls.get(path) ?? []) : [],
        calledFor: existing ? unique(calledFor.get(path) ?? []) : [],
        ...linesOf(file),
      },
    ];
  };

  const unlinked = new Set(
    validateDataFlow(flow, dataFlowContext(analysis)).flatMap((problem) =>
      problem.kind === "unlinked" ? [problem.station] : [],
    ),
  );
  const stations = flow.stations.map((station, index): FlowStation => {
    const files = station.files.flatMap(fileOf);
    return {
      name: station.name,
      when: station.when,
      keeps: station.keeps,
      families: familiesOf(files),
      gives: station.gives,
      shapes: familiesOf(station.shapes.flatMap(fileOf)),
      joined: !unlinked.has(index),
      ...sum(files),
    };
  });

  const mechanical = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const generated = new Set(analysis.generated);
  const kindOf = (file: FileChange): OffFlowId => {
    // A file without a hunk, a rename or a binary one, has nothing to read either.
    if (generated.has(file.path) || file.hunks.every((hunk) => mechanical.has(hunk.id))) {
      return "generated";
    }
    if (isTestFile(file.path)) return "tests";
    if (isDoc(file.path)) return "docs";
    return file.language === null ? "other" : "code";
  };
  const left = analysis.files
    .filter((file) => !onFlow.has(file.path))
    .sort((a, b) => byTreePath(a.path, b.path));
  const off = (["code", "tests", "docs", "generated", "other"] as const).flatMap((id) => {
    const files = left
      .filter((file) => kindOf(file) === id)
      .map((file) => ({ path: file.path, ...linesOf(file) }));
    return files.length === 0 ? [] : [{ id, label: OFF_LABELS[id], files, ...sum(files) }];
  });

  const total = sum(analysis.files.map(linesOf));
  const outside = sum(off);
  return {
    source: flow.source,
    stations,
    end: flow.end,
    off,
    shown: { added: total.added - outside.added, deleted: total.deleted - outside.deleted },
    total,
  };
};

/** Why the Overview has no data flow to draw; null when it has one. */
export type NoDataFlow =
  | { readonly kind: "no-review" }
  | { readonly kind: "not-asked" }
  | { readonly kind: "writing" }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly message: string };

export const noDataFlowOf = (
  analysis: Pick<
    Analysis,
    "stages" | "dataFlow" | "stepsError" | "usage" | "modelError" | "status"
  >,
): NoDataFlow | null => {
  if (analysis.dataFlow !== null) return null;
  const stage = analysis.stages.steps;
  if (stage === "running" || stage === "pending") return { kind: "writing" };
  if (stage === "failed") {
    return { kind: "failed", message: analysis.stepsError?.message ?? "The pass failed" };
  }
  if (stage === "done") return { kind: "none" };
  return hasModelRun(analysis) ? { kind: "not-asked" } : { kind: "no-review" };
};

export const noDataFlowText = (reason: NoDataFlow): string => {
  switch (reason.kind) {
    case "no-review":
      return "How data moves through this change is written by an AI review. Until one has run, this is the changed directories and the calls between them.";
    case "not-asked":
      return "This AI review didn't write a data flow. Re-run it to get one. Until then, this is the changed directories and the calls between them.";
    case "writing":
      return "How data moves through this change is being written.";
    case "none":
      return "The AI review found no path that data moves along in this change, so this is its directories.";
    case "failed":
      return `The data flow couldn't be written: ${reason.message}`;
  }
};
