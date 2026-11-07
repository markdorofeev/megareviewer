import type {
  CallGraphHint,
  FileChange,
  Hunk,
  HunkId,
  MechanicalProof,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type Decision,
  type DecisionId,
  isTestFile,
  type RiskAssessment,
  type TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import type { CallerFile, HunkItem } from "../../diff/index.ts";
import type { Call } from "./chips.ts";

export type { Call } from "./chips.ts";

/** The page's two layouts: one scroll beside a risk map, or an overview of the changed files. */
export type Layout = "map" | "overview";

/** The call tree the overview replaced is stored as `tree`, and opens the overview. */
export const parseLayout = (stored: unknown): Layout | undefined =>
  stored === "map" ? "map" : stored === "overview" || stored === "tree" ? "overview" : undefined;

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
      kind: "supporting",
      via: [],
      entries: [],
    },
  ];
};

/**
 * A part of the map's one scroll: a tour step with the mechanical hunks of its files in place,
 * or, before the tour exists, every change in path order.
 */
export type MapSection =
  | {
      readonly kind: "step";
      readonly step: TourStep;
      readonly number: number;
      readonly hunkIds: readonly HunkId[];
    }
  | { readonly kind: "files"; readonly hunkIds: readonly HunkId[] };

export const mapSections = (
  analysis: Analysis,
  steps: readonly TourStep[],
  index: HunkIndex,
): readonly MapSection[] =>
  analysis.tour === null
    ? [
        {
          kind: "files",
          hunkIds: withMechanicalInPlace(hunksInPathOrder(analysis, index), index),
        },
      ]
    : steps.map((step, at) => ({
        kind: "step",
        step,
        number: at + 1,
        hunkIds: withMechanicalInPlace(step.hunkIds, index),
      }));

export const sectionKey = (section: MapSection): string =>
  section.kind === "step" ? section.step.id : "files";

/** Where the decisions show: each as a card on one hunk, linked from its other hunks. */
export interface DecisionPlaces {
  /** The decisions whose card sits on this hunk. */
  readonly cards: ReadonlyMap<HunkId, readonly Decision[]>;
  /** The decisions resting on this hunk whose card sits on another. */
  readonly mentions: ReadonlyMap<HunkId, readonly Decision[]>;
  readonly cardHunk: ReadonlyMap<DecisionId, HunkId>;
  /** Decisions resting on no hunk the page can show a card on. They show before the code. */
  readonly unplaced: readonly Decision[];
}

/**
 * A decision's card goes under the header of the first hunk it rests on in `order`, the page's
 * order. Mechanical hunks show collapsed, so they never hold a card.
 */
export const decisionPlaces = (
  decisions: readonly Decision[],
  order: readonly HunkId[],
  index: HunkIndex,
): DecisionPlaces => {
  const rank = new Map(order.map((id, at) => [id, at]));
  const cards = new Map<HunkId, Decision[]>();
  const mentions = new Map<HunkId, Decision[]>();
  const cardHunk = new Map<DecisionId, HunkId>();
  const unplaced: Decision[] = [];
  const add = (map: Map<HunkId, Decision[]>, id: HunkId, decision: Decision) =>
    map.set(id, [...(map.get(id) ?? []), decision]);
  for (const decision of decisions) {
    const [first, ...rest] = [...new Set(decision.hunkIds)]
      .filter((id) => rank.has(id) && !index.mechanical.has(id))
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    if (first === undefined) {
      unplaced.push(decision);
      continue;
    }
    add(cards, first, decision);
    cardHunk.set(decision.id, first);
    for (const id of rest) add(mentions, id, decision);
  }
  return { cards, mentions, cardHunk, unplaced };
};

