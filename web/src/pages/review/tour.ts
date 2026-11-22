import {
  type Hunk,
  type HunkId,
  isTestFile,
  type PartId,
  partsByHunk,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  hasModelRun,
  MIN_STOPS,
  type Point,
  type PointLines,
  type PointState,
  type StopId,
} from "../../../../src/domain/review/index.ts";
import { directoryOf } from "../../review/tree/paths.ts";
import { type FileOverview, groupKey, type OverviewNode } from "./overview.ts";

// The Understand layout's tour: everything it draws, from the analysis's stops, the overview's
// directories and Claude's points. The code counts the ledger from the diff; only the stops'
// sentences and lines are the model's.

/** One excerpt of a stop: the rows of its hunk from its first line to its last, both sides. */
export interface TourExcerpt {
  readonly key: string;
  readonly path: string;
  readonly hunkId: HunkId;
  /** The part holding its first row, under which a comment on it is kept. */
  readonly partId: PartId;
  readonly lines: PointLines;
  /** Its rows in the hunk, `end` past the last. */
  readonly start: number;
  readonly end: number;
  /** The added and removed lines it shows, and the file's. */
  readonly shown: number;
  readonly fileChanged: number;
}

export interface TourStop {
  readonly id: StopId;
  readonly number: number;
  readonly sentence: string;
  /** The directories it reaches, by the overview's node keys: one, or two across a process. */
  readonly boxes: readonly string[];
  readonly excerpts: readonly TourExcerpt[];
  /** Claude's points on its lines, findings, then risks, then decisions. */
  readonly points: readonly Point[];
}

export interface TourBox {
  readonly key: string;
  readonly label: string;
  /** The stops that reach it, by number; none for a box off the tour. */
  readonly stops: readonly number[];
}

export type LedgerGroupId = "stops" | "tests" | "generated" | "other";

export interface LedgerFile {
  readonly path: string;
  /** Its added and removed lines no stop shows. */
  readonly added: number;
  readonly deleted: number;
}

export interface LedgerGroup {
  readonly id: LedgerGroupId;
  readonly label: string;
  readonly files: readonly LedgerFile[];
}

export interface TourView {
  readonly stops: readonly TourStop[];
  /** The directories the stops reach, in the order they first reach them. */
  readonly boxes: readonly TourBox[];
  /** Two neighboring boxes one stop spans, by their keys. */
  readonly spans: readonly { readonly stop: number; readonly keys: readonly [string, string] }[];
  /** The other directories, each with the ledger group of its first file. */
  readonly others: readonly (TourBox & { readonly group: LedgerGroupId | null })[];
  /** What the tour didn't show, a group each, empty ones left out. */
  readonly ledger: readonly LedgerGroup[];
  /** Claude's findings and risks no stop shows. */
  readonly outside: readonly Point[];
  readonly depth: Depth;
  /** Changed lines: the stops' and the pull request's. */
  readonly shown: number;
  readonly total: number;
}

/**
 * Where to read in the code, by rule: the stops with an open finding or a risk no test checks,
 * and how many findings and risks are outside the stops.
 */
export interface Depth {
  readonly read: readonly number[];
  readonly findingsOutside: number;
  readonly risksOutside: number;
}

const LEDGER_LABELS: Readonly<Record<LedgerGroupId, string>> = {
  stops: "The rest of the stops' files",
  tests: "Tests",
  generated: "Generated and mechanical",
  other: "Other files",
};

const changed = (hunk: Hunk, start = 0, end = hunk.lines.length): number =>
  hunk.lines.slice(start, end).filter((line) => line.kind !== "context").length;

