import type { ReactNode } from "react";
import type { PartId, UnchangedCallers } from "../../../../src/domain/diff/index.ts";
import {
  type CallerFile,
  CollapsedHunk,
  HunkCard,
  type LineComment,
  type LineMark,
  type LinePlace,
  type PartHeader,
} from "../../diff/index.ts";
import type { ChipPlan } from "./chips.ts";
import { type Call, type PartIndex, riskNote } from "./model.ts";

/** What a part on the page needs. */
export interface HunkDeps {
  readonly index: PartIndex;
  readonly calls: ReadonlyMap<PartId, ReadonlyMap<number, readonly Call[]>>;
  /** Which of a hunk's calls are chips and which are mentions, at its own place in the map. */
  readonly plan: ChipPlan;
  readonly callersOf: (id: PartId) => readonly CallerFile[];
  /** Uses outside the pull request of what a part changes, read from a local checkout. */
  readonly unchangedOf: (id: PartId) => readonly UnchangedCallers[];
  /** The step a hunk is read in, as "step 2: Title", for peeks. */
  readonly stepOf: (id: PartId) => string | null;
  readonly onFollow: (id: PartId) => void;
  readonly reviewed: ReadonlySet<PartId>;
  readonly onReviewed: (id: PartId, reviewed: boolean) => void;
  /** A split part's header and neighbors; null for a hunk that isn't split. */
  readonly partHeaderOf: (id: PartId) => PartHeader | null;
  readonly highlighted: ReadonlySet<PartId>;
  readonly commentsOf: (id: PartId) => readonly LineComment[];
  readonly openComment: { readonly partId: PartId; readonly place: LinePlace } | null;
  readonly onOpenComment: (id: PartId, place: LinePlace | null) => void;
  /** Without it, comments are read-only: the review is published. */
  readonly onComment?: (id: PartId, comment: LineComment) => void;
  readonly onFocusHunk: (id: PartId) => void;
  /** The decision cards and links that go under a hunk's header. */
  readonly decisionsOn: (id: PartId) => ReactNode;
}

export const hunkAnchor = (id: PartId): string => `hunk-${id}`;

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
  inFile = false,
}: {
  readonly id: PartId;
  readonly deps: HunkDeps;
  readonly belowLine?: ReadonlyMap<number, ReactNode>;
  readonly inLine?: ReadonlyMap<number, readonly LineMark[]>;
  readonly focused?: boolean;
  readonly nested?: boolean;
  /** On a file's card with other parts, which marks them all reviewed at once. */
  readonly inFile?: boolean;
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
      id={id}
      part={deps.partHeaderOf(id)}
      hunk={hunk}
      file={file}
      risk={risk}
      highlighted={deps.highlighted.has(id)}
      focused={focused}
      onFocus={nested ? undefined : deps.onFocusHunk}
      callers={nested ? undefined : deps.callersOf(id)}
      unchanged={nested ? undefined : deps.unchangedOf(id)}
      onFollow={deps.onFollow}
      reviewed={deps.reviewed.has(id)}
      onReviewed={inFile ? undefined : deps.onReviewed}
      inFile={inFile}
      riskNote={inFile ? riskNote(item) : undefined}
      comments={deps.commentsOf(id)}
      openComment={!nested && deps.openComment?.partId === id ? deps.openComment.place : null}
      onOpenComment={nested ? undefined : deps.onOpenComment}
      onComment={nested ? undefined : deps.onComment}
      afterHeader={nested ? undefined : deps.decisionsOn(id)}
      belowLine={belowLine}
      inLine={inLine}
    />
  );
};

/** A call's name, or a request's method and path, the called hunk's file and its risk class. */
export const CallLabel = ({ call, index }: { readonly call: Call; readonly index: PartIndex }) => {
  const target = index.items([call.toPartId])[0];
  const riskClass = index.mechanical.has(call.toPartId)
    ? "mechanical"
    : (target?.risk.riskClass ?? "logic");
  return (
    <>
      {call.request === true && <span className="call-kind">sends</span>}
      {call.request === true && " "}
      <code className="call-symbol">{call.symbol}</code>{" "}
      <span className="call-file">{target?.file.path}</span>{" "}
      <span className={`call-risk risk-${riskClass}`}>{riskClass}</span>
    </>
  );
};
