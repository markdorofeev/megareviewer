import type { ReactNode } from "react";
import type { PartId, UnchangedCallers } from "../../../../src/domain/diff/index.ts";
import { CollapsedHunk, HunkCard, type LineComment, type LinePlace } from "../../diff/index.ts";
import { type PartIndex, partReason } from "./model.ts";

/** What a part on the page needs. */
export interface HunkDeps {
  readonly index: PartIndex;
  /** Uses outside the pull request of what a part changes, read from a local checkout. */
  readonly unchangedOf: (id: PartId) => readonly UnchangedCallers[];
  readonly highlighted: ReadonlySet<PartId>;
  readonly commentsOf: (id: PartId) => readonly LineComment[];
  readonly openComment: { readonly partId: PartId; readonly place: LinePlace } | null;
  readonly onOpenComment: (id: PartId, place: LinePlace | null) => void;
  /** Without it, comments are read-only: the review is published. */
  readonly onComment?: (id: PartId, comment: LineComment) => void;
  readonly onFocusHunk: (id: PartId) => void;
  /** The decision cards and links that go under a part's divider. */
  readonly decisionsOn: (id: PartId) => ReactNode;
}

export const hunkAnchor = (id: PartId): string => `hunk-${id}`;

/** One part on its file's card: a mechanical one collapsed with its proof, any other its lines. */
export const HunkView = ({ id, deps }: { readonly id: PartId; readonly deps: HunkDeps }) => {
  const [item] = deps.index.items([id]);
  if (item === undefined) return null;
  const { hunk, file, risk, proofs = [] } = item;
  if (proofs.length > 0) {
    return (
      <CollapsedHunk
        hunk={hunk}
        file={file}
        risk={risk}
        proofs={proofs}
        onFocus={deps.onFocusHunk}
      />
    );
  }
  return (
    <HunkCard
      id={id}
      hunk={hunk}
      file={file}
      // The file's header gives the path rules' reasons.
      risk={{ ...risk, reason: partReason(risk.reason, file) }}
      highlighted={deps.highlighted.has(id)}
      onFocus={deps.onFocusHunk}
      unchanged={deps.unchangedOf(id)}
      inFile
      comments={deps.commentsOf(id)}
      openComment={deps.openComment?.partId === id ? deps.openComment.place : null}
      onOpenComment={deps.onOpenComment}
      onComment={deps.onComment}
      afterHeader={deps.decisionsOn(id)}
    />
  );
};
