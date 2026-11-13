import {
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
  type HunkComment,
  type Point,
  type PointId,
  type ReviewThread,
  type RiskAssessment,
  ruleReasons,
  type TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import { commentPlace, type HunkItem } from "../../review/index.ts";
import { byTreePath } from "../../review/tree/paths.ts";

export { byTreePath };

/** The page's two layouts: one scroll of the changed files, or an overview of them. */
export type Layout = "map" | "overview";

/** The call tree the overview replaced is stored as `tree`, and opens the overview. */
export const parseLayout = (stored: unknown): Layout | undefined =>
  stored === "map" ? "map" : stored === "overview" || stored === "tree" ? "overview" : undefined;

const byPath = (a: FileChange, b: FileChange): number => byTreePath(a.path, b.path);

const UNCLASSIFIED = "Not classified yet.";

/** Where a part of a split hunk is in it: part `n` of `of`, and what it changes. */
export interface PartPlace {
  readonly n: number;
  readonly of: number;
  readonly definitions: readonly string[];
  /** The hunk's parts, in order. */
  readonly siblings: readonly PartId[];
}

/**
 * Rules run on a split part's own lines, so a part git put next to credential code isn't contract.
 * The model's risk is about the whole hunk and stays the hunk's.
 */
const partRisk = (hunk: RiskAssessment, reasons: readonly string[]): RiskAssessment =>
  reasons.length === 0
    ? { ...hunk, riskClass: "logic", reason: NO_RULE_IN_PART }
    : { ...hunk, riskClass: "contract", reason: reasons.join("; ") };

const NO_RULE_IN_PART = "No contract rule matches this part's lines.";

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
    const assessed = risk.get(hunkId) ?? {
      hunkId,
      riskClass: "logic",
      reason: UNCLASSIFIED,
      source: "fallback",
    };
    const found = parts.get(id);
    if (assessed.source !== "rule" || found?.place == null) return assessed;
    return partRisk(assessed, ruleReasons(found.hunk, found.file));
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
  /** A file's parts, in the file's order. */
  const partsInFile = (file: FileChange): readonly PartId[] =>
    file.hunks.flatMap((hunk) => partsOf(hunk.id));
  return { parts, mechanical, items, partsOf, partsInFile };
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
      codeTitle: null,
      merged: [],
    },
  ];
};

/** A file's parts on the map: one card. */
export interface FileGroup {
  readonly file: FileChange;
  readonly partIds: readonly PartId[];
}

/**
 * The map's files, those with a part to review, in path order: each file once, with all its parts
 * in the file's order, mechanical ones in place.
 */
export const mapFiles = (analysis: Analysis, index: PartIndex): FileGroup[] =>
  [...analysis.files]
    .sort((a, b) => byTreePath(a.path, b.path))
    .flatMap((file) => {
      const ids = index.partsInFile(file);
      return ids.every((id) => index.mechanical.has(id)) ? [] : [{ file, partIds: ids }];
    });

/** A file's contract parts, as its card counts them: mechanical parts never are. */
export const contractParts = (group: FileGroup, index: PartIndex): number =>
  index
    .items(group.partIds)
    .filter((item) => !index.mechanical.has(item.id) && item.risk.riskClass === "contract").length;

/**
 * How many lines lie between two parts of one file that its card shows one after the other, on the
 * head side (the base side for a deleted file); null for parts of different files.
 */
export const gapBetween = (previous: PartId, next: PartId, index: PartIndex): number | null => {
  const before = index.parts.get(previous);
  const after = index.parts.get(next);
  if (before === undefined || after === undefined || before.file !== after.file) return null;
  const side = before.file.status === "deleted" ? "old" : "new";
  const span = (hunk: Hunk) =>
    side === "old"
      ? { start: hunk.oldStart, count: hunk.oldLines }
      : { start: hunk.newStart, count: hunk.newLines };
  const a = span(before.hunk);
  const b = span(after.hunk);
  // As in a diff, an empty side starts at the line before where it would be.
  const end = a.count === 0 ? a.start : a.start + a.count - 1;
  const start = b.count === 0 ? b.start + 1 : b.start;
  return Math.max(start - end - 1, 0);
};

/** Where the points show: each as a card on one part, linked from the others it rests on. */
export interface PointPlaces {
  /** The points whose card sits on this part. */
  readonly cards: ReadonlyMap<PartId, readonly Point[]>;
  /** The points resting on this part whose card sits on another. */
  readonly mentions: ReadonlyMap<PartId, readonly Point[]>;
  readonly cardPart: ReadonlyMap<PointId, PartId>;
  /** Points resting on no part the page can show a card on. They show before the code. */
  readonly unplaced: readonly Point[];
}

/**
 * A point's card goes on the part holding its lines, or else on the first part, in `order` (the
 * page's), of the hunks it rests on; its other parts link to it. Mechanical hunks show collapsed,
 * so they never hold a card.
 */
export const pointPlaces = (
  points: readonly Point[],
  order: readonly PartId[],
  index: PartIndex,
): PointPlaces => {
  const rank = new Map(order.map((id, at) => [id, at]));
  const cards = new Map<PartId, Point[]>();
  const mentions = new Map<PartId, Point[]>();
  const cardPart = new Map<PointId, PartId>();
  const unplaced: Point[] = [];
  const add = (map: Map<PartId, Point[]>, id: PartId, point: Point) =>
    map.set(id, [...(map.get(id) ?? []), point]);
  for (const point of points) {
    const parts = [...new Set(point.hunkIds)]
      .flatMap(index.partsOf)
      .filter((id) => rank.has(id) && !index.mechanical.has(id))
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const onLines = point.lines === null ? undefined : partShowing(point.lines, parts, index);
    const [first = onLines, ...rest] =
      onLines === undefined ? parts : [onLines, ...parts.filter((id) => id !== onLines)];
    if (first === undefined) {
      unplaced.push(point);
      continue;
    }
    add(cards, first, point);
    cardPart.set(point.id, first);
    for (const id of rest) add(mentions, id, point);
  }
  return { cards, mentions, cardPart, unplaced };
};

/** The part among `parts` that shows the point's first line, if any does. */
const partShowing = (
  lines: NonNullable<Point["lines"]>,
  parts: readonly PartId[],
  index: PartIndex,
): PartId | undefined =>
  parts.find((id) =>
    index.parts.get(id)?.hunk.lines.some((line) => {
      const place = commentPlace(line);
      return place !== null && place.side === lines.side && place.line === lines.startLine;
    }),
  );

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
 * Proofs the mechanical group at the end shows: file-level ones, and those in files with nothing
 * else to review. A mechanical hunk in a file with other changes shows in place in that file's step.
 */
export const trailingProofs = (analysis: Analysis, index: PartIndex): MechanicalProof[] => {
  const reviewed = new Set(
    [...index.parts].flatMap(([id, { file }]) => (index.mechanical.has(id) ? [] : [file.path])),
  );
  return analysis.proofs.filter((proof) => proof.hunkId === null || !reviewed.has(proof.path));
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

/** What the pull request changes, counted over every file in it, mechanical ones too. */
export interface ChangeTotals {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

export const changeTotals = (files: readonly FileChange[]): ChangeTotals => ({
  files: files.length,
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0),
});

/** The pull request's conversation: its threads, and how many of them are still open. */
export interface ThreadTotals {
  readonly threads: number;
  readonly unresolved: number;
}

export const threadTotals = (threads: readonly Pick<ReviewThread, "resolved">[]): ThreadTotals => ({
  threads: threads.length,
  unresolved: threads.filter((thread) => !thread.resolved).length,
});
