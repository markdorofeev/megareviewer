import type {
  FileChange,
  Hunk,
  HunkId,
  MechanicalProof,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type DecisionId,
  type RiskAssessment,
  type TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import type { HunkItem } from "../../diff/index.ts";

/** What the main area shows. */
export type MainView =
  | { readonly kind: "step"; readonly stepId: TourStepId }
  | { readonly kind: "mechanical" }
  /** Before the tour exists: every hunk in path order, so reading can start early. */
  | { readonly kind: "files" };

/** A decision or a mismatch shown on its own, on top of the tour. */
export type Focus =
  | { readonly kind: "decision"; readonly decisionId: DecisionId }
  | { readonly kind: "mismatch"; readonly index: number };

/** The tour's entries in the sidebar, in order: its steps, then the mechanical changes. */
export type TourEntry = MainView & { readonly kind: "step" | "mechanical" };

const byPath = (a: FileChange, b: FileChange): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const UNCLASSIFIED = "Not classified yet.";

/**
 * Hunks and their files by ID, with each hunk's risk. A hunk without an assessment yet (the risk
 * pass hasn't run) reads as logic: shown in full, never collapsed.
 */
export const hunkIndex = (analysis: Analysis) => {
  const hunks = new Map<HunkId, { readonly hunk: Hunk; readonly file: FileChange }>();
  for (const file of analysis.files)
    for (const hunk of file.hunks) hunks.set(hunk.id, { hunk, file });
  const risk = new Map(analysis.risk.map((assessment) => [assessment.hunkId, assessment]));
  const proofs = new Map<HunkId, MechanicalProof[]>();
  for (const proof of analysis.proofs) {
    if (proof.hunkId !== null)
      proofs.set(proof.hunkId, [...(proofs.get(proof.hunkId) ?? []), proof]);
  }
  const mechanical = new Set(proofs.keys());
  const riskOf = (hunkId: HunkId): RiskAssessment =>
    risk.get(hunkId) ?? { hunkId, riskClass: "logic", reason: UNCLASSIFIED, source: "fallback" };
  const items = (ids: readonly HunkId[]): HunkItem[] =>
    ids.flatMap((id) => {
      const found = hunks.get(id);
      return found === undefined
        ? []
        : [{ ...found, risk: riskOf(id), proofs: proofs.get(id) ?? [] }];
    });
  return { hunks, mechanical, items };
};

export type HunkIndex = ReturnType<typeof hunkIndex>;

/** Non-mechanical hunks in path order, then file order: the reading order before a tour exists. */
export const hunksInPathOrder = (analysis: Analysis, index: HunkIndex): HunkId[] =>
  [...analysis.files]
    .sort(byPath)
    .flatMap((file) => file.hunks.map((hunk) => hunk.id))
    .filter((id) => !index.mechanical.has(id));

/**
 * The tour's steps, plus a step for non-mechanical hunks the tour misses. The server checks the
 * tour covers each one, but a hunk left out of every step would be invisible, so show it anyway.
 */
export const tourSteps = (analysis: Analysis, index: HunkIndex): readonly TourStep[] => {
  const steps = analysis.tour?.steps ?? [];
  const covered = new Set(steps.flatMap((step) => step.hunkIds));
  const missed = hunksInPathOrder(analysis, index).filter((id) => !covered.has(id));
  if (missed.length === 0) return steps;
  return [
    ...steps,
    {
      id: TourStepId.parse(`s${steps.length + 1}`),
      title: "Changes the tour left out",
      explanation: "The tour didn't include these changes, so they're shown here in file order.",
      hunkIds: missed,
    },
  ];
};

/** Every hunk in tour order, then the rest in file order: the order a decision's hunks show in. */
export const readingOrder = (
  analysis: Analysis,
  steps: readonly TourStep[],
): ReadonlyMap<HunkId, number> => {
  const ids = new Set([
    ...steps.flatMap((step) => step.hunkIds),
    ...analysis.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)),
  ]);
  return new Map([...ids].map((id, rank) => [id, rank]));
};

