import type { Analysis } from "../../../../src/domain/review/index.ts";

const HEADING = /^#{1,6}\s+/;

/**
 * The description's first line of prose. Markdown headings such as "## What changed" name a part
 * of the description rather than say what was asked, so they're skipped unless there's nothing else.
 */
export const firstLine = (text: string): string => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.find((line) => !HEADING.test(line)) ?? lines[0]?.replace(HEADING, "") ?? "";
};

/**
 * The intent in one line under the title: the model's summary of what the code does, or without
 * the model, the description's first line. A red chip names a mismatch between what was asked and
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
  const description = pullRequest === null ? "" : firstLine(pullRequest.description);

  return (
    <div className="intent-line">
      {intent !== null ? (
        <p className="intent-text">
          <span className={`intent-label${mismatches.length === 0 ? " agrees" : ""}`}>
            {mismatches.length > 0 || intent.stated === null
              ? "From the code:"
              : "✓ Does what was asked:"}
          </span>{" "}
          <span className="model-text">{intent.inferred.summary}</span>
        </p>
      ) : modelOn && analysis.status === "running" ? (
        <p className="intent-text muted" aria-busy="true">
          Working out the intent…
        </p>
      ) : pullRequest !== null ? (
        <p className="intent-text">
          <span className="intent-label">Asked:</span>{" "}
          {description === "" ? (
            <span className="muted">The pull request has no description.</span>
          ) : (
            <span className="pr-description-line">{description}</span>
          )}
        </p>
      ) : null}
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
      {(intent !== null || pullRequest !== null) && (
        <button type="button" className="button quiet details-button" onClick={onDetails}>
          Details
        </button>
      )}
    </div>
  );
};
