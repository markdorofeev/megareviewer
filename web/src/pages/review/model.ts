import {
  type CallGraphHint,
  type FileChange,
  type Hunk,
  type HunkId,
  hunkIdOf,
  type MechanicalProof,
  type PartId,
  partsByHunk,
  piecesOf,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type Decision,
  type DecisionId,
  type HunkComment,
  isTestFile,
  type RiskAssessment,
  type TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import {
  type CallerFile,
  commentPlace,
  type HunkItem,
  type PartHeader,
  type PartNeighbor,
} from "../../diff/index.ts";
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

/** Where a part of a split hunk is in it: part `n` of `of`, and what it changes. */
export interface PartPlace {
  readonly n: number;
  readonly of: number;
  readonly definitions: readonly string[];
  /** The hunk's parts, in order. */
  readonly siblings: readonly PartId[];
}

/** A part as the page shows it: its lines as a hunk, its file, its hunk's risk and proofs. */
export interface PartItem extends HunkItem {
  readonly id: PartId;
  readonly hunkId: HunkId;
  /** Null for a hunk that isn't split. */
  readonly place: PartPlace | null;
}

/**
 * Parts and their files by ID, with each one's hunk's risk: a split hunk is one entry per part, any
 * other hunk one entry. A hunk without an assessment yet (the risk pass hasn't run) reads as logic:
 * shown in full, never collapsed.
 */
export const partIndex = (analysis: Analysis) => {
  const byHunk = partsByHunk(analysis.parts);
  const parts = new Map<
    PartId,
    { readonly hunk: Hunk; readonly file: FileChange; readonly place: PartPlace | null }
  >();
  const ofHunk = new Map<HunkId, readonly PartId[]>();
  for (const file of analysis.files) {
    for (const hunk of file.hunks) {
      const split = byHunk.get(hunk.id) ?? [];
      const siblings = split.map((part) => part.id);
      ofHunk.set(hunk.id, split.length > 0 ? siblings : [hunk.id]);
    }
    for (const piece of piecesOf(file, byHunk)) {
      const split = byHunk.get(piece.hunk.id) ?? [];
      const at = split.findIndex((part) => part.id === piece.id);
      const part = split[at];
      parts.set(piece.id, {
        hunk: piece.hunk,
        file,
        place:
          part === undefined
            ? null
            : {
                n: at + 1,
                of: split.length,
                definitions: part.definitions,
                siblings: split.map((one) => one.id),
              },
      });
    }
  }
  const risk = new Map(analysis.risk.map((assessment) => [assessment.hunkId, assessment]));
  const proofs = new Map<PartId, MechanicalProof[]>();
  for (const proof of analysis.proofs) {
    if (proof.hunkId !== null)
      proofs.set(proof.hunkId, [...(proofs.get(proof.hunkId) ?? []), proof]);
  }
  // A mechanical hunk is never split, so its part ID is its hunk ID.
  const mechanical: ReadonlySet<PartId> = new Set(proofs.keys());
  const riskOf = (id: PartId): RiskAssessment => {
    const hunkId = hunkIdOf(id);
    return (
      risk.get(hunkId) ?? { hunkId, riskClass: "logic", reason: UNCLASSIFIED, source: "fallback" }
    );
  };
  const items = (ids: readonly PartId[]): PartItem[] =>
    ids.flatMap((id) => {
      const found = parts.get(id);
      return found === undefined
        ? []
        : [
            {
              ...found,
              id,
              hunkId: hunkIdOf(id),
              risk: riskOf(id),
              proofs: proofs.get(id) ?? [],
            },
          ];
    });
  /** A hunk's parts in order, or none when the page doesn't know the hunk. */
  const partsOf = (hunkId: HunkId): readonly PartId[] => ofHunk.get(hunkId) ?? [];
  return { parts, mechanical, items, partsOf };
};

export type PartIndex = ReturnType<typeof partIndex>;

/** Non-mechanical parts in path order, then file order: the reading order before a tour exists. */
export const partsInPathOrder = (analysis: Analysis, index: PartIndex): PartId[] =>
  [...analysis.files]
    .sort(byPath)
    .flatMap((file) => file.hunks.flatMap((hunk) => index.partsOf(hunk.id)))
    .filter((id) => !index.mechanical.has(id));

/**
 * The tour's steps, plus a step for non-mechanical hunks the tour misses. The server checks the
 * tour covers each one, but a hunk left out of every step would be invisible, so show it anyway.
 */
export const tourSteps = (analysis: Analysis, index: PartIndex): readonly TourStep[] => {
  const steps = analysis.tour?.steps ?? [];
  const covered = new Set(steps.flatMap((step) => step.partIds));
  const missed = partsInPathOrder(analysis, index).filter((id) => !covered.has(id));
  if (missed.length === 0) return steps;
  return [
    ...steps,
    {
      id: TourStepId.parse(`s${steps.length + 1}`),
      title: "Changes the tour left out",
      explanation: "The tour didn't include these changes, so they're shown here in file order.",
      partIds: missed,
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
      readonly partIds: readonly PartId[];
    }
  | { readonly kind: "files"; readonly partIds: readonly PartId[] };

export const mapSections = (
  analysis: Analysis,
  steps: readonly TourStep[],
  index: PartIndex,
): readonly MapSection[] =>
  analysis.tour === null
    ? [
        {
          kind: "files",
          partIds: withMechanicalInPlace(partsInPathOrder(analysis, index), index),
        },
      ]
    : steps.map((step, at) => ({
        kind: "step",
        step,
        number: at + 1,
        partIds: withMechanicalInPlace(step.partIds, index),
      }));

export const sectionKey = (section: MapSection): string =>
  section.kind === "step" ? section.step.id : "files";

/** Where the decisions show: each as a card on one hunk, linked from its other hunks. */
export interface DecisionPlaces {
  /** The decisions whose card sits on this hunk. */
  readonly cards: ReadonlyMap<PartId, readonly Decision[]>;
  /** The decisions resting on this hunk whose card sits on another. */
  readonly mentions: ReadonlyMap<PartId, readonly Decision[]>;
  readonly cardHunk: ReadonlyMap<DecisionId, PartId>;
  /** Decisions resting on no hunk the page can show a card on. They show before the code. */
  readonly unplaced: readonly Decision[];
}

/**
 * A decision's card goes under the header of the first part, in `order` (the page's), of the
 * hunks it rests on; its other parts link to it. Mechanical hunks show collapsed, so they never
 * hold a card.
 */
export const decisionPlaces = (
  decisions: readonly Decision[],
  order: readonly PartId[],
  index: PartIndex,
): DecisionPlaces => {
  const rank = new Map(order.map((id, at) => [id, at]));
  const cards = new Map<PartId, Decision[]>();
  const mentions = new Map<PartId, Decision[]>();
  const cardHunk = new Map<DecisionId, PartId>();
  const unplaced: Decision[] = [];
  const add = (map: Map<PartId, Decision[]>, id: PartId, decision: Decision) =>
    map.set(id, [...(map.get(id) ?? []), decision]);
  for (const decision of decisions) {
    const [first, ...rest] = [...new Set(decision.hunkIds)]
      .flatMap(index.partsOf)
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
  index: PartIndex,
): ReadonlyMap<PartId, ReadonlyMap<number, readonly Call[]>> => {
  const calls = new Map<PartId, Map<number, Call[]>>();
  for (const { fromPartId, toPartId, symbol, line } of callGraph) {
    if (!index.parts.has(fromPartId) || !index.parts.has(toPartId)) continue;
    const lines = calls.get(fromPartId) ?? new Map<number, Call[]>();
    lines.set(line, [...(lines.get(line) ?? []), { symbol, toPartId, line }]);
    calls.set(fromPartId, lines);
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
  const hunks = new Set<PartId>();
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
export const withMechanicalInPlace = (ids: readonly PartId[], index: PartIndex): PartId[] => {
  const result: PartId[] = [];
  const placed = new Set<PartId>(ids);
  const fileOf = (id: PartId) => index.parts.get(id)?.file;
  const mechanicalBefore = (file: FileChange, id: PartId | null): PartId[] => {
    const at =
      id === null ? file.hunks.length : file.hunks.findIndex((hunk) => hunk.id === hunkIdOf(id));
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
export const riskTotals = (analysis: Analysis, index: PartIndex): RiskMix => {
  const totals = { contract: 0, logic: 0, mechanical: 0 };
  const hunks = analysis.files.flatMap((file) => file.hunks.map((hunk) => hunk.id));
  for (const item of index.items(hunks.flatMap((id) => index.partsOf(id).slice(0, 1)))) {
    totals[index.mechanical.has(item.hunk.id) ? "mechanical" : item.risk.riskClass] += 1;
  }
  totals.mechanical += analysis.proofs.filter((proof) => proof.hunkId === null).length;
  return totals;
};

/**
 * Proofs the mechanical group at the end shows: file-level ones, and those in files with nothing
 * else to review. A mechanical hunk in a file with other changes shows in place in that file's step.
 */
export const trailingProofs = (analysis: Analysis, index: PartIndex): MechanicalProof[] => {
  const reviewed = new Set(
    [...index.parts].flatMap(([id, { file }]) => (index.mechanical.has(id) ? [] : [file.path])),
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
  index: PartIndex,
  order: readonly PartId[],
): ReadonlyMap<PartId, readonly CallerFile[]> => {
  const rank = new Map(order.map((id, at) => [id, at]));
  const rankOf = (id: PartId) => rank.get(id) ?? order.length;
  const byCallee = new Map<PartId, Map<string, PartId>>();
  for (const { fromPartId, toPartId } of callGraph) {
    const caller = index.parts.get(fromPartId);
    if (caller === undefined || !index.parts.has(toPartId) || fromPartId === toPartId) continue;
    const files = byCallee.get(toPartId) ?? new Map<string, PartId>();
    const known = files.get(caller.file.path);
    if (known === undefined || rankOf(fromPartId) < rankOf(known)) {
      files.set(caller.file.path, fromPartId);
    }
    byCallee.set(toPartId, files);
  }
  return new Map(
    [...byCallee].map(([callee, files]) => [
      callee,
      [...files]
        .map(([path, partId]) => ({ path, partId, test: isTestFile(path) }))
        .sort((a, b) => Number(a.test) - Number(b.test) || rankOf(a.partId) - rankOf(b.partId)),
    ]),
  );
};

/** Every hunk to review, in the map's order: what the reviewed count counts. */
export const reviewOrder = (sections: readonly MapSection[], index: PartIndex): readonly PartId[] =>
  sections.flatMap((section) => section.partIds).filter((id) => !index.mechanical.has(id));

/**
 * The parts marked reviewed. Marks are stored by part ID; a mark stored on a hunk that's split now
 * covers all of its parts.
 */
export const reviewedParts = (stored: readonly string[], index: PartIndex): ReadonlySet<PartId> => {
  const marks = new Set(stored);
  const reviewed = new Set<PartId>();
  for (const [id, { place }] of index.parts) {
    if (marks.has(id) || (place !== null && marks.has(hunkIdOf(id)))) reviewed.add(id);
  }
  return reviewed;
};

/**
 * The stored marks after marking one part reviewed or not. A mark on its hunk, from before the
 * hunk was split, becomes a mark on each of the hunk's other parts.
 */
export const markReviewed = (
  stored: readonly string[],
  id: PartId,
  value: boolean,
  index: PartIndex,
): string[] => {
  const hunkId = hunkIdOf(id);
  const split = hunkId !== id && stored.includes(hunkId);
  const siblings = split ? index.partsOf(hunkId).filter((other) => other !== id) : [];
  const without = stored.filter((other) => other !== id && !(split && other === hunkId));
  return [...without, ...siblings, ...(value ? [id] : [])];
};

/** Hunks whose parts on the page are all reviewed: the header counts hunks, not parts. */
export const reviewedHunkCount = (
  toReview: readonly PartId[],
  reviewed: ReadonlySet<PartId>,
): { readonly done: number; readonly total: number } => {
  const allDone = new Map<HunkId, boolean>();
  for (const id of toReview) {
    const hunkId = hunkIdOf(id);
    allDone.set(hunkId, (allDone.get(hunkId) ?? true) && reviewed.has(id));
  }
  return { done: [...allDone.values()].filter(Boolean).length, total: allDone.size };
};

/** Each split part's header, from where the sections put its hunk's parts. */
export const partHeaders = (
  sections: readonly MapSection[],
  index: PartIndex,
): ReadonlyMap<PartId, PartHeader> => {
  const stepOf = new Map<PartId, number>();
  for (const section of sections) {
    if (section.kind !== "step") continue;
    for (const id of section.partIds) if (!stepOf.has(id)) stepOf.set(id, section.number);
  }
  const neighbor = (id: PartId | undefined): PartNeighbor | null => {
    const place = id === undefined ? null : (index.parts.get(id)?.place ?? null);
    return id === undefined || place === null
      ? null
      : { id, n: place.n, definitions: place.definitions, step: stepOf.get(id) ?? null };
  };
  const headers = new Map<PartId, PartHeader>();
  for (const [id, { place }] of index.parts) {
    if (place === null) continue;
    const own = stepOf.get(id);
    const elsewhere = [
      ...new Set(
        place.siblings.flatMap((other) => {
          const step = stepOf.get(other);
          return step === undefined || step === own ? [] : [step];
        }),
      ),
    ].sort((a, b) => a - b);
    headers.set(id, {
      definitions: place.definitions,
      n: place.n,
      of: place.of,
      elsewhere,
      previous: neighbor(place.siblings[place.n - 2]),
      next: neighbor(place.siblings[place.n]),
    });
  }
  return headers;
};

/** Each part's comments: those on its hunk whose line the part shows. */
export const commentsInParts = (
  comments: readonly HunkComment[],
  index: PartIndex,
): ReadonlyMap<PartId, readonly HunkComment[]> => {
  const byPart = new Map<PartId, HunkComment[]>();
  for (const comment of comments) {
    const id = index.partsOf(comment.hunkId).find((one) =>
      index.parts.get(one)?.hunk.lines.some((line) => {
        const place = commentPlace(line);
        return place !== null && place.side === comment.side && place.line === comment.line;
      }),
    );
    if (id !== undefined) byPart.set(id, [...(byPart.get(id) ?? []), comment]);
  }
  return byPart;
};
