import "./diff.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FileChange, Hunk, HunkId, MechanicalProof } from "../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../src/domain/review/index.ts";
import { type CharRange, intraLineChanges } from "./intra-line.ts";
import { type DisplayLine, displayLines, hunkLocation, hunkRanges } from "./lines.ts";
import { RiskBadge } from "./RiskBadge.tsx";
import { type CodeToken, plainTokens, segmentLine } from "./tokens.ts";
import { useHighlighter } from "./useHighlighter.ts";

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

/** Another hunk this one is linked to by the call graph. */
export interface HunkLink {
  readonly direction: "calls" | "called-by";
  readonly symbol: string;
  readonly hunkId: HunkId;
}

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
  links = [],
  onFollow,
  reviewed,
  onReviewed,
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
  /** Hunks this one calls or is called by, which `onFollow` goes to. */
  readonly links?: readonly HunkLink[];
  readonly onFollow?: (id: HunkId) => void;
  /** Whether the reviewer has read this hunk; without `onReviewed` there's no checkbox. */
  readonly reviewed?: boolean;
  readonly onReviewed?: (id: HunkId, reviewed: boolean) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => displayLines(hunk.lines), [hunk]);
  const changes = useMemo(
    () => intraLineChanges(lines.map(({ line, text }) => ({ kind: line.kind, text }))),
    [lines],
  );
  const tokens = useHighlighter(hunk, file);
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
        <span className="hunk-ranges">{hunkRanges(hunk)}</span>
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
      {links.length > 0 && onFollow !== undefined && (
        <ul className="hunk-links" aria-label="Call graph">
          {links.map((link) => (
            <li key={`${link.direction}:${link.symbol}:${link.hunkId}`}>
              <button type="button" className="hunk-link" onClick={() => onFollow(link.hunkId)}>
                {link.direction === "calls"
                  ? `calls ${link.symbol} ↓`
                  : `called by ${link.symbol} ↑`}
              </button>
            </li>
          ))}
        </ul>
      )}
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
            {shown.map((line, i) => (
              <Line
                // biome-ignore lint/suspicious/noArrayIndexKey: lines don't move within a hunk.
                key={i}
                line={line}
                tokens={tokens?.[i] ?? null}
                changed={changes.get(i) ?? null}
              />
            ))}
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

const Line = memo(function Line({
  line: { line, text, carriageReturn },
  tokens,
  changed,
}: {
  readonly line: DisplayLine;
  readonly tokens: readonly CodeToken[] | null;
  readonly changed: readonly CharRange[] | null;
}) {
  const Changed = line.kind === "del" ? "del" : "ins";
  return (
    <tr className={`diff-line line-${line.kind}`}>
      <td className="line-number">{line.oldLine}</td>
      <td className="line-number">{line.newLine}</td>
      <td className="line-marker">{MARKERS[line.kind]}</td>
      <td className="line-code">
        {segmentLine(tokens ?? plainTokens(text), changed ?? []).map((segment, i) => {
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
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's segments are rebuilt together.
            <Element key={i} className={className} style={style}>
              {segment.text}
            </Element>
          );
        })}
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
