import { type Ref, useId } from "react";
import type { HunkId, MechanicalProof } from "../../../../src/domain/diff/index.ts";
import type { Analysis, TourStep } from "../../../../src/domain/review/index.ts";
import {
  DiffView,
  FileNotices,
  type HunkItem,
  type HunkLink,
  type LineComment,
  type LinePlace,
  MechanicalGroup,
} from "../../diff/index.ts";
import type { MainView } from "./model.ts";

/** What the main area is about, above the hunks. */
export type MainHeading =
  | { readonly kind: "step"; readonly step: TourStep; readonly number: number; readonly of: number }
  | { readonly kind: "mechanical" }
  | { readonly kind: "files" }
  | { readonly kind: "decision"; readonly title: string; readonly detail: string }
  | { readonly kind: "mismatch"; readonly title: string; readonly detail: string };

const EMPTY_FOCUS = "This doesn't point at any particular change, so there's nothing to show here.";

/** The changes the reviewer is reading: a tour step, the mechanical changes, or a focus. */
export const MainArea = ({
  ref,
  analysis,
  view,
  heading,
  items,
  highlightedHunkIds,
  focusedHunkId,
  mechanicalCount,
  trailingProofs,
  contractOnly,
  linksOf,
  onFollow,
  reviewedHunkIds,
  onReviewed,
  commentsOf,
  openComment,
  onOpenComment,
  onComment,
  onFocusHunk,
  onBack,
  onPrevious,
  onNext,
}: {
  readonly ref: Ref<HTMLElement>;
  readonly analysis: Analysis;
  readonly view: MainView;
  readonly heading: MainHeading;
  readonly items: readonly HunkItem[];
  readonly highlightedHunkIds?: ReadonlySet<HunkId>;
  readonly focusedHunkId: HunkId | null;
  readonly mechanicalCount: number;
  /** The proofs of the last tour entry: files with nothing else to review. */
  readonly trailingProofs: readonly MechanicalProof[];
  /** Only contract hunks are in `items`. */
  readonly contractOnly: boolean;
  readonly linksOf: (id: HunkId) => readonly HunkLink[];
  readonly onFollow: (id: HunkId) => void;
  readonly reviewedHunkIds: ReadonlySet<string>;
  readonly onReviewed: (id: HunkId, reviewed: boolean) => void;
  readonly commentsOf: (id: HunkId) => readonly LineComment[];
  readonly openComment: { readonly hunkId: HunkId; readonly place: LinePlace } | null;
  readonly onOpenComment: (id: HunkId, place: LinePlace | null) => void;
  /** Without it, comments are read-only: the review is published. */
  readonly onComment?: (id: HunkId, comment: LineComment) => void;
  readonly onFocusHunk: (id: HunkId) => void;
  readonly onBack: () => void;
  readonly onPrevious: (() => void) | null;
  readonly onNext: (() => void) | null;
}) => {
  const id = useId();
  const focused = heading.kind === "decision" || heading.kind === "mismatch";
  const showMechanical = !focused && view.kind !== "step";

  return (
    <section ref={ref} className="main-area" aria-labelledby={`${id}-title`} tabIndex={-1}>
      {focused && (
        <button type="button" className="button quiet back" onClick={onBack}>
          ← Back to tour <kbd>Esc</kbd>
        </button>
      )}
      {heading.kind === "step" ? (
        <>
          <p className="step-count">
            Step {heading.number} of {heading.of}
          </p>
          <h2 id={`${id}-title`} className="model-text">
            {heading.step.title}
          </h2>
          <p className="model-text">{heading.step.explanation}</p>
          {analysis.tour?.builtBy === "code" && analysis.stages.tour === "done" && (
            <p className="banner">
              The model's tour wasn't usable, so this one follows the call graph.
            </p>
          )}
        </>
      ) : heading.kind === "mechanical" ? (
        <h2 id={`${id}-title`} className="visually-hidden">
          Mechanical changes
        </h2>
      ) : heading.kind === "files" ? (
        <>
          <h2 id={`${id}-title`}>Changes by file</h2>
          <p className="muted">
            {analysis.status === "running"
              ? "The guided tour appears when the analysis finishes."
              : "There's no guided tour, so the changes are shown by file."}
          </p>
        </>
      ) : (
        <>
          <p className="step-count">{heading.kind === "decision" ? "Decision" : "Mismatch"}</p>
          <h2 id={`${id}-title`} className="model-text">
            {heading.title}
          </h2>
          {heading.detail !== "" && <p className="model-text">{heading.detail}</p>}
          {items.length === 0 && <p className="muted">{EMPTY_FOCUS}</p>}
        </>
      )}

      {contractOnly && items.length === 0 && view.kind !== "mechanical" && (
        <p className="muted">
          No contract changes here. Turn off “Contract changes only” to see the rest.
        </p>
      )}

      <DiffView
        items={items}
        highlightedHunkIds={highlightedHunkIds}
        focusedHunkId={focusedHunkId}
        onFocusHunk={onFocusHunk}
        linksOf={linksOf}
        onFollow={onFollow}
        reviewedHunkIds={reviewedHunkIds}
        onReviewed={onReviewed}
        commentsOf={commentsOf}
        openComment={openComment}
        onOpenComment={onOpenComment}
        onComment={onComment}
      />

      {showMechanical && (
        <>
          {view.kind === "mechanical" && mechanicalCount === 0 && (
            <p className="muted">No mechanical changes in this pull request.</p>
          )}
          <MechanicalGroup files={analysis.files} proofs={trailingProofs} risk={analysis.risk} />
          <FileNotices files={analysis.files} />
        </>
      )}

      {!focused && (onPrevious !== null || onNext !== null) && (
        <div className="step-buttons">
          <button
            type="button"
            className="button"
            disabled={onPrevious === null}
            onClick={onPrevious ?? undefined}
          >
            ← Prev
          </button>
          <button
            type="button"
            className="button"
            disabled={onNext === null}
            onClick={onNext ?? undefined}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
};
