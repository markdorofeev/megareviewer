import { CheckIcon, InfoIcon, Loader2Icon, RouteIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { type Analysis, hasModelRun, runStages } from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";
import { codeSpans } from "./brief.ts";

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

const LEAD = "font-semibold text-foreground";

/** Model text, with its code spans set in code and the rest's Markdown markers dropped. */
export const ModelText = ({ text }: { readonly text: string }) => (
  <span data-slot="model-text" className="whitespace-pre-line">
    {codeSpans(text).map((piece, at) =>
      piece.code ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one text never reorder.
        <code key={at} className="font-mono text-code-compact">
          {piece.text}
        </code>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one text never reorder.
        <span key={at}>{plainIntent(piece.text)}</span>
      ),
    )}
  </span>
);

/** "Sonnet 5.5 through Claude Code", when the run recorded its option. */
const runName = (analysis: Analysis): string | null =>
  analysis.modelOption === null
    ? null
    : `${analysis.modelOption.modelName} through ${analysis.modelOption.providerName}`;

/**
 * Where the brief comes from: the AI review, its model and whether it's of the latest commit, or
 * while it runs, how many of its passes are done. Status only: the bar holds what can be done
 * about it. Nothing before a run, which the bar says.
 */
const AiStatus = ({
  analysis,
  running,
  stale,
  tour,
}: {
  readonly analysis: Analysis;
  readonly running: boolean;
  readonly stale: boolean;
  readonly tour: TourLink | null;
}) => {
  if (!running && !hasModelRun(analysis)) return null;
  const name = runName(analysis);
  const passes = runStages(analysis);
  const done = passes.filter((stage) => analysis.stages[stage] === "done").length;
  return (
    <div
      data-slot="ai-status"
      className="mb-1.5 flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground"
    >
      {running ? (
        <Loader2Icon
          aria-hidden="true"
          className="size-3.5 animate-spin text-primary motion-reduce:animate-none"
        />
      ) : (
        <SparklesIcon aria-hidden="true" className="size-3.5 text-primary" />
      )}
      <span className="font-semibold text-foreground">
        {running ? "AI review running" : "AI review"}
      </span>
      {name !== null && (
        <>
          <span aria-hidden="true">·</span> <span>{name}</span>
        </>
      )}
      <span aria-hidden="true">·</span>{" "}
      {running ? (
        <>
          <span>
            {done} of {passes.length} passes
          </span>
          <span
            role="progressbar"
            aria-label="AI review progress"
            aria-valuemin={0}
            aria-valuemax={passes.length}
            aria-valuenow={done}
            className="ml-1 h-1 w-30 overflow-hidden rounded-full bg-secondary"
          >
            <span
              className="block h-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${(done / passes.length) * 100}%` }}
            />
          </span>
        </>
      ) : (
        <span>{stale ? "new commits since" : "latest commit"}</span>
      )}
      {tour !== null && !running && (
        <>
          <span aria-hidden="true">·</span>{" "}
          <button
            type="button"
            data-slot="tour-link"
            onClick={tour.onOpen}
            className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
          >
            <RouteIcon aria-hidden="true" className="size-3.5" />
            Tour · {tour.steps} steps
          </button>
        </>
      )}
    </div>
  );
};

/** The brief's way into the tour, once a run wrote one and the Tour switch is on. */
export interface TourLink {
  readonly steps: number;
  readonly onOpen: () => void;
}

/**
 * The intent's brief under the title, one line of what to know before reading the code: what the
 * change does, Claude's once it has run, and before, the description's first sentence. While Claude
 * runs the description stays; when the intent arrives it fades out and Claude's line fades in where
 * it was. The Details button ends the line, so it reads as more of it. A mismatch between what was
 * asked and what the code does is one of Claude's points, on the code it rests on.
 */
export const IntentLine = ({
  analysis,
  running,
  stale = false,
  tour = null,
  onDetails,
}: {
  readonly analysis: Analysis;
  /** Claude's run, as the page shows it. */
  readonly running: boolean;
  /** The PR has new commits since the analysis. */
  readonly stale?: boolean;
  readonly tour?: TourLink | null;
  readonly onDetails: () => void;
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

  const details = (intent !== null || pullRequest !== null) && (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Details"
      title="Details"
      onClick={onDetails}
      className="ml-1 rounded-full align-middle text-muted-foreground"
    >
      <InfoIcon aria-hidden="true" />
    </Button>
  );
  const stated = pullRequest !== null && (
    <p className="min-w-0">
      {description === "" ? (
        <span className="text-muted-foreground">The pull request has no description.</span>
      ) : (
        <span>{description}</span>
      )}
      {!swapping && details}
    </p>
  );
  const inferred = intent !== null && (
    <p data-arriving={swapping || undefined} className="min-w-0">
      <span className={LEAD}>
        {mismatches.length > 0 || intent.stated === null ? (
          "From the code:"
        ) : (
          <>
            <CheckIcon
              aria-hidden="true"
              className="mr-1 inline size-3.5 align-[-0.125em] text-review-approved"
            />
            Does what was asked:
          </>
        )}
      </span>{" "}
      <ModelText text={intent.inferred.summary} />
      {details}
    </p>
  );

  return (
    <div data-slot="intent-brief" className="flex min-w-0 flex-col gap-1 text-body">
      <AiStatus analysis={analysis} running={running} stale={stale} tour={tour} />
      {inferred !== false ? (
        swapping ? (
          <div data-slot="intent-swap" className="min-w-0">
            <div data-leaving aria-hidden="true">
              {stated}
            </div>
            {inferred}
          </div>
        ) : (
          inferred
        )
      ) : (
        stated
      )}
    </div>
  );
};
