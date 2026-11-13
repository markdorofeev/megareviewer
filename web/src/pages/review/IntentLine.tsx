import { InfoIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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
 * the model, the description's first sentence. While Claude runs the description stays; when the
 * intent arrives it fades out and Claude's sentence fades in where it was, the description's
 * room kept until the run ends so the header doesn't change height. The Details button ends the
 * line, so it reads as more of it. A mismatch between what was asked and what the code does is
 * one of Claude's points, on the code it rests on, rather than a chip here.
 */
export const IntentLine = ({
  analysis,
  running,
  onDetails,
  children,
}: {
  readonly analysis: Analysis;
  /** Claude's run, as the page shows it. */
  readonly running: boolean;
  readonly onDetails: () => void;
  /** After the Details button: what asks Claude for the intent, or says how that went. */
  readonly children?: ReactNode;
}) => {
  const { intent, pullRequest } = analysis;
  const mismatches = intent?.mismatches ?? [];
  const description = pullRequest === null ? "" : firstSentence(pullRequest.description);
  // The intent arrived during a run this page saw: it swaps in over the description.
  const [had, setHad] = useState(intent !== null);
  const [swapping, setSwapping] = useState(false);
  if ((intent !== null) !== had) {
    setHad(intent !== null);
    setSwapping(intent !== null && running);
  }
  if (swapping && !running) setSwapping(false);

  const stated =
    pullRequest === null ? null : description === "" ? (
      <span className="text-muted-foreground">The pull request has no description.</span>
    ) : (
      <span>{description}</span>
    );
  const inferred =
    intent === null ? null : (
      <span data-arriving={swapping || undefined}>
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
      </span>
    );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body">
      {inferred !== null ? (
        swapping ? (
          <p data-slot="intent-swap" className="min-w-0">
            <span data-leaving aria-hidden="true">
              {stated}
            </span>
            {inferred}
          </p>
        ) : (
          <p className="min-w-0">{inferred}</p>
        )
      ) : (
        stated !== null && <p className="min-w-0">{stated}</p>
      )}
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
