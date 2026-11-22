import {
  InfoIcon,
  Loader2Icon,
  LockIcon,
  type LucideIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import {
  type Analysis,
  hasModelRun,
  MODEL_STAGES,
  modelFamily,
  modelRunnable,
  type Point,
  type PointKind,
  runStages,
} from "../../../../src/domain/review/index.ts";

/** What the model's element reads of an analysis: how far its run got, on what, and how it ended. */
export type ClaudeRun = Pick<
  Analysis,
  "status" | "stages" | "modelError" | "modelOption" | "usage"
>;

import { POINT_ICON, POINT_STATUS } from "../../lib/status.ts";
import { cn, cssVars } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { ModelMenu } from "./ModelMenu.tsx";
import type { ModelChoice } from "./model-choice.ts";

const KIND_WORDS: Readonly<Record<PointKind, [string, string]>> = {
  finding: ["finding", "findings"],
  risk: ["risk", "risks"],
  decision: ["decision", "decisions"],
};

/** What the stepper walks when a chip narrows it: a kind of Claude's points, or the PR's threads. */
export type Narrowing = PointKind | "thread";

/**
 * A count, a toggle that narrows the stepper: to a kind of point, or to the threads. Landing, it
 * rises in at its place among the chips, its count rolling up from zero (globals.css); the number
 * is in the text for screen readers, and drawn for the eye. Below 1280px the word gives way to the
 * glyph and count, leaving the stepper room for its title.
 */
const Chip = ({
  kind,
  count,
  words,
  at,
  pressed,
  onPressed,
  label,
}: {
  readonly kind: Narrowing;
  readonly count: number;
  /** The word after the count, one and many: "finding", "findings". */
  readonly words: readonly [string, string];
  readonly at: number;
  readonly pressed: boolean;
  readonly onPressed: (pressed: boolean) => void;
  /** Its name, when the count and word don't say what it counts. */
  readonly label?: string;
}) => {
  const [one, many] = words;
  const Icon = kind === "thread" ? MessageSquareIcon : POINT_ICON[kind];
  return (
    <button
      type="button"
      data-slot="point-chip"
      data-kind={kind}
      data-land="rise"
      aria-pressed={pressed}
      aria-label={label}
      style={cssVars({ "--landing-i": at })}
      onClick={() => onPressed(!pressed)}
      className={cn(
        // A pressed chip is told by a border in its text's color, as well as by its fill.
        "flex min-h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-caption font-medium aria-pressed:border-current aria-pressed:ring-1 aria-pressed:ring-current",
        kind === "thread"
          ? "border-border bg-background text-foreground"
          : POINT_STATUS[kind].className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span>
        <span
          data-slot="count-up"
          aria-hidden="true"
          className="tabular"
          style={cssVars({ "--count": count })}
        />
        <span className="sr-only">{count}</span>{" "}
        <span className="max-xl:sr-only">{count === 1 ? one : many}</span>
      </span>
    </button>
  );
};

type AiVariant = "ai" | "ai-strong" | "ai-quiet";

/**
 * The AI review's split button: its action, and beside it the arrow that opens the model choice.
 * Tinted, never filled: AI reads apart from committing a review. Its tooltip names the model and
 * who pays, or why nothing can run, when the button stays focusable but disabled. Busy while
 * Claude runs: not clickable, with a spinner, and how far it got for screen readers.
 */
const AiSplit = ({
  choice,
  variant,
  compact,
  icon: Icon,
  label,
  note,
  locked = false,
  disabled = false,
  busy = null,
  slot,
  onClick,
}: {
  readonly choice: ModelChoice;
  readonly variant: AiVariant;
  /** Small, after the chips; full size where it's the row's call to action. */
  readonly compact: boolean;
  readonly icon: LucideIcon;
  readonly label: ReactNode;
  readonly note: string | null;
  /** Nothing can run: the note says why. */
  readonly locked?: boolean;
  readonly disabled?: boolean;
  /** Claude is running: what a screen reader hears of it. */
  readonly busy?: string | null;
  readonly slot: string;
  readonly onClick?: () => void;
}) => {
  const descriptionId = useId();
  const size = compact ? "sm" : "default";
  const button = (
    <Button
      variant={variant}
      size={size}
      data-slot={slot}
      disabled={disabled || busy !== null}
      focusableWhenDisabled
      aria-describedby={note === null ? undefined : descriptionId}
      onClick={onClick}
      className={cn(
        "rounded-r-none border-r-0",
        // Busy isn't unavailable: it reads at full strength.
        busy !== null && "aria-disabled:cursor-progress aria-disabled:opacity-100",
      )}
    />
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a split button's two halves, not a form's fields.
    <span role="group" aria-label="AI review" className="flex shrink-0 items-center">
      <Tooltip disabled={note === null}>
        <TooltipTrigger render={button}>
          <Icon
            aria-hidden="true"
            className={cn(busy !== null && "animate-spin motion-reduce:animate-none")}
          />
          {label}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {locked && <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />}
          {note}
        </TooltipContent>
      </Tooltip>
      {/* The tooltip is for the eye; a screen reader reads the same words as the description. */}
      {note !== null && (
        <span id={descriptionId} hidden>
          {note}
        </span>
      )}
      <ModelMenu
        choice={choice}
        disabled={busy !== null || disabled || choice.options.length === 0}
        variant={variant}
        size={size}
      />
      {busy !== null && (
        <span role="status" className="sr-only">
          {busy}
        </span>
      )}
    </span>
  );
};

/** The passes whose results aren't in, and why, when a run ended early. */
const missingNote = (analysis: ClaudeRun): string | null => {
  const missing = MODEL_STAGES.filter((stage) => analysis.stages[stage] !== "done");
  if (missing.length === 0 || analysis.modelError === null) return null;
  return `${missing.join(", ")} missing: ${analysis.modelError.message}`;
};

/** New commits since the analysis: the split's action reads them as a new one. */
export interface Reanalyze {
  readonly starting: boolean;
  readonly onReanalyze: () => void;
}

/**
 * The AI review in the bar. First what it found, a chip per kind of point with its count, which
 * narrows the stepper that follows to its kind, and one for the PR's threads; then the stepper,
 * through the points or the threads; then, after a divider, the AI review's split button: Request
 * AI review before a run, with a line of what it would do; Reviewing while it runs; Re-run after
 * it; Try again after a run that didn't finish; Re-analyze when the PR has new commits.
 */
export const ClaudeElement = ({
  analysis,
  choice,
  running,
  starting,
  error,
  points,
  leftOut = 0,
  threads = null,
  narrowed,
  onNarrow,
  onRun,
  onRerun,
  reanalyze = null,
  filesChanged = null,
  children,
}: {
  readonly analysis: ClaudeRun;
  /** The models the reviewer can choose, and the one Request AI review runs. */
  readonly choice: ModelChoice;
  readonly running: boolean;
  readonly starting: boolean;
  /** Why the last request to start it was refused. */
  readonly error: string | null;
  /** The points the stepper walks: all but those folded as left out by a preference. */
  readonly points: readonly Point[];
  /** How many points are folded as left out, said when there's nothing else to say. */
  readonly leftOut?: number;
  /** The threads the stepper can walk, for their chip beside the points'; null without any. */
  readonly threads?: {
    readonly count: number;
    readonly words: readonly [string, string];
    readonly label: string;
  } | null;
  /** The chip that's pressed, or null. */
  readonly narrowed: Narrowing | null;
  readonly onNarrow: (kind: Narrowing | null) => void;
  readonly onRun: () => void;
  /** Re-run after a finished run: asks, then takes the run off and runs again. */
  readonly onRerun?: () => void;
  /** The PR has new commits since the analysis. */
  readonly reanalyze?: Reanalyze | null;
  /** How many files the PR changes, for what a run would cover. */
  readonly filesChanged?: number | null;
  /** After the chips: the stepper through the points or the threads. */
  readonly children?: ReactNode;
}) => {
  // The run's model once it has one; before, the one the reviewer would run.
  const family = modelFamily(analysis.modelOption ?? choice.chosen);
  const hasStepper = children !== undefined && children !== null && children !== false;
  const { chosen, locked } = choice;
  const runNote =
    locked ?? (chosen === null ? null : `Runs ${chosen.modelName} through ${chosen.via}`);
  const runDisabled = starting || locked !== null || chosen === null;
  const ran = hasModelRun(analysis);
  const runnable = modelRunnable(analysis);
  const failed = analysis.modelError;

  const counts = (["finding", "risk", "decision"] as const)
    .map((kind) => [kind, points.filter((point) => point.kind === kind).length] as const)
    .filter(([, count]) => count > 0);
  const receipt = !running && points.length > 0;
  // What follows the chips lands after the last of them.
  const chips = receipt ? counts.length + (threads === null ? 0 : 1) : 0;
  const after = (at: number) =>
    receipt ? { "data-land": "rise", style: cssVars({ "--landing-i": chips + at }) } : {};

  // The run's passes: four, or five when it asked for the tour.
  const passes = runStages(analysis);
  const done = passes.filter((stage) => analysis.stages[stage] === "done").length;
  const split = running ? (
    <AiSplit
      choice={choice}
      variant="ai-quiet"
      compact
      icon={Loader2Icon}
      label={`Reviewing · ${done} of ${passes.length}`}
      note={null}
      busy={`${family} is reading this PR, ${done} of ${passes.length} passes done`}
      slot="claude-running"
    />
  ) : reanalyze !== null ? (
    <AiSplit
      choice={choice}
      variant="ai-strong"
      compact={ran}
      icon={RefreshCwIcon}
      label={reanalyze.starting ? "Starting…" : "Re-analyze · new commits"}
      note="Reads the PR's new commits as a new analysis"
      disabled={reanalyze.starting}
      slot="reanalyze"
      onClick={reanalyze.onReanalyze}
    />
  ) : runnable ? (
    <AiSplit
      choice={choice}
      variant={failed === null ? "ai" : "ai-quiet"}
      compact={points.length > 0}
      icon={locked !== null ? LockIcon : failed === null ? SparklesIcon : RefreshCwIcon}
      label={
        starting ? (
          "Starting…"
        ) : failed === null ? (
          // Below 640px the bar keeps "AI review"; a screen reader hears it all.
          <>
            <span className="max-sm:sr-only">Request AI review</span>
            <span aria-hidden="true" className="sm:hidden">
              AI review
            </span>
          </>
        ) : (
          "Try again"
        )
      }
      note={runNote}
      locked={locked !== null}
      disabled={runDisabled}
      slot="request-review"
      onClick={onRun}
    />
  ) : (
    onRerun !== undefined && (
      <AiSplit
        choice={choice}
        variant="ai-quiet"
        compact
        icon={RefreshCwIcon}
        label={starting ? "Starting…" : "Re-run"}
        note={
          locked ??
          (chosen === null ? null : `Runs ${chosen.modelName} through ${chosen.via} again`)
        }
        locked={locked !== null}
        disabled={runDisabled}
        slot="rerun"
        onClick={onRerun}
      />
    )
  );

  // Before any run: what one would do, beside the button.
  const prompt = !running && reanalyze === null && !ran && (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground max-lg:hidden">
      <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      <span className="font-semibold text-foreground">No AI review yet</span>
      {filesChanged !== null && filesChanged > 0 && (
        <span className="truncate max-xl:hidden">
          Find bugs, risks and decisions across {filesChanged}{" "}
          {filesChanged === 1 ? "file" : "files"}
        </span>
      )}
    </span>
  );

  const reason =
    error ??
    (points.length > 0 ? missingNote(analysis) : null) ??
    (failed === null || points.length > 0 ? null : `${family} couldn't finish: ${failed.message}`);

  // Claude ran and found nothing to raise.
  const nothing = !running &&
    !runnable &&
    points.length === 0 &&
    analysis.stages.findings === "done" && (
      <span
        data-slot="claude-receipt"
        data-land="fade"
        className="shrink-0 whitespace-nowrap text-muted-foreground"
      >
        <span aria-hidden="true">✓ </span>
        {family} found nothing to raise
        {leftOut > 0 && `, and left out ${leftOut} by your preferences`}
      </span>
    );

  const left = receipt ? (
    <span data-slot="claude-receipt" className="flex min-w-0 items-center gap-1.5">
      {counts.map(([kind, count], at) => (
        <Chip
          key={kind}
          kind={kind}
          count={count}
          words={KIND_WORDS[kind]}
          at={at}
          pressed={narrowed === kind}
          onPressed={(pressed) => onNarrow(pressed ? kind : null)}
        />
      ))}
      {threads !== null && (
        <Chip
          kind="thread"
          count={threads.count}
          words={threads.words}
          label={threads.label}
          at={counts.length}
          pressed={narrowed === "thread"}
          onPressed={(pressed) => onNarrow(pressed ? "thread" : null)}
        />
      )}
      {hasStepper && (
        <span {...after(0)} className="ml-1 flex min-w-0 items-center">
          {children}
        </span>
      )}
    </span>
  ) : (
    (nothing !== false || hasStepper) && (
      <span className="flex min-w-0 items-center gap-2">
        {nothing}
        {hasStepper && <span className="flex min-w-0 items-center">{children}</span>}
      </span>
    )
  );

  return (
    <span className="flex min-w-0 items-center gap-2">
      {left}
      <span
        {...after(1)}
        className={cn(
          "flex min-w-0 shrink-0 items-center gap-2",
          left !== false && "border-l pl-2",
        )}
      >
        {prompt}
        {split}
      </span>
      {reason !== null && (
        // The bar is one row: a long reason is cut there, and whole on hover and when read out.
        <span
          {...after(2)}
          role="alert"
          title={reason}
          className="min-w-0 truncate text-caption text-destructive"
        >
          {reason}
        </span>
      )}
    </span>
  );
};
