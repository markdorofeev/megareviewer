import {
  Fragment,
  type MouseEvent,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DiffLine as DomainLine,
  FileChange,
  Hunk,
  MechanicalProof,
  PartId,
  UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import {
  parseBody,
  type RiskAssessment,
  type Severity,
} from "../../../../src/domain/review/index.ts";
import { RISK_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { StatusBadge } from "../../ui/status-badge.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { Toggle } from "../../ui/toggle.tsx";
import { KeyHint } from "../shell/key-hint.tsx";
import { CHIP, CommentCard, SeverityChip, SuggestionDiff, ThreadBody } from "../thread/index.ts";
import { DiffLine } from "./diff-line.tsx";
import { FilePath, FileStatusChip, UnchangedUses } from "./file-path.tsx";
import { languageOf } from "./languages.ts";
import { hunkLocation, lineCounts } from "./lines.ts";
import { viewLines } from "./rows.ts";
import { useHunkTokens, useNearViewport } from "./syntax.ts";

/**
 * Where a comment on a hunk goes: a head-side ("new") or base-side ("old") line, or the lines from
 * `startLine` to `line`.
 */
export interface LinePlace {
  readonly side: "new" | "old";
  readonly line: number;
  readonly startLine?: number;
}

/** A comment the reviewer is writing on lines of this hunk. */
export interface LineComment extends LinePlace {
  readonly body: string;
  readonly severity?: Severity;
  /** The lines that replace the commented ones. */
  readonly suggestion?: readonly string[];
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

/**
 * Keeps a row that isn't a line, such as a divider or a button, at the visible width of a file
 * card's lines, which scroll sideways together inside an `@container`.
 */
export const PINNED = "sticky left-0 w-[100cqw]";

/** A hunk to show, with its file and risk; a mechanical one has proofs and shows collapsed. */
export interface HunkItem {
  readonly hunk: Hunk;
  readonly file: FileChange;
  readonly risk: RiskAssessment;
  readonly proofs?: readonly MechanicalProof[];
}

const samePlace = (a: LinePlace, b: LinePlace) => a.side === b.side && a.line === b.line;

const placeLabel = (place: LinePlace) =>
  place.startLine === undefined
    ? `Comment on ${place.side === "old" ? "old " : ""}line ${place.line}`
    : `Comment on ${place.side === "old" ? "old " : ""}lines ${place.startLine}–${place.line}`;

/** The new-side text of lines `start` to `end` that a hunk shows, or null if it misses one. */
const linesShown = (hunk: Hunk, start: number, end: number): readonly string[] | null => {
  const texts = new Map(
    hunk.lines.flatMap((line) =>
      line.kind !== "del" && line.newLine !== null ? [[line.newLine, line.text] as const] : [],
    ),
  );
  const lines: string[] = [];
  for (let at = start; at <= end; at += 1) {
    const text = texts.get(at);
    if (text === undefined) return null;
    lines.push(text);
  }
  return lines;
};

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
  /** The host's threads on a line, shown under it. */
  readonly threadsAt?: (place: LinePlace) => ReactNode;
  /** Said in the comment box when a range is chosen, e.g. that a host can't anchor one. */
  readonly rangeNote?: string;
  /**
   * One of several parts on a file's card, which names the file and counts its contract parts:
   * the header shows only a proof, and the part shows no risk of its own.
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
  threadsAt,
  rangeNote,
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
  /**
   * Opens the comment box on a line, or closes it when it was open there. ⇧ extends the open
   * comment into a range on the same side.
   */
  const toggleComment = (place: LinePlace, extend: boolean) => {
    const from = openComment;
    if (from !== null && from.side === place.side && from.line === place.line) {
      onOpenComment?.(id, null);
      return;
    }
    if (extend && from !== null && from.side === place.side) {
      const first = Math.min(from.startLine ?? from.line, place.line);
      const last = Math.max(from.line, place.line);
      onOpenComment?.(id, { side: place.side, line: last, startLine: first });
      return;
    }
    onOpenComment?.(id, place);
  };
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
      {header && (
        <header
          data-slot="hunk-header"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface-subtle px-3 py-1.5",
            inFile && PINNED,
          )}
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
      {(unchanged.length > 0 || afterHeader != null) && (
        <div className={cn(inFile && PINNED)}>
          {unchanged.map((one) => (
            <UnchangedUses key={one.symbol} callers={one} named={unchanged.length > 1} />
          ))}
          {afterHeader}
        </div>
      )}
      <div
        role="table"
        aria-label="Lines"
        // On a file's card the card scrolls its lines sideways, all of them together.
        className={cn("[content-visibility:auto]", !inFile && "overflow-x-auto")}
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
            const commentAt = open ? openComment : comment;
            const threads = place === null ? null : (threadsAt?.(place) ?? null);
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
                          onClick: (event) => toggleComment(place, event.shiftKey),
                        }
                  }
                  {...(place === null || !commentable
                    ? {}
                    : {
                        onRowClick: (event: MouseEvent<HTMLDivElement>) => {
                          // Selecting code isn't asking to comment.
                          if (window.getSelection()?.isCollapsed === false) return;
                          // The line number's own click already handled it.
                          if (event.target instanceof Element && event.target.closest("button"))
                            return;
                          toggleComment(place, event.shiftKey);
                        },
                      })}
                />
                {place !== null &&
                  commentAt != null &&
                  (comment !== undefined || (open && onComment !== undefined)) && (
                    <CommentRow
                      place={commentAt}
                      comment={comment}
                      editing={open && onComment !== undefined}
                      shown={(start, end) => linesShown(hunk, start, end)}
                      language={languageOf(file)}
                      rangeNote={rangeNote}
                      onChange={
                        onComment === undefined
                          ? undefined
                          : (next) =>
                              onComment(id, {
                                side: commentAt.side,
                                line: commentAt.line,
                                ...(commentAt.startLine === undefined
                                  ? {}
                                  : { startLine: commentAt.startLine }),
                                ...next,
                              })
                      }
                      onEdit={() =>
                        onOpenComment?.(id, {
                          side: commentAt.side,
                          line: commentAt.line,
                          ...(commentAt.startLine === undefined
                            ? {}
                            : { startLine: commentAt.startLine }),
                        })
                      }
                      onDone={() => onOpenComment?.(id, null)}
                      pinned={inFile}
                    />
                  )}
                {threads !== null && (
                  <div
                    role="row"
                    data-slot="line-threads"
                    className={cn("px-3 py-2 font-sans", inFile && PINNED)}
                  >
                    <div role="cell" className="flex max-w-3xl flex-col gap-2">
                      {threads}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      {shown.length < lines.length && (
        <div className={cn("border-t p-2", inFile && PINNED)}>
          <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
            Show all {lines.length} lines
          </Button>
        </div>
      )}
    </section>
  );
});