export const inReadingOrder = (
  ids: readonly HunkId[],
  order: ReadonlyMap<HunkId, number>,
): HunkId[] =>
  [...new Set(ids)].sort(
    (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
  );

/** One row per mechanical hunk, plus one per file-level proof, as the mechanical group shows. */
export const mechanicalCount = (proofs: readonly MechanicalProof[]): number => {
  const hunks = new Set<HunkId>();
  let fileLevel = 0;
  for (const proof of proofs) {
    if (proof.hunkId === null) fileLevel += 1;
    else hunks.add(proof.hunkId);
  }
  return hunks.size + fileLevel;
};

export const entryKey = (entry: MainView): string =>
  entry.kind === "step" ? entry.stepId : entry.kind;

export const sameView = (a: MainView, b: MainView): boolean => entryKey(a) === entryKey(b);

/**
 * A step's hunks with the mechanical hunks of its files put back in place, so a whitespace fix
 * next to a logic change reads in context. Each mechanical hunk goes right before the step's
 * next hunk from its file, or after the last one when it comes later in the file.
 */
export const withMechanicalInPlace = (ids: readonly HunkId[], index: HunkIndex): HunkId[] => {
  const result: HunkId[] = [];
  const placed = new Set<HunkId>(ids);
  const fileOf = (id: HunkId) => index.hunks.get(id)?.file;
  const mechanicalBefore = (file: FileChange, id: HunkId | null): HunkId[] => {
    const at = id === null ? file.hunks.length : file.hunks.findIndex((hunk) => hunk.id === id);
    return file.hunks
      .slice(0, at)
      .map((hunk) => hunk.id)
      .filter((hunkId) => index.mechanical.has(hunkId) && !placed.has(hunkId));
  };
  const lastOfFile = new Map<FileChange, number>();
  for (const id of ids) {
    const file = fileOf(id);
    if (file !== undefined) {
      const before = mechanicalBefore(file, id);
      for (const hunkId of before) placed.add(hunkId);
      result.push(...before);
    }
    result.push(id);
    if (file !== undefined) lastOfFile.set(file, result.length);
  }
  // Trailing mechanical hunks, inserted from the end so earlier positions don't move.
  for (const [file, position] of [...lastOfFile].sort((a, b) => b[1] - a[1])) {
    const after = mechanicalBefore(file, null);
    for (const hunkId of after) placed.add(hunkId);
    result.splice(position, 0, ...after);
  }
  return result;
};

/** Changed lines by risk class, for a step's bar in the sidebar. */
export type RiskMix = Readonly<Record<RiskAssessment["riskClass"], number>>;

const changedLines = (hunk: Hunk): number =>
  hunk.lines.filter((line) => line.kind !== "context").length;

export const riskMix = (ids: readonly HunkId[], index: HunkIndex): RiskMix => {
  const mix = { contract: 0, logic: 0, mechanical: 0 };
  for (const item of index.items(ids)) {
    const riskClass = index.mechanical.has(item.hunk.id) ? "mechanical" : item.risk.riskClass;
    mix[riskClass] += changedLines(item.hunk);
  }
  return mix;
};

/** Hunks by risk class across the pull request: the totals above the tour. */
export const riskTotals = (analysis: Analysis, index: HunkIndex): RiskMix => {
  const totals = { contract: 0, logic: 0, mechanical: 0 };
  for (const item of index.items([...index.hunks.keys()])) {
    totals[index.mechanical.has(item.hunk.id) ? "mechanical" : item.risk.riskClass] += 1;
  }
  totals.mechanical += analysis.proofs.filter((proof) => proof.hunkId === null).length;
  return totals;
};

/**
 * Proofs the last tour entry shows: file-level ones, and those in files with nothing else to
 * review. A mechanical hunk in a file with other changes shows in place in that file's step.
 */
export const trailingProofs = (analysis: Analysis, index: HunkIndex): MechanicalProof[] => {
  const reviewed = new Set(
    [...index.hunks].flatMap(([id, { file }]) => (index.mechanical.has(id) ? [] : [file.path])),
  );
  return analysis.proofs.filter((proof) => proof.hunkId === null || !reviewed.has(proof.path));
};
