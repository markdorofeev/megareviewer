import "./diff.css";
import { Fragment, memo, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type FileChange,
  type Hunk,
  isTestFile,
  type MechanicalProof,
  type PartId,
  type UnchangedCallers,
} from "../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../src/domain/review/index.ts";
import { type CharRange, intraLineChanges } from "./intra-line.ts";
import { type DisplayLine, displayLines, hunkLocation, lineCounts } from "./lines.ts";
import { RiskBadge } from "./RiskBadge.tsx";
import { type CodeToken, plainTokens, type Segment, segmentLine } from "./tokens.ts";
import { useHighlighter, useNearViewport } from "./useHighlighter.ts";

declare module "react" {
  interface CSSProperties {
    /** A token's light and dark theme colors; diff.css picks one. */
    "--token-light"?: string;
    "--token-dark"?: string;
  }
}

const MARKERS = { context: " ", add: "+", del: "-" } as const;

/** --line-height-code in tokens.css. */
const LINE_HEIGHT_PX = 20;

export const FileStatusBadge = ({ status }: { readonly status: FileChange["status"] }) => (
  <span className={`file-status status-${status}`}>{status}</span>
);

/** A path with its directory muted, so the file's name stands out and its place still shows. */
const SplitPath = ({ path }: { readonly path: string }) => {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <>
      {cut > 0 && <span className="file-directory">{path.slice(0, cut)}</span>}
      <span className="file-name">{path.slice(cut)}</span>
    </>
  );
};

export const FilePath = ({ file }: { readonly file: Pick<FileChange, "path" | "oldPath"> }) => (
  <span className="file-path">
    {file.oldPath !== null && file.oldPath !== file.path ? (
      <>
        {file.oldPath} <span aria-hidden="true">→</span>
        <span className="visually-hidden">renamed to</span> <SplitPath path={file.path} />
      </>
    ) : (
      <SplitPath path={file.path} />
    )}
  </span>
);

const places = (count: number, noun: "place" | "test"): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * "Used unchanged in 3 places and 1 test": code outside the pull request that calls what this part
 * changes, where a regression would show. A click lists each use with the lines around it.
 */
