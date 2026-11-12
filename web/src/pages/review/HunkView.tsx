import type { ReactNode } from "react";
import type { PartId, UnchangedCallers } from "../../../../src/domain/diff/index.ts";
import {
  HunkCard,
  type LineComment,
  type LineMark,
  type LinePlace,
  MechanicalHunk,
  PINNED,
} from "../../review/index.ts";
import type { PartIndex } from "./model.ts";

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
  /** Posts a comment on its own, now; without it, comments only go with the review. */
  readonly onCommentNow?: (id: PartId, comment: LineComment) => Promise<string | null>;
  /** The review is published: new comments post now, on their own. */
  readonly published: boolean;
  readonly onFocusHunk: (id: PartId) => void;
  /** The decision cards and links that go under a part's divider. */
  readonly decisionsOn: (id: PartId) => ReactNode;
  /** The host's threads on a line of a part, shown under it. */
  readonly threadsAt: (id: PartId, place: LinePlace) => ReactNode;
  /** A file's threads its card can't put on a line, under "Earlier comments". */
  readonly earlierThreads: (path: string) => ReactNode;
  /** A file's unresolved threads. */
  readonly openThreads: (path: string) => number;
  /** Said when the reviewer picks a range, e.g. that the host can't anchor one. */
  readonly rangeNote?: string;
  /** A part's calls into code the PR changes, by new-side line. */
  readonly marksOf: (id: PartId) => ReadonlyMap<number, readonly LineMark[]> | undefined;
}

export const hunkAnchor = (id: PartId): string => `hunk-${id}`;

const markProps = (marks: ReadonlyMap<number, readonly LineMark[]> | undefined) =>
  marks === undefined ? {} : { marks };

/** One part on its file's card: a mechanical one collapsed with its proof, any other its lines. */
export const HunkView = ({ id, deps }: { readonly id: PartId; readonly deps: HunkDeps }) => {
  const [item] = deps.index.items([id]);
  if (item === undefined) return null;
  const { hunk, file, risk, proofs = [] } = item;
  if (proofs.length > 0) {
    return (
      <div className={PINNED}>
        <MechanicalHunk
          hunk={hunk}
          file={file}
          risk={risk}
          proofs={proofs}
          onFocus={deps.onFocusHunk}
        />
      </div>
    );
  }
  return (
    <HunkCard
      id={id}
      hunk={hunk}
      file={file}
      risk={risk}
      highlighted={deps.highlighted.has(id)}
      onFocus={deps.onFocusHunk}
      unchanged={deps.unchangedOf(id)}
      inFile
      comments={deps.commentsOf(id)}
      openComment={deps.openComment?.partId === id ? deps.openComment.place : null}
      onOpenComment={deps.onOpenComment}
      onComment={deps.onComment}
      {...(deps.onCommentNow === undefined ? {} : { onCommentNow: deps.onCommentNow })}
      published={deps.published}
      afterHeader={deps.decisionsOn(id)}
      threadsAt={(place) => deps.threadsAt(id, place)}
      {...(deps.rangeNote === undefined ? {} : { rangeNote: deps.rangeNote })}
      {...markProps(deps.marksOf(id))}
    />
  );
};
