import { ChevronDownIcon, InfoIcon, LockIcon, SparklesIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import {
  type Analysis,
  type ModelOption,
  modelFamily,
  modelRunnable,
  type Point,
  type PointKind,
} from "../../../../src/domain/review/index.ts";

/** What the model's element reads of an analysis: how far its run got, on what, and how it ended. */
export type ClaudeRun = Pick<Analysis, "status" | "stages" | "modelError" | "modelOption">;

import { POINT_ICON, POINT_STATUS } from "../../lib/status.ts";
import { cn, cssVars } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { Input } from "../../ui/input.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { byProvider, type ModelChoice, matching, pinnedOf } from "./model-choice.ts";

/** Seconds since `since`, ticking while it runs. */
const useElapsed = (since: number | null): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
};

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const KIND_WORDS: Readonly<Record<PointKind, [string, string]>> = {
  finding: ["finding", "findings"],
  risk: ["risk", "risks"],
  decision: ["decision", "decisions"],
};

/**
 * A kind's count, a toggle that narrows the stepper to that kind. Landing, it rises in at its place
 * among the chips, its count rolling up from zero (globals.css); the number is in the text for
 * screen readers, and drawn for the eye. Below 1280px the word gives way to the glyph and count,
 * leaving the stepper room for its title.
 */