/** Each hunk's calls by the new-side line they're on. Hints to hunks the page doesn't know drop. */
export const callsByLine = (
  callGraph: readonly CallGraphHint[],
  index: HunkIndex,
): ReadonlyMap<HunkId, ReadonlyMap<number, readonly Call[]>> => {
  const calls = new Map<HunkId, Map<number, Call[]>>();
  for (const { fromHunkId, toHunkId, symbol, line } of callGraph) {
    if (!index.hunks.has(fromHunkId) || !index.hunks.has(toHunkId)) continue;
    const lines = calls.get(fromHunkId) ?? new Map<number, Call[]>();
    lines.set(line, [...(lines.get(line) ?? []), { symbol, toHunkId, line }]);
    calls.set(fromHunkId, lines);
  }
  return calls;
};

/** Bar heights on the risk map, in pixels: one per line, within these bounds. */
export const BAR_MIN_PX = 12;
export const BAR_MAX_PX = 60;

export const barHeight = (hunk: Pick<Hunk, "lines">): number =>
  Math.min(BAR_MAX_PX, Math.max(BAR_MIN_PX, hunk.lines.length));

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

/** Hunks by risk class. */
export type RiskMix = Readonly<Record<RiskAssessment["riskClass"], number>>;

/** Hunks by risk class across the pull request: the totals above the map. */
export const riskTotals = (analysis: Analysis, index: HunkIndex): RiskMix => {
  const totals = { contract: 0, logic: 0, mechanical: 0 };
  for (const item of index.items([...index.hunks.keys()])) {
    totals[index.mechanical.has(item.hunk.id) ? "mechanical" : item.risk.riskClass] += 1;
  }
  totals.mechanical += analysis.proofs.filter((proof) => proof.hunkId === null).length;
  return totals;
};

/**
 * Proofs the mechanical group at the end shows: file-level ones, and those in files with nothing
 * else to review. A mechanical hunk in a file with other changes shows in place in that file's step.
 */
export const trailingProofs = (analysis: Analysis, index: HunkIndex): MechanicalProof[] => {
  const reviewed = new Set(
    [...index.hunks].flatMap(([id, { file }]) => (index.mechanical.has(id) ? [] : [file.path])),
  );
  return analysis.proofs.filter((proof) => proof.hunkId === null || !reviewed.has(proof.path));
};

/**
 * Each hunk's callers by file: one per file, going to that file's first hunk in `order` (the
 * map's) that calls it. Production files come first, then tests, each in the order of that hunk.
 * Hints to or from hunks the page doesn't know are dropped.
 */
export const callerFiles = (
  callGraph: readonly CallGraphHint[],
  index: HunkIndex,
  order: readonly HunkId[],
): ReadonlyMap<HunkId, readonly CallerFile[]> => {
  const rank = new Map(order.map((id, at) => [id, at]));
  const rankOf = (id: HunkId) => rank.get(id) ?? order.length;
  const byCallee = new Map<HunkId, Map<string, HunkId>>();
  for (const { fromHunkId, toHunkId } of callGraph) {
    const caller = index.hunks.get(fromHunkId);
    if (caller === undefined || !index.hunks.has(toHunkId) || fromHunkId === toHunkId) continue;
    const files = byCallee.get(toHunkId) ?? new Map<string, HunkId>();
    const known = files.get(caller.file.path);
    if (known === undefined || rankOf(fromHunkId) < rankOf(known)) {
      files.set(caller.file.path, fromHunkId);
    }
    byCallee.set(toHunkId, files);
  }
  return new Map(
    [...byCallee].map(([callee, files]) => [
      callee,
      [...files]
        .map(([path, hunkId]) => ({ path, hunkId, test: isTestFile(path) }))
        .sort((a, b) => Number(a.test) - Number(b.test) || rankOf(a.hunkId) - rankOf(b.hunkId)),
    ]),
  );
};

/** Every hunk to review, in the map's order: what the reviewed count counts. */
export const reviewOrder = (sections: readonly MapSection[], index: HunkIndex): readonly HunkId[] =>
  sections.flatMap((section) => section.hunkIds).filter((id) => !index.mechanical.has(id));
