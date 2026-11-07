import "./diff.css";
import { Fragment, memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { FileChange, Hunk, HunkId, MechanicalProof } from "../../../src/domain/diff/index.ts";
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

export const FilePath = ({ file }: { readonly file: Pick<FileChange, "path" | "oldPath"> }) => (
  <span className="file-path">
    {file.oldPath !== null && file.oldPath !== file.path ? (
      <>
        {file.oldPath} <span aria-hidden="true">→</span>
        <span className="visually-hidden">renamed to</span> {file.path}
      </>
    ) : (
      file.path
    )}
  </span>
);

/** A file whose code calls this hunk, and its first hunk that does. */
export interface CallerFile {
  readonly path: string;
  readonly hunkId: HunkId;
  readonly test: boolean;
}

/** Part of a line shown by the caller, such as an underlined call: characters `start` to `end`. */
export interface LineMark {
  readonly start: number;
  readonly end: number;
  readonly render: (code: ReactNode) => ReactNode;
}

/** Each path's shortest tail of directories that no other path in the list shares. */
export const shortPaths = (paths: readonly string[]): string[] => {
  const parts = paths.map((path) => path.split("/"));
  return parts.map((segments) => {
    for (let take = 1; take < segments.length; take++) {
      const tail = segments.slice(-take).join("/");
      const shared = parts.filter((other) => other.slice(-take).join("/") === tail).length;
      if (shared <= 1) return tail;
    }
    return segments.join("/");
  });
};

const joined = (items: readonly ReactNode[]): ReactNode[] =>
  items.flatMap((item, at) => [at === 0 ? "" : at === items.length - 1 ? " and " : ", ", item]);

/** "Called from a.py, b.py and 2 tests": a link per file, tests counted until they're opened. */
const Callers = ({
  callers,
  onFollow,
}: {
  readonly callers: readonly CallerFile[];
  readonly onFollow: (id: HunkId) => void;
}) => {
  const [showTests, setShowTests] = useState(false);
  const names = shortPaths(callers.map((caller) => caller.path));
  const link = (caller: CallerFile, at: number) => (
    <button
      key={caller.path}
      type="button"
      className="hunk-link"
      title={caller.path}
      onClick={() => onFollow(caller.hunkId)}
    >
      {names[at]} ↑
    </button>
  );
  const code = callers.flatMap((caller, at) => (caller.test ? [] : [link(caller, at)]));
  const tests = callers.flatMap((caller, at) => (caller.test ? [link(caller, at)] : []));
  const testCount = (
    <button
      key="tests"
      type="button"
      className="link-button"
      aria-expanded={false}
      onClick={() => setShowTests(true)}
    >
      {tests.length === 1 ? "1 test" : `${tests.length} tests`}
    </button>
  );
  const shown = [...code, ...(tests.length === 0 ? [] : showTests ? tests : [testCount])];
  return (
    <p className="hunk-callers">
      <span className="hunk-callers-label">Called from</span> {joined(shown)}
    </p>
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

/** One hunk: a header with its file, place and risk, and its lines. */
export const HunkCard = memo(function HunkCard({
  hunk,
  file,
  risk,
  proofs = [],
  highlighted = false,
  focused = false,
  onFocus,
  lineLimit,
  callers = [],
  onFollow,
  reviewed,
  onReviewed,
  comments = [],
  openComment = null,
  onOpenComment,
  onComment,
  afterHeader,
  belowLine,
  inLine,
}: {
  readonly hunk: Hunk;
  readonly file: FileChange;
  readonly risk: RiskAssessment | null;
  /** Mechanical proofs, shown in the header. */
  readonly proofs?: readonly MechanicalProof[];
  readonly highlighted?: boolean;
  /** Scrolls the card into view and focuses it. */
  readonly focused?: boolean;
  readonly onFocus?: (id: HunkId) => void;
  /** Shows this many lines at first, with a button for the rest. */
  readonly lineLimit?: number;
  /** Files whose code calls this hunk, which `onFollow` goes to; calls show by `belowLine`. */
  readonly callers?: readonly CallerFile[];
  readonly onFollow?: (id: HunkId) => void;
  /** Whether the reviewer has read this hunk; without `onReviewed` there's no checkbox. */
  readonly reviewed?: boolean;
  readonly onReviewed?: (id: HunkId, reviewed: boolean) => void;
  /** The reviewer's comments on this hunk's lines; without `onComment` they're read-only. */
  readonly comments?: readonly LineComment[];
  /** The line whose comment box is open and focused, if it's in this hunk. */
  readonly openComment?: LinePlace | null;
  readonly onOpenComment?: (id: HunkId, place: LinePlace | null) => void;
  readonly onComment?: (id: HunkId, comment: LineComment) => void;
  /** Shown between the header and the lines, e.g. the decisions resting on this hunk. */
  readonly afterHeader?: ReactNode;
  /** Shown under the line with this new-side number, e.g. the calls it makes. */
  readonly belowLine?: ReadonlyMap<number, ReactNode>;
  /** Parts of the line with this new-side number to show differently, e.g. a call's symbol. */
  readonly inLine?: ReadonlyMap<number, readonly LineMark[]>;
}) {
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
  const classes = ["hunk-card", highlighted && "highlighted", risk && `risk-${risk.riskClass}`];
  return (
    <section
      ref={ref}
      className={classes.filter(Boolean).join(" ")}
      aria-label={`${file.path}, ${hunkLocation(hunk)}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a card is focused to select its hunk.
      tabIndex={0}
      onFocus={() => onFocus?.(hunk.id)}
    >
      <header className="hunk-header">
        <FilePath file={file} />
        <FileStatusBadge status={file.status} />
        {hunk.sectionHeading !== null && (
          <code className="hunk-heading">{hunk.sectionHeading}</code>
        )}
        <span className="hunk-counts">
          <span className="count-added">+{counts.added}</span>{" "}
          <span className="count-deleted">−{counts.deleted}</span>
        </span>
        {proofs.map((proof) => (
          <span key={proof.kind} className="hunk-proof" title="Mechanical proof">
            ✓ {proof.detail}
          </span>
        ))}
        {risk?.riskClass === "contract" && (
          <span className="hunk-contract-reason model-text">{risk.reason}</span>
        )}
        {risk !== null && <RiskBadge risk={risk} />}
        {onReviewed !== undefined && (
          <label className="hunk-reviewed">
            <input
              type="checkbox"
              checked={reviewed === true}
              onChange={(event) => onReviewed(hunk.id, event.target.checked)}
            />
            Reviewed
          </label>
        )}
      </header>
      {callers.length > 0 && onFollow !== undefined && (
        <Callers callers={callers} onFollow={onFollow} />
      )}
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
              const newLine = line.line.kind === "del" ? null : line.line.newLine;
              const below = newLine === null ? undefined : belowLine?.get(newLine);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines don't move within a hunk.
                <Fragment key={i}>
                  <Line
                    line={line}
                    tokens={tokens?.[i] ?? null}
                    changed={changes.get(i) ?? null}
                    marks={newLine === null ? undefined : inLine?.get(newLine)}
                    onNumber={
                      place === null || onOpenComment === undefined || onComment === undefined
                        ? undefined
                        : () => onOpenComment(hunk.id, place)
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
                          : (body) => onComment(hunk.id, { ...place, body })
                      }
                      onDone={() => onOpenComment?.(hunk.id, null)}
                    />
                  )}
                  {below !== undefined && (
                    <tr className="line-below">
                      <td colSpan={4}>{below}</td>
                    </tr>
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
  marks = [],
  onNumber,
}: {
  readonly line: DisplayLine;
  readonly tokens: readonly CodeToken[] | null;
  readonly changed: readonly CharRange[] | null;
  readonly marks?: readonly LineMark[];
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
        {markedCode(segmentLine(tokens ?? plainTokens(text), changed ?? [], marks), marks, Changed)}
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

/** A line's segments as elements, the ones inside a mark wrapped by its `render`. */
const markedCode = (
  segments: readonly Segment[],
  marks: readonly LineMark[],
  Changed: "del" | "ins",
): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let group: { mark: LineMark; code: ReactNode[] } | null = null;
  const flush = () => {
    if (group !== null) {
      nodes.push(
        <Fragment key={`mark-${group.mark.start}`}>{group.mark.render(group.code)}</Fragment>,
      );
    }
    group = null;
  };
  let offset = 0;
  segments.forEach((segment, i) => {
    const start = offset;
    offset += segment.text.length;
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
        : {
            "--token-light": segment.light ?? undefined,
            "--token-dark": segment.dark ?? undefined,
          };
    const Element = segment.changed ? Changed : "span";
    const element = (
      // biome-ignore lint/suspicious/noArrayIndexKey: a line's segments are rebuilt together.
      <Element key={i} className={className} style={style}>
        {segment.text}
      </Element>
    );
    const mark = marks.find((one) => start >= one.start && start < one.end);
    if (mark === undefined) {
      flush();
      nodes.push(element);
    } else if (group?.mark === mark) {
      group.code.push(element);
    } else {
      flush();
      group = { mark, code: [element] };
    }
  });
  flush();
  return nodes;
};