/** The rows of `hunk` from `lines`' first to its last, on its side; null when it shows neither. */
export const rowsOf = (
  hunk: Hunk,
  lines: Pick<PointLines, "side" | "startLine" | "line">,
): { readonly start: number; readonly end: number } | null => {
  const numberAt = (at: number) => {
    const row = hunk.lines[at];
    return lines.side === "new" ? row?.newLine : row?.oldLine;
  };
  const indices = hunk.lines.flatMap((_, at) => {
    const number = numberAt(at);
    return number != null && number >= lines.startLine && number <= lines.line ? [at] : [];
  });
  const first = indices[0];
  const last = indices.at(-1);
  return first === undefined || last === undefined ? null : { start: first, end: last + 1 };
};

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/** The tour as Understand draws it, or null when the analysis has none to show. */
export const tourOf = (
  analysis: Pick<Analysis, "files" | "stops" | "proofs" | "generated" | "parts">,
  overview: FileOverview,
  points: readonly Point[],
  stateOf: (point: Point) => PointState = () => "open",
): TourView | null => {
  if (analysis.stops === null || analysis.stops.length < MIN_STOPS) return null;
  const hunks = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
  );
  const fileOf = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file] as const)),
  );
  const byHunk = partsByHunk(analysis.parts);
  const nodes = new Map<string, OverviewNode>(
    [...overview.rows.flat(), ...overview.strip].map((node) => [node.key, node]),
  );
  const boxOf = (path: string) => overview.placeOf.get(path) ?? groupKey(directoryOf(path));
  const labelOf = (key: string) =>
    nodes.get(key)?.label ?? (key.startsWith("group:") ? key.slice("group:".length) : key);
  const shownRows = new Set<string>();

  const stops = analysis.stops.map((stop, at): TourStop => {
    const excerpts = stop.excerpts.flatMap((lines, n): TourExcerpt[] => {
      const hunk = hunks.get(lines.hunkId);
      const file = fileOf.get(lines.hunkId);
      const rows = hunk === undefined ? null : rowsOf(hunk, lines);
      if (hunk === undefined || file === undefined || rows === null) return [];
      for (let row = rows.start; row < rows.end; row += 1) {
        if (hunk.lines[row]?.kind !== "context") shownRows.add(`${hunk.id}:${row}`);
      }
      const part =
        byHunk.get(hunk.id)?.find((one) => rows.start >= one.start && rows.start < one.end)?.id ??
        hunk.id;
      return [
        {
          key: `${stop.id}:${n}`,
          path: file.path,
          hunkId: hunk.id,
          partId: part,
          lines,
          ...rows,
          shown: changed(hunk, rows.start, rows.end),
          fileChanged: file.hunks.reduce((sum, one) => sum + changed(one), 0),
        },
      ];
    });
    const onIt = points.filter((point) => {
      if (point.guidance?.effect === "left-out" || point.lines === null) return false;
      const { lines } = point;
      const hunk = hunks.get(lines.hunkId);
      const rows = hunk === undefined ? null : rowsOf(hunk, lines);
      return (
        rows !== null &&
        excerpts.some((excerpt) => excerpt.hunkId === lines.hunkId && overlaps(excerpt, rows))
      );
    });
    return {
      id: stop.id,
      number: at + 1,
      sentence: stop.sentence,
      boxes: [...new Set(excerpts.map((excerpt) => boxOf(excerpt.path)))],
      excerpts,
      points: (["finding", "risk", "decision"] as const).flatMap((kind) =>
        onIt.filter((point) => point.kind === kind),
      ),
    };
  });

  const order: string[] = [];
  for (const stop of stops) for (const key of stop.boxes) if (!order.includes(key)) order.push(key);
  const boxes = order.map((key) => ({
    key,
    label: labelOf(key),
    stops: stops.filter((stop) => stop.boxes.includes(key)).map((stop) => stop.number),
  }));
  const grouped = new Set<string>();
  const spans = stops.flatMap((stop) => {
    const [a, b] = stop.boxes;
    if (a === undefined || b === undefined || grouped.has(a) || grouped.has(b)) return [];
    const [first, second] = [a, b].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    if (first === undefined || second === undefined) return [];
    if (order.indexOf(second) - order.indexOf(first) !== 1) return [];
    grouped.add(first);
    grouped.add(second);
    return [{ stop: stop.number, keys: [first, second] as const }];
  });

  // The ledger: every changed line no stop shows, by file, in groups.
  const stopFiles = new Set(stops.flatMap((stop) => stop.excerpts.map((excerpt) => excerpt.path)));
  const mechanical = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const generated = new Set(analysis.generated);
  const groupOf = (path: string, hunksOf: readonly Hunk[]): LedgerGroupId => {
    if (stopFiles.has(path)) return "stops";
    if (isTestFile(path)) return "tests";
    if (
      generated.has(path) ||
      (hunksOf.length > 0 && hunksOf.every((hunk) => mechanical.has(hunk.id)))
    ) {
      return "generated";
    }
    return "other";
  };
  const notShown = (hunk: Hunk, kind: "add" | "del") =>
    hunk.lines.filter((line, row) => line.kind === kind && !shownRows.has(`${hunk.id}:${row}`))
      .length;
  const ledgerFiles = analysis.files.flatMap((file) => {
    const added = file.hunks.reduce((sum, hunk) => sum + notShown(hunk, "add"), 0);
    const deleted = file.hunks.reduce((sum, hunk) => sum + notShown(hunk, "del"), 0);
    const group = groupOf(file.path, file.hunks);
    // A stop's file is listed for what it didn't show; any other file always, a rename too.
    return group === "stops" && added + deleted === 0
      ? []
      : [{ group, file: { path: file.path, added, deleted } }];
  });
  const ledger = (["stops", "tests", "generated", "other"] as const).flatMap((id) => {
    const files = ledgerFiles.filter((one) => one.group === id).map((one) => one.file);
    return files.length === 0 ? [] : [{ id, label: LEDGER_LABELS[id], files }];
  });
  const groupOfPath = new Map(ledgerFiles.map((one) => [one.file.path, one.group]));

  const others = [...overview.rows.flat(), ...overview.strip]
    .filter((node) => node.kind === "group" && !order.includes(node.key))
    .map((node) => ({
      key: node.key,
      label: node.label,
      stops: [],
      group: node.paths.map((path) => groupOfPath.get(path)).find((id) => id !== undefined) ?? null,
    }));

  const chipped = new Set(stops.flatMap((stop) => stop.points.map((point) => point.id)));
  const outside = points.filter(
    (point) =>
      (point.kind === "finding" || point.kind === "risk") &&
      point.guidance?.effect !== "left-out" &&
      !chipped.has(point.id),
  );
  const open = (point: Point) => stateOf(point) !== "dismissed";
  const read = stops
    .filter((stop) =>
      stop.points.some(
        (point) =>
          open(point) &&
          (point.kind === "finding" || (point.kind === "risk" && point.checkedBy === undefined)),
      ),
    )
    .map((stop) => stop.number);
  const total = analysis.files.reduce(
    (sum, file) => sum + file.hunks.reduce((lines, hunk) => lines + changed(hunk), 0),
    0,
  );
  return {
    stops,
    boxes,
    spans,
    others,
    ledger,
    outside,
    depth: {
      read,
      findingsOutside: outside.filter((point) => point.kind === "finding" && open(point)).length,
      risksOutside: outside.filter((point) => point.kind === "risk" && open(point)).length,
    },
    shown: shownRows.size,
    total,
  };
};

/** Why Understand has no tour to show, for the line under the bar; null when it has one. */
export type NoTour =
  | { readonly kind: "no-review" }
  | { readonly kind: "without-tour" }
  | { readonly kind: "writing" }
  | { readonly kind: "too-small" }
  | { readonly kind: "failed"; readonly message: string };

export const noTourOf = (
  analysis: Pick<Analysis, "stages" | "stops" | "stopsError" | "usage" | "modelError" | "status">,
): NoTour | null => {
  const stage = analysis.stages.stops;
  if (stage === "running" || stage === "pending") return { kind: "writing" };
  if (stage === "failed") {
    return { kind: "failed", message: analysis.stopsError?.message ?? "The tour pass failed" };
  }
  if (stage === "done") {
    return (analysis.stops ?? []).length < MIN_STOPS ? { kind: "too-small" } : null;
  }
  return hasModelRun(analysis) ? { kind: "without-tour" } : { kind: "no-review" };
};