const UnchangedUses = ({
  callers,
  named,
}: {
  readonly callers: UnchangedCallers;
  /** Name the definition, when the part changes several that have callers. */
  readonly named: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { uses, more } = callers;
  const tests = uses.filter((use) => isTestFile(use.path)).length;
  const code = uses.length - tests;
  const counts = [
    ...(code > 0 ? [places(code, "place")] : []),
    ...(tests > 0 ? [places(tests, "test")] : []),
  ];
  const summary = `${counts.join(" and ")}${more > 0 ? `, and ${more} more` : ""}`;
  return (
    <div className="hunk-unchanged">
      <p className="hunk-outside">
        <button
          type="button"
          className="link-button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
        >
          {named && (
            <>
              <code>{callers.symbol}</code>{" "}
            </>
          )}
          {named ? "used" : "Used"} unchanged in {summary}
        </button>
      </p>
      {open && (
        <ul id={listId} className="unchanged-uses">
          {uses.map((use) => (
            <li key={`${use.path}:${use.line}`}>
              <p className="unchanged-place">
                <span className="unchanged-path">{use.path}</span>:{use.line}
                {use.use === "type" && <span className="unchanged-kind"> type</span>}
              </p>
              <pre className="unchanged-excerpt">
                {use.excerpt.lines.map((text, at) => {
                  const line = use.excerpt.start + at;
                  return (
                    <span
                      key={line}
                      className={line === use.line ? "unchanged-line used" : "unchanged-line"}
                    >
                      <span className="unchanged-number">{line}</span>
                      {text}
                    </span>
                  );
                })}
              </pre>
            </li>
          ))}
          {more > 0 && <li className="muted">and {more} more</li>}
        </ul>
      )}
    </div>
  );
};

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
export const commentPlace = (line: DisplayLine["line"]): LinePlace | null =>
  line.kind === "del"
    ? line.oldLine === null
      ? null
      : { side: "old", line: line.oldLine }
    : line.newLine === null
      ? null
      : { side: "new", line: line.newLine };

const samePlace = (a: LinePlace, b: LinePlace) => a.side === b.side && a.line === b.line;

/** One hunk, or one part of a split hunk: a header with its file, place and risk, and its lines. */
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
  note,
}: {
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
   * One of several parts on a file's card, which names the file: the header is one line, and the
   * risk is the color of a bar beside the lines.
   */
  readonly inFile?: boolean;
  /**
   * What the divider says of a contract part, when it isn't the risk's reason: only what the code
   * doesn't show. Empty, no divider for it; the bar beside the lines still gives the reason.
   */
  readonly note?: string;
}) {
  const id = givenId ?? hunk.id;
  const ref = useRef<HTMLElement>(null);
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => displayLines(hunk.lines), [hunk]);
  const changes = useMemo(
    () => intraLineChanges(lines.map(({ line, text }) => ({ kind: line.kind, text }))),
    [lines],
  );
  // Far from the viewport a card isn't highlighted yet, so a long PR opens fast.
  const near = useNearViewport(ref);
  const tokens = useHighlighter(hunk, file, near);
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
  // On a file's card the gutter numbers the lines, the code names what they define and the
  // card holds the file's other parts, so a part's divider shows only why it's contract, past what
  // the file's header and its own lines say. A part without such a reason has none.
  const reason = note ?? risk?.reason ?? "";
  const showsReason = risk?.riskClass === "contract" && reason !== "";
  const dividerShows = proofs.length > 0 || showsReason;
  const classes = [
    "hunk-card",
    inFile && "in-file",
    highlighted && "highlighted",
    risk && `risk-${risk.riskClass}`,
  ];
  return (
    <section
      ref={ref}
      className={classes.filter(Boolean).join(" ")}
      aria-label={`${file.path}, ${hunkLocation(hunk)}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a card is focused to select its hunk.
      tabIndex={0}
      onFocus={() => onFocus?.(id)}
    >
      {inFile && risk !== null && (
        <span className={`part-risk risk-${risk.riskClass}`} title={risk.reason}>
          <span className="visually-hidden">
            {risk.riskClass}: {risk.reason}
          </span>
        </span>
      )}
      {(!inFile || dividerShows) && (
        <header className="hunk-header">
          {!inFile && (
            <>
              <FilePath file={file} />
              <FileStatusBadge status={file.status} />
            </>
          )}
          {!inFile && hunk.sectionHeading !== null && (
            <code className="hunk-heading">{hunk.sectionHeading}</code>
          )}
          {!inFile && (
            <span className="hunk-counts">
              <span className="count-added">+{counts.added}</span>{" "}
              <span className="count-deleted">−{counts.deleted}</span>
            </span>
          )}
          {proofs.map((proof) => (
            <span key={proof.kind} className="hunk-proof" title="Mechanical proof">
              ✓ {proof.detail}
            </span>
          ))}
          {showsReason && <span className="hunk-contract-reason model-text">{reason}</span>}
          {!inFile && risk !== null && <RiskBadge risk={risk} />}
        </header>
      )}
      {unchanged.map((one) => (
        <UnchangedUses key={one.symbol} callers={one} named={unchanged.length > 1} />
      ))}
      {afterHeader}
      <div
        className="hunk-body"
        // Off screen, the lines are as tall as they will be, so the scrollbar doesn't jump.
        style={{ containIntrinsicSize: `auto ${shown.length * LINE_HEIGHT_PX}px` }}
      >
        <table className="diff-table">
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Old line</th>
              <th scope="col">New line</th>
              <th scope="col">Change</th>
              <th scope="col">Code</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((line, i) => {
              const place = commentPlace(line.line);
              const comment =
                place === null ? undefined : comments.find((one) => samePlace(one, place));
              const open = place !== null && openComment !== null && samePlace(openComment, place);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines don't move within a hunk.
                <Fragment key={i}>
                  <Line
                    line={line}
                    tokens={tokens?.[i] ?? null}
                    changed={changes.get(i) ?? null}
                    onNumber={
                      place === null || onOpenComment === undefined || onComment === undefined
                        ? undefined
                        : () => onOpenComment(id, place)
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
          </tbody>
        </table>
      </div>
      {shown.length < lines.length && (
        <button type="button" className="button show-all" onClick={() => setShowAll(true)}>
          Show all {lines.length} lines
        </button>
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
  const label = `Comment on ${place.side === "old" ? "old " : ""}line ${place.line}`;
  return (
    <tr className="line-comment">
      <td colSpan={4}>
        {onChange === undefined ? (
          <p className="posted-text">
            <span className="visually-hidden">{label}: </span>
            {body}
          </p>
        ) : (
          <textarea
            ref={field}
            className="input"
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
          />
        )}
      </td>
    </tr>
  );
};

const Line = memo(function Line({
  line: { line, text, carriageReturn },
  tokens,
  changed,
  onNumber,
}: {
  readonly line: DisplayLine;
  readonly tokens: readonly CodeToken[] | null;
  readonly changed: readonly CharRange[] | null;
  /** Opens a comment on this line, from its line number. */
  readonly onNumber?: () => void;
}) {
  const Changed = line.kind === "del" ? "del" : "ins";
  const number = (value: number | null, side: "old" | "new") =>
    value !== null && onNumber !== undefined && (side === "old") === (line.kind === "del") ? (
      <button
        type="button"
        className="line-number-button"
        aria-label={`Comment on ${side === "old" ? "old " : ""}line ${value}`}
        onClick={onNumber}
      >
        {value}
      </button>
    ) : (
      value
    );
  return (
    <tr className={`diff-line line-${line.kind}`}>
      <td className="line-number">{number(line.oldLine, "old")}</td>
      <td className="line-number">{number(line.newLine, "new")}</td>
      <td className="line-marker">{MARKERS[line.kind]}</td>
      <td className="line-code">
        {segmentLine(tokens ?? plainTokens(text), changed ?? []).map((segment, i) => (
          <Code
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's segments are rebuilt together.
            key={i}
            segment={segment}
            Changed={Changed}
          />
        ))}
        {carriageReturn && (
          <span className="line-note" title="This line ends in CRLF">
            CRLF
          </span>
        )}
        {line.noNewlineAtEnd && <span className="line-note">No newline at end of file</span>}
      </td>
    </tr>
  );
});

/** One segment of a line, in its token's colors, marked when it's inside an intra-line change. */
const Code = ({
  segment,
  Changed,
}: {
  readonly segment: Segment;
  readonly Changed: "del" | "ins";
}) => {
  const className = [
    "token",
    segment.italic && "italic",
    segment.bold && "bold",
    segment.changed && "changed",
  ]
    .filter(Boolean)
    .join(" ");
  const style =
    segment.light === null && segment.dark === null
      ? undefined
      : { "--token-light": segment.light ?? undefined, "--token-dark": segment.dark ?? undefined };
  const Element = segment.changed ? Changed : "span";
  return (
    <Element className={className} style={style}>
      {segment.text}
    </Element>
  );
};
