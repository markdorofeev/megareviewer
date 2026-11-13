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
 * the model, the description's first sentence. The Details button ends the line, so it reads as
 * more of it. A mismatch between what was asked and what the code does is one of Claude's
 * points, on the code it rests on, rather than a chip here.
 */
export const IntentLine = ({
  analysis,
  intentComing,
  onDetails,
  children,
}: {
  readonly analysis: Analysis;
  /** The model is running and hasn't given the intent yet. */
  readonly intentComing: boolean;
  readonly onDetails: () => void;
  /** After the Details button: what asks Claude for the intent, or says how that went. */
  readonly children?: ReactNode;
}) => {
  const { intent, pullRequest } = analysis;
  const mismatches = intent?.mismatches ?? [];
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
          {/* Claude's sentence fades in over the description's; instant with reduced motion. */}
          <span
            data-slot="model-text"
            className="animate-in whitespace-pre-line duration-(--duration-slow) fade-in-0"
          >
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
    </div>
  );
};
