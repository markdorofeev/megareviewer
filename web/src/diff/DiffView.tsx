import type {
  FileChange,
  Hunk,
  HunkId,
  MechanicalProof,
  PartId,
} from "../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../src/domain/review/index.ts";
import { CollapsedHunk } from "./CollapsedHunk.tsx";
import { type CallerFile, HunkCard, type LineComment, type LinePlace } from "./HunkCard.tsx";

export interface HunkItem {
  readonly hunk: Hunk;
  readonly file: FileChange;
  readonly risk: RiskAssessment;
  /** A hunk with a mechanical proof shows collapsed, with its proof. */
  readonly proofs?: readonly MechanicalProof[];
}

/**
 * Hunks as cards, in the order given: the caller picks which hunks to show and in what order. A
 * mechanical hunk is one dimmed row with its proof, expanding to its card: collapsed, never hidden.
 */
export const DiffView = ({
  items,
  highlightedHunkIds,
  focusedHunkId = null,
  onFocusHunk,
  callersOf,
  onFollow,
  reviewedHunkIds,
  onReviewed,
  commentsOf,
  openComment = null,
  onOpenComment,
  onComment,
}: {
  readonly items: readonly HunkItem[];
  /** Hunks to mark, e.g. those of the selected decision. */
  readonly highlightedHunkIds?: ReadonlySet<PartId>;
  readonly focusedHunkId?: PartId | null;
  readonly onFocusHunk?: (id: PartId) => void;
  readonly callersOf?: (id: PartId) => readonly CallerFile[];
  readonly onFollow?: (id: PartId) => void;
  readonly reviewedHunkIds?: ReadonlySet<string>;
  readonly onReviewed?: (id: PartId, reviewed: boolean) => void;
  readonly commentsOf?: (id: PartId) => readonly LineComment[];
  readonly openComment?: { readonly hunkId: HunkId; readonly place: LinePlace } | null;
  readonly onOpenComment?: (id: PartId, place: LinePlace | null) => void;
  readonly onComment?: (id: PartId, comment: LineComment) => void;
}) => (
  <div className="diff-view">
    {items.map(({ hunk, file, risk, proofs = [] }) =>
      proofs.length > 0 ? (
        <CollapsedHunk
          key={hunk.id}
          hunk={hunk}
          file={file}
          risk={risk}
          proofs={proofs}
          focused={focusedHunkId === hunk.id}
          onFocus={onFocusHunk}
        />
      ) : (
        <HunkCard
          key={hunk.id}
          hunk={hunk}
          file={file}
          risk={risk}
          highlighted={highlightedHunkIds?.has(hunk.id) ?? false}
          focused={focusedHunkId === hunk.id}
          onFocus={onFocusHunk}
          callers={callersOf?.(hunk.id)}
          onFollow={onFollow}
          reviewed={reviewedHunkIds?.has(hunk.id)}
          onReviewed={onReviewed}
          comments={commentsOf?.(hunk.id)}
          openComment={openComment?.hunkId === hunk.id ? openComment.place : null}
          onOpenComment={onOpenComment}
          onComment={onComment}
        />
      ),
    )}
  </div>
);
