import type { ReactNode } from "react";
import type { HunkId } from "../../../../src/domain/diff/index.ts";
import {
  type CallerFile,
  CollapsedHunk,
  HunkCard,
  type LineComment,
  type LineMark,
  type LinePlace,
} from "../../diff/index.ts";
import type { ChipPlan } from "./chips.ts";
import type { Call, HunkIndex, HunkLink } from "./model.ts";

/** What a hunk on the page needs, the same in both layouts. */
export interface HunkDeps {
  readonly index: HunkIndex;
  readonly calls: ReadonlyMap<HunkId, ReadonlyMap<number, readonly Call[]>>;
  /** Which of a hunk's calls are chips and which are mentions, at its own place in the map. */
  readonly plan: ChipPlan;
  /** The call graph's links, for the call tree. */
  readonly linksOf: (id: HunkId) => readonly HunkLink[];
  readonly callersOf: (id: HunkId) => readonly CallerFile[];
  /** The step a hunk is read in, as "step 2: Title", for peeks. */
  readonly stepOf: (id: HunkId) => string | null;
  readonly onFollow: (id: HunkId) => void;
  readonly reviewedHunks: ReadonlySet<string>;
  readonly onReviewed: (id: HunkId, reviewed: boolean) => void;
  readonly highlighted: ReadonlySet<HunkId>;
  readonly commentsOf: (id: HunkId) => readonly LineComment[];
  readonly openComment: { readonly hunkId: HunkId; readonly place: LinePlace } | null;
  readonly onOpenComment: (id: HunkId, place: LinePlace | null) => void;
  /** Without it, comments are read-only: the review is published. */
  readonly onComment?: (id: HunkId, comment: LineComment) => void;
  readonly onFocusHunk: (id: HunkId) => void;
  /** The decision cards and links that go under a hunk's header. */
  readonly decisionsOn: (id: HunkId) => ReactNode;
}

export const hunkAnchor = (id: HunkId): string => `hunk-${id}`;

/**
 * One hunk: a mechanical one collapsed with its proof, any other as its card. A nested hunk, opened
 * from a call, leaves its callers, decisions and comment boxes to the hunk's own place on the page.
 */
export const HunkView = ({
  id,
  deps,
  belowLine,
  inLine,
  focused = false,
  nested = false,
}: {
  readonly id: HunkId;
  readonly deps: HunkDeps;
  readonly belowLine?: ReadonlyMap<number, ReactNode>;
  readonly inLine?: ReadonlyMap<number, readonly LineMark[]>;
  readonly focused?: boolean;
  readonly nested?: boolean;
}) => {
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
        focused={focused}
        onFocus={nested ? undefined : deps.onFocusHunk}
      />
    );
  }
  return (
    <HunkCard
      hunk={hunk}
      file={file}
      risk={risk}
      highlighted={deps.highlighted.has(id)}
      focused={focused}
      onFocus={nested ? undefined : deps.onFocusHunk}
      callers={nested ? undefined : deps.callersOf(id)}
      onFollow={deps.onFollow}
      reviewed={deps.reviewedHunks.has(id)}
      onReviewed={deps.onReviewed}
      comments={deps.commentsOf(id)}
      openComment={!nested && deps.openComment?.hunkId === id ? deps.openComment.place : null}
      onOpenComment={nested ? undefined : deps.onOpenComment}
      onComment={nested ? undefined : deps.onComment}
      afterHeader={nested ? undefined : deps.decisionsOn(id)}
      belowLine={belowLine}
      inLine={inLine}
    />
  );
};

/** A call's name, the called hunk's file and its risk class. */
export const CallLabel = ({ call, index }: { readonly call: Call; readonly index: HunkIndex }) => {
  const target = index.items([call.toHunkId])[0];
  const riskClass = index.mechanical.has(call.toHunkId)
    ? "mechanical"
    : (target?.risk.riskClass ?? "logic");
  return (
    <>
      <code className="call-symbol">{call.symbol}</code>{" "}
      <span className="call-file">{target?.file.path}</span>{" "}
      <span className={`call-risk risk-${riskClass}`}>{riskClass}</span>
    </>
  );
};
