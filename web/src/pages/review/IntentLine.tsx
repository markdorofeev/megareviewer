import { CheckIcon, InfoIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { hunkIdOf } from "../../../../src/domain/diff/index.ts";
import { type Analysis, hasModelRun, MODEL_STAGES } from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";
import { codeSpans, type Reach, reachOf, type Through } from "./brief.ts";

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
const ModelText = ({ text }: { readonly text: string }) => (
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

/** The overview's rows in words: directories callers first, with where users reach them. */
const ThroughText = ({ through }: { readonly through: Through }) => (
  <span data-slot="through">
    {through.rows.map((row, at) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: rows never reorder.
      <span key={at}>
        {at > 0 && " → "}
        {row.map((stop, index) => (
          <span key={stop.label}>
            {index > 0 && ", "}
            <code className="font-mono text-code-compact">{stop.label}</code>
            {stop.entries.length > 0 && (
              <span className="text-muted-foreground"> ({stop.entries.join(", ")})</span>
            )}
          </span>
        ))}
      </span>
    ))}
    {through.more > 0 && (
      <span className="text-muted-foreground">
        {" "}
        · {through.more} more {through.more === 1 ? "directory" : "directories"}
      </span>
    )}
  </span>
);

const ReachText = ({ reach }: { readonly reach: Reach }) => {
  const shown = reach.symbols.slice(0, 3);
  const rest = reach.symbols.length - shown.length;
  const names = shown.map((symbol, at) => (
    <span key={symbol}>
      {at > 0 && (at === shown.length - 1 && rest === 0 ? " and " : ", ")}
      <code className="font-mono text-code-compact">{symbol}</code>
    </span>
  ));
  return (
    <span data-slot="reach">
      Changes {names}
      {rest > 0 && ` and ${rest} more`}, used in {reach.uses}{" "}
      {reach.uses === 1 ? "place" : "places"} the PR doesn't change.
    </span>
  );
};

const Line = ({ lead, children }: { readonly lead: string; readonly children: ReactNode }) => (
  <p className="min-w-0">
    <span className={LEAD}>{lead}</span> {children}
  </p>
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
}: {
  readonly analysis: Analysis;
  readonly running: boolean;
  readonly stale: boolean;
}) => {
  if (!running && !hasModelRun(analysis)) return null;
  const name = runName(analysis);
  const done = MODEL_STAGES.filter((stage) => analysis.stages[stage] === "done").length;
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
            {done} of {MODEL_STAGES.length} passes
          </span>
          <span
            role="progressbar"
            aria-label="AI review progress"
            aria-valuemin={0}
            aria-valuemax={MODEL_STAGES.length}
            aria-valuenow={done}
            className="ml-1 h-1 w-30 overflow-hidden rounded-full bg-secondary"
          >
            <span
              className="block h-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${(done / MODEL_STAGES.length) * 100}%` }}
            />
          </span>
        </>
      ) : (
        <span>{stale ? "new commits since" : "latest commit"}</span>
      )}
    </div>
  );
};

/**
 * The intent's brief under the title, what to know before reading the code, in up to three
 * lines: what the change does, how it runs through the system, and what to keep in mind. Claude's
 * once it has run; before, the description's first sentence, the overview's directories in call
 * order, and the definitions the change reaches past itself. A line Claude left empty is the
 * code's. While Claude runs the code's brief stays; when the intent arrives it fades out and
 * Claude's fades in where it was, the room kept until the run ends so the header doesn't change
 * height. The Details button ends the first line, so it reads as more of it. A mismatch between
 * what was asked and what the code does is one of Claude's points, on the code it rests on.
 */
export const IntentLine = ({
  analysis,
  through,
  running,
  stale = false,
  onDetails,
}: {
  readonly analysis: Analysis;
  /** The overview's rows in words, once the code's analysis has them. */
  readonly through: Through | null;
  /** Claude's run, as the page shows it. */
  readonly running: boolean;
  /** The PR has new commits since the analysis. */
  readonly stale?: boolean;
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
  const pathOfHunk = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path] as const)),
  );
  const reach = reachOf(analysis.unchangedCallers, (id) => pathOfHunk.get(hunkIdOf(id)));
  const throughLine = through !== null && (
    <Line lead={through.linked ? "Through:" : "In:"}>
      <ThroughText through={through} />
    </Line>
  );
  const reachLine = reach !== null && (
    <Line lead="Watch:">
      <ReachText reach={reach} />
    </Line>
  );

  const stated = pullRequest !== null && (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="min-w-0">
        {description === "" ? (
          <span className="text-muted-foreground">The pull request has no description.</span>
        ) : (
          <span>{description}</span>
        )}
        {!swapping && details}
      </p>
      {throughLine}
      {reachLine}
    </div>
  );
  const inferred = intent !== null && (
    <div data-arriving={swapping || undefined} className="flex min-w-0 flex-col gap-0.5">
      <p className="min-w-0">
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
      {intent.inferred.shape === "" ? (
        throughLine
      ) : (
        <Line lead="Through:">
          <ModelText text={intent.inferred.shape} />
        </Line>
      )}
      {intent.inferred.watch.length === 0 ? (
        reachLine
      ) : (
        <Line lead="Watch:">
          {intent.inferred.watch.map((item, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders.
            <span key={at}>
              {at > 0 && " · "}
              <ModelText text={item} />
            </span>
          ))}
        </Line>
      )}
    </div>
  );

  return (
    <div data-slot="intent-brief" className="flex min-w-0 flex-col gap-1 text-body">
      <AiStatus analysis={analysis} running={running} stale={stale} />
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
