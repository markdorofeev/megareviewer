import type { FileChange, Hunk, HunkId, MechanicalProof } from "../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../src/domain/review/index.ts";
import { CollapsedHunk } from "./CollapsedHunk.tsx";
import { HunkCard } from "./HunkCard.tsx";

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
}: {
  readonly items: readonly HunkItem[];
  /** Hunks to mark, e.g. those of the selected decision. */
  readonly highlightedHunkIds?: ReadonlySet<HunkId>;
  readonly focusedHunkId?: HunkId | null;
  readonly onFocusHunk?: (id: HunkId) => void;
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
        />
      ),
    )}
  </div>
);