/** What the comment box keeps: the text, a severity from before the box lost its picker, and the suggested lines. */
type CommentDraft = Pick<LineComment, "body" | "severity" | "suggestion">;

/**
 * A draft under a line, in one of two states. Editing: its text, saved as it's typed, and on
 * head-side lines a suggested change, starting from the lines it's on.
 * Saved: the draft as its comment will read, with Edit and Discard. It stays open while the reviewer
 * selects code, and closes on Add comment, Cancel, Esc, Discard or a click on its own line.
 */
const CommentRow = ({
  place,
  comment,
  editing,
  shown,
  language,
  rangeNote,
  onChange,
  onEdit,
  onDone,
  pinned,
}: {
  readonly place: LinePlace;
  readonly comment: LineComment | undefined;
  readonly editing: boolean;
  /** The text of head-side lines the hunk shows, to start a suggestion from. */
  readonly shown: (start: number, end: number) => readonly string[] | null;
  readonly language: string | null;
  readonly rangeNote: string | undefined;
  readonly onChange?: (draft: CommentDraft) => void;
  readonly onEdit: () => void;
  readonly onDone: () => void;
  /** On a file's card, where the lines scroll sideways and the box stays in view. */
  readonly pinned: boolean;
}) => {
  const row = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const label = placeLabel(place);
  const body = comment?.body ?? "";
  const severity = comment?.severity;
  const suggestion = comment?.suggestion;
  const draft: CommentDraft = {
    body,
    ...(severity === undefined ? {} : { severity }),
    ...(suggestion === undefined ? {} : { suggestion }),
  };
  const startingLines =
    place.side === "new" ? shown(place.startLine ?? place.line, place.line) : null;
  const range = place.startLine === undefined ? null : `Lines ${place.startLine}–${place.line}`;

  /** The focus goes back to the card the box was on, which takes the page's keys. */
  const leave = () =>
    row.current?.closest<HTMLElement>("[data-slot=hunk-card]")?.focus({ preventScroll: true });
  const discard = () => {
    if (editing) leave();
    onChange?.({ body: "" });
    if (editing) onDone();
  };
  // The text is saved as it's typed, so closing keeps it; a draft with nothing to say goes.
  const close = () => {
    leave();
    if (body.trim() === "" && suggestion === undefined) onChange?.({ body: "" });
    onDone();
  };

  const preview = (lines: readonly string[]) => (
    <SuggestionDiff
      title="Suggested change"
      removed={startingLines}
      added={lines}
      language={language}
    />
  );

  return (
    <div
      ref={row}
      role="row"
      data-slot="line-comment"
      data-editing={editing || undefined}
      className={cn("px-3 py-2 font-sans", pinned && PINNED)}
    >
      <CommentCard
        role="cell"
        state="draft"
        className="flex max-w-3xl flex-col gap-2"
        onKeyDown={
          editing
            ? (event) => {
                // Esc closes the box without leaving the page's view.
                if (event.key !== "Escape") return;
                event.stopPropagation();
                close();
              }
            : undefined
        }
      >
        {!editing ? (
          <>
            <header className="flex flex-wrap items-center gap-2">
              <span className="sr-only">{label}: </span>
              <span
                className={cn(
                  CHIP,
                  "border-review-pending/25 bg-review-pending-bg text-review-pending",
                )}
              >
                {onChange === undefined
                  ? "Posted with your review"
                  : "Draft · posts with your review"}
              </span>
              {severity !== undefined && <SeverityChip severity={severity} />}
              {range !== null && (
                <span className="text-caption text-muted-foreground">{range}</span>
              )}
            </header>
            {body.trim() !== "" && (
              <ThreadBody blocks={parseBody(body).blocks} suggestion={preview} />
            )}
            {suggestion !== undefined && preview(suggestion)}
            {onChange !== undefined && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onEdit}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={discard}>
                  Discard
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {range !== null && (
              <p className="text-caption text-muted-foreground">
                {range}
                {rangeNote === undefined ? "" : `. ${rangeNote}`}
              </p>
            )}
            <Textarea
              ref={field}
              rows={2}
              aria-label={label}
              placeholder="Leave a comment"
              value={body}
              onChange={(event) => onChange?.({ ...draft, body: event.target.value })}
              onSubmitShortcut={close}
              className="min-h-14 bg-background"
            />
            {place.side === "new" && (
              <div className="flex flex-wrap items-center gap-2">
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={suggestion !== undefined}
                  onPressedChange={(pressed) => {
                    const { suggestion: _, ...rest } = draft;
                    onChange?.(pressed ? { ...rest, suggestion: startingLines ?? [""] } : rest);
                  }}
                >
                  Suggest a change
                </Toggle>
              </div>
            )}
            {suggestion !== undefined && (
              <>
                <Textarea
                  aria-label="Suggested lines"
                  value={suggestion.join("\n")}
                  onChange={(event) =>
                    onChange?.({ ...draft, suggestion: event.target.value.split("\n") })
                  }
                  className="min-h-14 bg-background font-mono text-code-compact"
                />
                {preview(suggestion)}
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={close}>
                Add comment
                <KeyHint id="submit" />
              </Button>
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
                <KeyHint id="close" />
              </Button>
              <Button variant="ghost" size="sm" onClick={discard}>
                Discard
              </Button>
            </div>
          </>
        )}
      </CommentCard>
    </div>
  );
};
