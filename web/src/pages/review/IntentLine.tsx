import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";

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
  intentComing,
  mismatchAt,
  onMismatch,
  onDetails,
  children,
}: {
  readonly analysis: Analysis;
  /** The model is running and hasn't given the intent yet. */
  readonly intentComing: boolean;
  /** The mismatch the chip names. */
  readonly mismatchAt: number;
  readonly onMismatch: (index: number) => void;
  readonly onDetails: () => void;
  /** After the Details button: what asks Claude for the intent, or says how that went. */
  readonly children?: ReactNode;
}) => {
  const { intent, pullRequest } = analysis;
  const mismatches = intent?.mismatches ?? [];
  const at = mismatches.length === 0 ? 0 : mismatchAt % mismatches.length;
  const mismatch = mismatches[at];
  const description = pullRequest === null ? "" : firstSentence(pullRequest.description);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body">
      {intent !== null ? (
        <p className="min-w-0">
          <span
            className={mismatches.length === 0 ? "font-medium text-review-approved" : "font-medium"}
          >
            {mismatches.length > 0 || intent.stated === null
              ? "From the code:"
              : "✓ Does what was asked:"}
          </span>{" "}
          <span data-slot="model-text" className="whitespace-pre-line">
            {plainIntent(intent.inferred.summary)}
          </span>
        </p>
      ) : intentComing ? (
        <p className="text-muted-foreground" aria-busy="true">
          Working out the intent…
        </p>
      ) : pullRequest !== null ? (
        <p className="min-w-0">
          {description === "" ? (
            <span className="text-muted-foreground">The pull request has no description.</span>
          ) : (
            <span>{description}</span>
          )}
        </p>
      ) : null}
      {(intent !== null || pullRequest !== null) && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Details"
          title="Details"
          onClick={onDetails}
          className="rounded-full text-muted-foreground"
        >
          <InfoIcon aria-hidden="true" />
        </Button>
      )}
      {children}
      {mismatch !== undefined && (
        <button
          type="button"
          data-slot="mismatch-chip"
          title={mismatch.description}
          onClick={() => onMismatch(at)}
          className="flex min-h-6 max-w-full items-center gap-1.5 rounded-full border border-review-changes/25 bg-review-changes-bg px-2 text-caption font-medium text-review-changes hover:border-review-changes"
        >
          <span aria-hidden="true">⚠</span>
          <span className="min-w-0 truncate">{mismatch.description}</span>
          <span className="tabular shrink-0 font-normal">
            {at + 1} of {mismatches.length}
          </span>
        </button>
      )}
    </div>
  );
};
