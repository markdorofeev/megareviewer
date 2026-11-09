import type { Analysis } from "../../../../src/domain/review/index.ts";

const HEADING = /^#{1,6}\s+/;

export const plainIntent = (text: string): string =>
  text
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2")
    .replace(/(`+)(.*?)\1/g, "$2")
    .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\\([\\`*_{}[\]()#+.!>-])/g, "$1");

/**
 * The description's first line of prose. Markdown headings such as "## What changed" name a part
 * of the description rather than say what was asked, so they're skipped unless there's nothing else.
 */
export const firstLine = (text: string): string => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return plainIntent(
    lines.find((line) => !HEADING.test(line)) ?? lines[0]?.replace(HEADING, "") ?? "",
  );
};

/**
 * A sentence ends at a stop followed by a capital, a digit or an opening mark, so "e.g. this"
 * doesn't end one.
 */
const SENTENCE_END = /^(.+?[.!?])\s+(?=[A-Z0-9"'(`[])/;

/** The description's first sentence: its first line is often a whole paragraph. */
export const firstSentence = (text: string): string => {
  const line = firstLine(text);
  return SENTENCE_END.exec(line)?.[1] ?? line;
};

/**
 * The intent in one line under the title: the model's summary of what the code does, or without
 * the model, the description's first sentence. The Details button ends the line, so it reads as more of it. A red chip names a mismatch between what was asked and
 * what the code does, and goes to the code it rests on; the next click goes to the next one.
 */
export const IntentLine = ({
  analysis,
  modelOn,
  mismatchAt,
  onMismatch,
  onDetails,
}: {
  readonly analysis: Analysis;
  readonly modelOn: boolean;
  /** The mismatch the chip names. */
  readonly mismatchAt: number;
  readonly onMismatch: (index: number) => void;
  readonly onDetails: () => void;
}) => {
  const { intent, pullRequest } = analysis;
  const mismatches = intent?.mismatches ?? [];
  const at = mismatches.length === 0 ? 0 : mismatchAt % mismatches.length;
  const mismatch = mismatches[at];
  const description = pullRequest === null ? "" : firstSentence(pullRequest.description);

  return (
    <div className="intent-line">
      {intent !== null ? (
        <p className="intent-text">
          <span className={`intent-label${mismatches.length === 0 ? " agrees" : ""}`}>
            {mismatches.length > 0 || intent.stated === null
              ? "From the code:"
              : "✓ Does what was asked:"}
          </span>{" "}
          <span className="model-text">{plainIntent(intent.inferred.summary)}</span>
        </p>
      ) : modelOn && analysis.status === "running" ? (
        <p className="intent-text muted" aria-busy="true">
          Working out the intent…
        </p>
      ) : pullRequest !== null ? (
        <p className="intent-text">
          {description === "" ? (
            <span className="muted">The pull request has no description.</span>
          ) : (
            <span className="pr-description-line">{description}</span>
          )}
        </p>
      ) : null}
      {(intent !== null || pullRequest !== null) && (
        <button
          type="button"
          className="details-button"
          aria-label="Details"
          title="Details"
          onClick={onDetails}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 7.25v4" />
            <circle className="details-dot" cx="8" cy="4.9" r="0.4" />
          </svg>
        </button>
      )}
      {mismatch !== undefined && (
        <button
          type="button"
          className="mismatch-chip"
          title={mismatch.description}
          onClick={() => onMismatch(at)}
        >
          <span aria-hidden="true">⚠</span>
          <span className="mismatch-chip-text model-text">{mismatch.description}</span>
          <span className="mismatch-chip-count">
            {at + 1} of {mismatches.length}
          </span>
        </button>
      )}
    </div>
  );
};