const Chip = ({
  kind,
  count,
  at,
  pressed,
  onPressed,
}: {
  readonly kind: PointKind;
  readonly count: number;
  readonly at: number;
  readonly pressed: boolean;
  readonly onPressed: (pressed: boolean) => void;
}) => {
  const [one, many] = KIND_WORDS[kind];
  const Icon = POINT_ICON[kind];
  return (
    <button
      type="button"
      data-slot="point-chip"
      data-kind={kind}
      data-land="rise"
      aria-pressed={pressed}
      style={cssVars({ "--landing-i": at })}
      onClick={() => onPressed(!pressed)}
      className={cn(
        // A pressed chip is told by a border in its text's color, as well as by its fill.
        "flex min-h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-caption font-medium aria-pressed:border-current aria-pressed:ring-1 aria-pressed:ring-current",
        POINT_STATUS[kind].className,
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

const ModelItem = ({
  option,
  noteId,
}: {
  readonly option: ModelOption;
  readonly noteId: string;
}) => (
  <DropdownMenuRadioItem
    value={option.id}
    disabled={!option.available}
    aria-describedby={option.available ? undefined : noteId}
  >
    {option.modelName}
    {!option.measured && (
      <span className="rounded-full border px-1.5 text-caption text-muted-foreground">
        unmeasured
      </span>
    )}
  </DropdownMenuRadioItem>
);

/**
 * The field's keys: an arrow moves to the option next to it, which the menu's own navigation
 * wouldn't (it counts from the top), Escape and Tab are the menu's, and the rest are typed rather
 * than taken by the menu's typeahead.
 */
const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Escape" || event.key === "Tab") return;
  event.stopPropagation();
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const menu = event.currentTarget.closest('[role="menu"]');
  const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const after = items.findIndex(
    (item) => event.currentTarget.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const next =
    event.key === "ArrowDown" ? items[after] : items[(after === -1 ? items.length : after) - 1];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
};

/**
 * One group of options: its label says what runs them and who pays, or why they can't run. A long
 * group shows the chosen option and the default, and the rest as the reviewer filters for them, so
 * a provider with dozens of models doesn't outgrow the window.
 */
const ModelGroup = ({
  first,
  options,
  separated,
  noteId,
  choice,
}: {
  readonly first: ModelOption;
  readonly options: readonly ModelOption[];
  readonly separated: boolean;
  readonly noteId: string;
  readonly choice: ModelChoice;
}) => {
  const [query, setQuery] = useState("");
  const pinned = pinnedOf(options, choice.chosen, choice.defaultId);
  const more = options.length - pinned.length;
  const matches = matching(options, pinned, query);
  return (
    <DropdownMenuGroup>
      {separated && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="flex flex-col gap-0.5">
        <span className="text-foreground">{first.available ? first.via : first.providerName}</span>
        {!first.available && (
          <span id={noteId} className="font-normal">
            {first.reason}
          </span>
        )}
      </DropdownMenuLabel>
      {pinned.map((option) => (
        <ModelItem key={option.id} option={option} noteId={noteId} />
      ))}
      {more > 0 && (
        <div className="px-1.5 py-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFilterKey}
            placeholder={`Filter ${more} more models`}
            aria-label={`Filter ${more} more models through ${first.via}`}
            className="h-7"
          />
        </div>
      )}
      {matches.map((option) => (
        <ModelItem key={option.id} option={option} noteId={noteId} />
      ))}
      {more > 0 && query.trim() !== "" && matches.length === 0 && (
        <p className="px-2 py-1.5 text-caption text-muted-foreground">No model matches</p>
      )}
    </DropdownMenuGroup>
  );
};

/**
 * The options, grouped by what runs them. A disabled option stays focusable and is described by its
 * group's reason.
 */
const ModelMenu = ({
  choice,
  disabled,
  filled,
}: {
  readonly choice: ModelChoice;
  readonly disabled: boolean;
  /** Filled as the button beside it, so the two read as one control. */
  readonly filled: boolean;
}) => {
  const id = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={filled ? "default" : "outline"}
            size="sm"
            data-slot="model-menu"
            disabled={disabled}
            aria-label={
              choice.chosen === null ? "Choose a model" : `Model: ${choice.chosen.modelName}`
            }
            className={cn(
              "w-6 rounded-l-none px-0",
              filled ? "border-l-primary-foreground/30" : "border-l-0",
            )}
          />
        }
      >
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuRadioGroup
          value={choice.chosen?.id ?? null}
          onValueChange={(value: string) => choice.choose(value)}
        >
          {byProvider(choice.options).map(([first, options], group) => (
            <ModelGroup
              key={first.id}
              first={first}
              options={options}
              separated={group > 0}
              noteId={`${id}-${group}`}
              choice={choice}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Asks the chosen model for its passes, and beside it the arrow that opens the choice. Filled
 * before the run, the bar's strongest call to action; outline as Try again after a failed run, so
 * it doesn't outweigh Publish. Its tooltip names the model and who pays, or why nothing can run,
 * when the button stays focusable but disabled.
 */
const RequestReview = ({
  choice,
  starting,
  failed,
  onRun,
}: {
  readonly choice: ModelChoice;
  readonly starting: boolean;
  readonly failed: boolean;
  readonly onRun: () => void;
}) => {
  const descriptionId = useId();
  const { chosen, locked } = choice;
  const note =
    locked ?? (chosen === null ? null : `Runs ${chosen.modelName} through ${chosen.via}`);
  const button = (
    <Button
      variant={failed ? "outline" : "default"}
      size="sm"
      data-slot="request-review"
      disabled={starting || locked !== null || chosen === null}
      focusableWhenDisabled
      aria-describedby={note === null ? undefined : descriptionId}
      onClick={onRun}
      className="rounded-r-none"
    />
  );
  const label = (
    <>
      {locked === null ? (
        <SparklesIcon aria-hidden="true" className={cn(failed && "text-primary")} />
      ) : (
        <LockIcon aria-hidden="true" />
      )}
      {starting ? "Starting…" : failed ? "Try again" : "Request AI review"}
    </>
  );
  return (
    <span className="flex shrink-0 items-center">
      <Tooltip disabled={note === null}>
        <TooltipTrigger render={button}>{label}</TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {locked !== null && <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />}
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
        disabled={starting || choice.options.length === 0}
        filled={!failed && locked === null}
      />
    </span>
  );
};

/** The passes whose results aren't in, and why, when a run ended early. */
const missingNote = (analysis: ClaudeRun): string | null => {
  const missing = (["intent", "findings", "risk", "decisions"] as const).filter(
    (stage) => analysis.stages[stage] !== "done",
  );
  if (missing.length === 0 || analysis.modelError === null) return null;
  return `${missing.join(", ")} missing: ${analysis.modelError.message}`;
};

/**
 * The model's run and what it found, in the bar. Before it runs, the button; while it does, a line of
 * words and the time since; once it's done, a chip per kind of point with its count, which narrows
 * the stepper that follows them to its kind.
 */
export const ClaudeElement = ({
  analysis,
  choice,
  running,
  startedAt,
  starting,
  error,
  points,
  narrowed,
  onNarrow,
  onRun,
  children,
}: {
  readonly analysis: ClaudeRun;
  /** The models the reviewer can choose, and the one Request AI review runs. */
  readonly choice: ModelChoice;
  readonly running: boolean;
  /** When this page saw the run start, for the time since. */
  readonly startedAt: number | null;
  readonly starting: boolean;
  /** Why the last request to start it was refused. */
  readonly error: string | null;
  readonly points: readonly Point[];
  /** The kind whose chip is pressed, or null. */
  readonly narrowed: PointKind | null;
  readonly onNarrow: (kind: PointKind | null) => void;
  readonly onRun: () => void;
  /** After the chips: the stepper through the points. */
  readonly children?: ReactNode;
}) => {
  const elapsed = useElapsed(running ? startedAt : null);
  // The run's model once it has one; before, the one the reviewer would run.
  const family = modelFamily(analysis.modelOption ?? choice.chosen);
  if (running) {
    return (
      <span
        data-slot="claude-running"
        role="status"
        className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground"
      >
        <SparklesIcon aria-hidden="true" className="size-3.5" />
        {family} is reading this PR
        <span className="tabular text-caption">{clock(elapsed)}</span>
      </span>
    );
  }

  const counts = (["finding", "risk", "decision"] as const)
    .map((kind) => [kind, points.filter((point) => point.kind === kind).length] as const)
    .filter(([, count]) => count > 0);
  const note = missingNote(analysis);
  // What follows the chips lands after the last of them.
  const after = (at: number) => ({
    "data-land": "rise",
    style: cssVars({ "--landing-i": counts.length + at }),
  });
  if (points.length > 0) {
    return (
      <span data-slot="claude-receipt" className="flex min-w-0 items-center gap-1.5">
        {counts.map(([kind, count], at) => (
          <Chip
            key={kind}
            kind={kind}
            count={count}
            at={at}
            pressed={narrowed === kind}
            onPressed={(pressed) => onNarrow(pressed ? kind : null)}
          />
        ))}
        <span {...after(0)} className="ml-1 flex min-w-0 items-center border-l pl-1.5">
          {children}
        </span>
        {(error ?? note) !== null && (
          // The bar is one row: a long reason is cut there, and whole on hover and when read out.
          <span
            {...after(1)}
            role="alert"
            title={error ?? note ?? undefined}
            className="min-w-0 truncate text-caption text-destructive"
          >
            {error ?? note}
          </span>
        )}
        {modelRunnable(analysis) && (
          <span {...after(1)}>
            <Button variant="ghost" size="xs" disabled={starting} onClick={onRun}>
              {starting ? "Starting…" : "Try again"}
            </Button>
          </span>
        )}
      </span>
    );
  }

  if (!modelRunnable(analysis)) {
    // Claude ran and found nothing to raise.
    return analysis.stages.findings === "done" ? (
      <span
        data-slot="claude-receipt"
        data-land="fade"
        className="whitespace-nowrap text-muted-foreground"
      >
        <span aria-hidden="true">✓ </span>
        {family} found nothing to raise
      </span>
    ) : null;
  }
  const failed = analysis.modelError;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <RequestReview choice={choice} starting={starting} failed={failed !== null} onRun={onRun} />
      {(error ?? failed) !== null && (
        <span
          role="alert"
          title={error ?? `${family} couldn't finish: ${failed?.message}`}
          className="min-w-0 truncate text-caption text-destructive"
        >
          {error ?? `${family} couldn't finish: ${failed?.message}`}
        </span>
      )}
    </span>
  );
};
