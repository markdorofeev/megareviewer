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
  MIN_STEPS,
  type Point,
  type PointLines,
  type StepId,
} from "../../../../src/domain/review/index.ts";
import { directoryOf } from "../../review/tree/paths.ts";
import { type FileOverview, groupKey, type OverviewNode } from "./overview.ts";

// The Understand layout's tour: everything it draws, from the analysis's steps, the overview's
// directories and Claude's points. The code counts the ledger from the diff; only the steps'
// sentences and lines are the model's.

/** One excerpt of a step: the rows of its hunk from its first line to its last, both sides. */
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
}

export interface TourStep {
  readonly id: StepId;
  readonly number: number;
  readonly sentence: string;
  /** The directories its lines are in, by the overview's node keys: one or two. */
  readonly boxes: readonly string[];
  readonly excerpts: readonly TourExcerpt[];
  /** Claude's points on its lines. */
  readonly points: readonly Point[];
}

export interface TourBox {
  /** The directory, by the overview's node key: one box each. */
  readonly key: string;
  readonly label: string;
  /** The steps with lines in it, by number. */
  readonly steps: readonly number[];
}

export type LedgerGroupId = "steps" | "tests" | "generated" | "other";

export interface LedgerFile {
  readonly path: string;
  /** Its added and removed lines no step shows. */
  readonly added: number;
  readonly deleted: number;
}

export interface LedgerGroup {
  readonly id: LedgerGroupId;
  readonly label: string;
  readonly files: readonly LedgerFile[];
}

export interface TourView {
  readonly steps: readonly TourStep[];
  /**
   * The strip: the directories the steps' lines are in, each once, in the order the steps first
   * reach them. The steps go by what matters most, so the strip says where they are, not a path.
   */
  readonly boxes: readonly TourBox[];
  /** What the tour didn't show, a group each, empty ones left out. */
  readonly ledger: readonly LedgerGroup[];
  /** Claude's findings no step shows. */
  readonly outside: readonly Point[];
  /** Changed lines: the steps' and the pull request's. */
  readonly shown: number;
  readonly total: number;
}

const LEDGER_LABELS: Readonly<Record<LedgerGroupId, string>> = {
  steps: "The rest of the steps' files",
  tests: "Tests",
  generated: "Generated and mechanical",
  other: "Other files",
};

const changed = (hunk: Hunk): number => hunk.lines.filter((line) => line.kind !== "context").length;

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
  analysis: Pick<Analysis, "files" | "steps" | "proofs" | "generated" | "parts">,
  overview: FileOverview,
  points: readonly Point[],
): TourView | null => {
  if (analysis.steps === null || analysis.steps.length < MIN_STEPS) return null;
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

  const steps = analysis.steps.map((step, at): TourStep => {
    const excerpts = step.excerpts.flatMap((lines, n): TourExcerpt[] => {
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
          key: `${step.id}:${n}`,
          path: file.path,
          hunkId: hunk.id,
          partId: part,
          lines,
          ...rows,
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
      id: step.id,
      number: at + 1,
      sentence: step.sentence,
      boxes: [...new Set(excerpts.map((excerpt) => boxOf(excerpt.path)))],
      excerpts,
      points: onIt,
    };
  });

  const stepsIn = new Map<string, number[]>();
  for (const step of steps) {
    for (const directory of step.boxes) {
      stepsIn.set(directory, [...(stepsIn.get(directory) ?? []), step.number]);
    }
  }
  const boxes = [...stepsIn].map(
    ([key, numbers]): TourBox => ({ key, label: labelOf(key), steps: numbers }),
  );

  // The ledger: every changed line no step shows, by file, in groups.
  const stepFiles = new Set(steps.flatMap((step) => step.excerpts.map((excerpt) => excerpt.path)));
  const mechanical = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const generated = new Set(analysis.generated);
  const groupOf = (path: string, hunksOf: readonly Hunk[]): LedgerGroupId => {
    if (stepFiles.has(path)) return "steps";
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
    // A step's file is listed for what it didn't show; any other file always, a rename too.
    return group === "steps" && added + deleted === 0
      ? []
      : [{ group, file: { path: file.path, added, deleted } }];
  });
  const ledger = (["steps", "tests", "generated", "other"] as const).flatMap((id) => {
    const files = ledgerFiles.filter((one) => one.group === id).map((one) => one.file);
    return files.length === 0 ? [] : [{ id, label: LEDGER_LABELS[id], files }];
  });

  const chipped = new Set(steps.flatMap((step) => step.points.map((point) => point.id)));
  const outside = points.filter(
    (point) => point.guidance?.effect !== "left-out" && !chipped.has(point.id),
  );
  const total = analysis.files.reduce(
    (sum, file) => sum + file.hunks.reduce((lines, hunk) => lines + changed(hunk), 0),
    0,
  );
  return {
    steps,
    boxes,
    ledger,
    outside,
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
  analysis: Pick<Analysis, "stages" | "steps" | "stepsError" | "usage" | "modelError" | "status">,
): NoTour | null => {
  const stage = analysis.stages.steps;
  if (stage === "running" || stage === "pending") return { kind: "writing" };
  if (stage === "failed") {
    return { kind: "failed", message: analysis.stepsError?.message ?? "The tour pass failed" };
  }
  if (stage === "done") {
    return (analysis.steps ?? []).length < MIN_STEPS ? { kind: "too-small" } : null;
  }
  return hasModelRun(analysis) ? { kind: "without-tour" } : { kind: "no-review" };
};

/** "1, 2 and 3". */
export const listOf = (numbers: readonly number[]): string =>
  numbers.length < 2
    ? numbers.join("")
    : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
