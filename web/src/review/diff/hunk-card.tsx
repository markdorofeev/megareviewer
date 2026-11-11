import { Fragment, memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiffLine as DomainLine,
  FileChange,
  Hunk,
  MechanicalProof,
  PartId,
  UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../../src/domain/review/index.ts";
import { RISK_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { StatusBadge } from "../../ui/status-badge.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { DiffLine } from "./diff-line.tsx";
import { FilePath, FileStatusChip, UnchangedUses } from "./file-path.tsx";
import { hunkLocation, lineCounts } from "./lines.ts";
import { viewLines } from "./rows.ts";
import { useHunkTokens, useNearViewport } from "./syntax.ts";

/** Where a comment on a hunk goes: a head-side ("new") or base-side ("old") line. */
export interface LinePlace {
  readonly side: "new" | "old";
  readonly line: number;
}

/** A comment the reviewer is writing on one line of this hunk. */
export interface LineComment extends LinePlace {
  readonly body: string;
}

/** Comments go on a deleted line's old number, and on any other line's new one. */
export const commentPlace = (
  line: Pick<DomainLine, "kind" | "oldLine" | "newLine">,
): LinePlace | null =>
  line.kind === "del"
    ? line.oldLine === null
      ? null
      : { side: "old", line: line.oldLine }
    : line.newLine === null
      ? null
      : { side: "new", line: line.newLine };

/** A hunk to show, with its file and risk; a mechanical one has proofs and shows collapsed. */
export interface HunkItem {
  readonly hunk: Hunk;
  readonly file: FileChange;
  readonly risk: RiskAssessment;
  readonly proofs?: readonly MechanicalProof[];
}

const samePlace = (a: LinePlace, b: LinePlace) => a.side === b.side && a.line === b.line;

const placeLabel = (place: LinePlace) =>
  `Comment on ${place.side === "old" ? "old " : ""}line ${place.line}`;

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const RISK_BAR = {
  contract: "bg-risk-contract-solid",
  logic: "bg-risk-logic-solid",
  mechanical: "bg-risk-mechanical-solid",
} as const;

export interface HunkCardProps {
  /** The part this card shows, which its callbacks name; the hunk's ID when it isn't split. */
  readonly id?: PartId;
  readonly hunk: Hunk;
  readonly file: FileChange;
  readonly risk: RiskAssessment | null;
  /** Mechanical proofs, shown in the header. */
  readonly proofs?: readonly MechanicalProof[];
  readonly highlighted?: boolean;
  /** Scrolls the card into view and focuses it. */
  readonly focused?: boolean;
  readonly onFocus?: (id: PartId) => void;
  /** Shows this many lines at first, with a button for the rest. */
  readonly lineLimit?: number;
  /** Uses outside the pull request of the definitions this part changes. */
  readonly unchanged?: readonly UnchangedCallers[];
  /** The reviewer's comments on this hunk's lines; without `onComment` they're read-only. */
  readonly comments?: readonly LineComment[];
  /** The line whose comment box is open and focused, if it's in this hunk. */
  readonly openComment?: LinePlace | null;
  readonly onOpenComment?: (id: PartId, place: LinePlace | null) => void;
  readonly onComment?: (id: PartId, comment: LineComment) => void;
  /** Shown between the header and the lines, e.g. the decisions resting on this hunk. */
  readonly afterHeader?: ReactNode;
  /**
   * One of several parts on a file's card, which names the file: the header shows only a proof,
   * and the risk is the color of a bar beside the lines.
   */
  readonly inFile?: boolean;
}

/** One hunk, or one part of a split hunk: its file, place and risk when alone, and its lines. */
export const HunkCard = memo(function HunkCard({
  id: givenId,
  hunk,
  file,
  risk,
  proofs = [],
  highlighted = false,
  focused = false,
  onFocus,
  lineLimit,
  unchanged = [],
  comments = [],
  openComment = null,
  onOpenComment,
  onComment,
  afterHeader,
  inFile = false,
}: HunkCardProps) {
  const id = givenId ?? hunk.id;
  const ref = useRef<HTMLElement>(null);
  const [showAll, setShowAll] = useState(false);
  // Far from the viewport a card isn't highlighted yet, so a long PR opens fast.
  const near = useNearViewport(ref);
  const tokens = useHunkTokens(hunk, file, near);
  const lines = useMemo(() => viewLines(hunk, tokens), [hunk, tokens]);
  const shown =
    lineLimit === undefined || showAll || lines.length <= lineLimit
      ? lines
      : lines.slice(0, lineLimit);

  useEffect(() => {
    const card = ref.current;
    if (!focused || card === null || card.contains(document.activeElement)) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: "start" });
  }, [focused]);

  const counts = lineCounts(hunk);
  const header = !inFile || proofs.length > 0;
  const commentable = onOpenComment !== undefined && onComment !== undefined;
  return (
    <section
      ref={ref}
      data-slot="hunk-card"
      data-risk={risk?.riskClass}
      data-highlighted={highlighted || undefined}
      className={cn(
        "relative scroll-mt-24 bg-card -outline-offset-2",
        !inFile && "overflow-hidden rounded-lg border",
        // The selected decision's code: a tint and an inset bar, not only a color.
        highlighted && "bg-primary/5 shadow-[inset_0_0_0_2px_var(--ring)]",
      )}
      aria-label={`${file.path}, ${hunkLocation(hunk)}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a card is focused to select its hunk.
      tabIndex={0}
      onFocus={() => onFocus?.(id)}
    >
      {inFile && risk !== null && (
        <span
          data-slot="part-risk"
          data-risk={risk.riskClass}
          className={cn("absolute inset-y-0 left-0 z-[2] w-1", RISK_BAR[risk.riskClass])}
        >
          <span className="sr-only">{risk.riskClass}</span>
        </span>
      )}
      {header && (
        <header
          data-slot="hunk-header"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface-subtle px-3 py-1.5"
        >
          {!inFile && (
            <>
              <FilePath file={file} />
              <FileStatusChip status={file.status} />
              {hunk.sectionHeading !== null && (
                <code className="font-mono text-code-compact text-diff-hunk-fg">
                  {hunk.sectionHeading}
                </code>
              )}
              <span className="tabular font-mono text-code-compact">
                <span className="text-diff-add-fg">+{counts.added}</span>{" "}
                <span className="text-diff-del-fg">−{counts.deleted}</span>
              </span>
            </>
          )}
          {proofs.map((proof) => (
            <span key={proof.kind} className="text-caption text-review-approved">
              <span aria-hidden="true">✓ </span>
              {proof.detail}
            </span>
          ))}
          {!inFile && risk !== null && (
            <span className="ml-auto" title={risk.reason === "" ? undefined : risk.reason}>
              <StatusBadge status={RISK_STATUS[risk.riskClass]} />
              {risk.reason !== "" && <span className="sr-only">: {risk.reason}</span>}
            </span>
          )}
        </header>
      )}
      {unchanged.map((one) => (
        <UnchangedUses key={one.symbol} callers={one} named={unchanged.length > 1} />
      ))}
      {afterHeader}
      <div
        role="table"
        aria-label="Lines"
        className="overflow-x-auto [content-visibility:auto]"
        // Off screen, the lines are as tall as they will be, so the scrollbar doesn't jump.
        style={{ containIntrinsicSize: `auto ${shown.length * 20}px` }}
      >
        <div className="w-max min-w-full">
          {shown.map((line) => {
            const place = commentPlace({
              kind: line.kind,
              oldLine: line.oldNo,
              newLine: line.newNo,
            });
            const comment =
              place === null ? undefined : comments.find((one) => samePlace(one, place));
            const open = place !== null && openComment !== null && samePlace(openComment, place);
            return (
              <Fragment key={line.key}>
                <DiffLine
                  line={line}
                  cellRole="cell"
                  numberButton={
                    place === null || !commentable
                      ? undefined
                      : {
                          side: place.side,
                          label: placeLabel(place),
                          onClick: () => onOpenComment?.(id, place),
                        }
                  }
                />
                {place !== null && (comment !== undefined || open) && (
                  <CommentRow
                    place={place}
                    body={comment?.body ?? ""}
                    focus={open}
                    onChange={
                      onComment === undefined
                        ? undefined
                        : (body) => onComment(id, { ...place, body })
                    }
                    onDone={() => onOpenComment?.(id, null)}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      {shown.length < lines.length && (
        <div className="border-t p-2">
          <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
            Show all {lines.length} lines
          </Button>
        </div>
      )}
    </section>
  );
});

/** The comment box under a line: a draft saved as it's typed, removed when emptied. */
const CommentRow = ({
  place,
  body,
  focus,
  onChange,
  onDone,
}: {
  readonly place: LinePlace;
  readonly body: string;
  readonly focus: boolean;
  readonly onChange?: (body: string) => void;
  readonly onDone: () => void;
}) => {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focus) field.current?.focus();
  }, [focus]);
  const label = placeLabel(place);
  return (
    <div
      role="row"
      data-slot="line-comment"
      className="border-y border-l-3 border-l-review-pending bg-thread-bg px-3 py-2 font-sans"
    >
      <div role="cell">
        {onChange === undefined ? (
          <p className="text-body whitespace-pre-wrap">
            <span className="sr-only">{label}: </span>
            {body}
          </p>
        ) : (
          <Textarea
            ref={field}
            rows={2}
            aria-label={label}
            placeholder="What should change here?"
            value={body}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onDone}
            onKeyDown={(event) => {
              // Esc leaves the box without leaving the page's view.
              if (event.key === "Escape") {
                event.stopPropagation();
                field.current?.blur();
              }
            }}
            className="min-h-14 max-w-3xl bg-background"
          />
        )}
      </div>
    </div>
  );
};
