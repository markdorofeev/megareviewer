import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type {
  FindingType,
  Point,
  PointId,
  PointState,
} from "../../../../src/domain/review/index.ts";
import {
  FINDING_STATUS,
  FINDING_TYPE_STATUS,
  POINT_TONE,
  pointTone,
  SEVERITY_STATUS,
} from "../../lib/status.ts";
import { cn, cssVars } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { PointList } from "./PointList.tsx";
import { stepFrom, stepperPlace } from "./stepper.ts";

/** A segment of the pager: a ghost button flush with its neighbours, a hairline between them. */
const SEGMENT =
  "h-full shrink-0 rounded-none border-0 not-first-of-type:border-l not-first-of-type:border-border first-of-type:rounded-l-sm last-of-type:rounded-r-sm";

/** The current step's title, the pager's middle segment; it gives way first as the bar narrows. */
export const STEPPER_TITLE = cn(
  SEGMENT,
  "min-w-0 shrink justify-start gap-1.5 px-2 text-left font-normal max-sm:hidden",
);

/** A count that rolls up from zero while the run lands; the number is for screen readers. */
const CountUp = ({ count }: { readonly count: number }) => (
  <>
    <span
      data-slot="count-up"
      aria-hidden="true"
      className="tabular"
      style={cssVars({ "--count": count })}
    />
    <span className="sr-only">{count}</span>
  </>
);

/**
 * One outlined pager round a set of steps. Before the first step it's what the steps are, counted,
 * which opens their list, and Start. On a step, Previous and Next at its ends, the current step's
 * title, which goes back to it, and its position, which opens the list; outside the set, the count
 * in the title's place. Claude's findings and the PR's threads share it.
 */
export const Stepper = ({
  slot,
  noun,
  kind = noun,
  total,
  at,
  started,
  icon,
  count,
  countWords,
  qualifier = null,
  title,
  status,
  onStep,
  list,
}: {
  readonly slot: string;
  /** What a step is, for the buttons' names: "finding", "thread". */
  readonly noun: string;
  /** What a step is among the steps walked, for the position's name: "logic finding". */
  readonly kind?: string;
  readonly total: number;
  /** The current step's place among them, from 0; null before the first step or outside the set. */
  readonly at: number | null;
  /** Whether a step was gone to, though it may be outside the set: then Previous goes up. */
  readonly started: boolean;
  /** Before the first step, what the steps are, beside their count. */
  readonly icon: ReactNode;
  /** How many steps there are, said before the first. */
  readonly count: number;
  /** The words after the count: "findings", "logic findings", "unresolved". */
  readonly countWords: string;
  /** After the position, what the steps were narrowed to: "logic". */
  readonly qualifier?: string | null;
  /** The current step's title, a segment that goes back to it. */
  readonly title: ReactNode;
  /** What a screen reader hears once a step lands: "Finding 2 of 5: …". */
  readonly status: string;
  readonly onStep: (direction: 1 | -1) => void;
  /** The whole list, in the popover the position opens; a row calls `close` before it goes. */
  readonly list: (close: () => void) => ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  // A row moves the focus to what it goes to; closing mustn't take it back to the position.
  const went = useRef(false);
  const close = () => {
    went.current = true;
    setOpen(false);
  };
  const Kind = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  const before = at === null && !started;
  const position =
    at === null ? (
      <>
        {icon}
        {/* Below 640px the icon and count leave Start its room. */}
        <span>
          <CountUp count={count} /> <span className="max-sm:hidden">{countWords}</span>
        </span>
      </>
    ) : (
      <span>
        {at + 1} of {total}
        {qualifier !== null && ` ${qualifier}`}
      </span>
    );
  const previous = (
    <Button
      variant="ghost"
      size="icon-xs"
      className={SEGMENT}
      aria-label={`Previous ${noun}`}
      disabled={total === 0}
      onClick={() => onStep(-1)}
    >
      <ChevronLeftIcon aria-hidden="true" />
    </Button>
  );
  const next = (
    <Button
      variant="ghost"
      size="xs"
      className={cn(SEGMENT, before ? "gap-0.5 pr-1.5 pl-2 text-ui" : "w-6 px-0")}
      aria-label={before ? undefined : `Next ${noun}`}
      disabled={total === 0}
      onClick={() => onStep(1)}
    >
      {before && "Start"}
      <ChevronRightIcon aria-hidden="true" className="size-3.5" />
    </Button>
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a pager's segments, not a form's fields.
    <span
      role="group"
      aria-label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`}
      data-slot={slot}
      className="flex h-7 min-w-0 max-w-xl items-stretch rounded-md border border-border bg-background"
    >
      {!before && previous}
      {at !== null && title}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) went.current = false;
          setOpen(next);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className={cn(SEGMENT, "tabular gap-1.5 pr-1.5 text-ui")}
              aria-label={
                at === null
                  ? `${count} ${countWords}, show all`
                  : `${Kind} ${at + 1} of ${total}, show all`
              }
            />
          }
        >
          {position}
          <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[min(32rem,calc(100dvh-var(--review-bar-h,3.25rem)-1rem))] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto"
          finalFocus={() => !went.current}
        >
          {list(close)}
        </PopoverContent>
      </Popover>
      {next}
      <span role="status" className="sr-only">
        {status}
      </span>
    </span>
  );
};

/**
 * One pager through Claude's findings, round from the last to the first: before the first step,
 * their count and Start; on one, its severity and title, which go back to its card, and its
 * position, which opens the list. A type picked in the list narrows the steps to that type.
 */
export const PointStepper = ({
  points,
  type = null,
  onType,
  current,
  stateOf,
  onGo,
  family = "Claude",
}: {
  readonly points: readonly Point[];
  /** The type the list's filter narrowed the steps to. */
  readonly type?: FindingType | null;
  readonly onType: (type: FindingType | null) => void;
  /** The point last gone to, by the pager, the list, a mention or Raise. */
  readonly current: PointId | null;
  readonly stateOf: (id: PointId) => PointState;
  readonly onGo: (id: PointId) => void;
  /** Who made the findings: "Claude". */
  readonly family?: string;
}) => {
  const place = stepperPlace(points, type, current);
  const { steps, at } = place;
  const point = at === null ? undefined : steps[at];
  const { label, icon: Icon } = FINDING_STATUS;
  const typeLabel = type === null ? null : FINDING_TYPE_STATUS[type].label;
  const many = steps.length === 1 ? "finding" : "findings";
  const dismissed = point !== undefined && stateOf(point.id) === "dismissed";

  return (
    <Stepper
      slot="point-stepper"
      noun="finding"
      kind={typeLabel === null ? "finding" : `${typeLabel} finding`}
      total={steps.length}
      at={at}
      started={current !== null}
      icon={<Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
      count={steps.length}
      countWords={typeLabel === null ? many : `${typeLabel} ${many}`}
      qualifier={typeLabel}
      onStep={(direction) => {
        const to = stepFrom(place, direction);
        if (to !== null) onGo(to);
      }}
      list={(close) => (
        <PointList
          points={points}
          type={type}
          onType={onType}
          current={current}
          family={family}
          stateOf={stateOf}
          onGo={(id) => {
            close();
            onGo(id);
          }}
        />
      )}
      title={
        point !== undefined && (
          <Button
            variant="ghost"
            size="xs"
            data-slot="stepper-title"
            className={STEPPER_TITLE}
            aria-label={`Go to ${label.toLowerCase()}: ${point.title}`}
            onClick={() => onGo(point.id)}
          >
            {point.severity === null ? (
              <Icon
                aria-hidden="true"
                className={cn("size-3.5 shrink-0", POINT_TONE[pointTone(point)].text)}
              />
            ) : (
              <span aria-hidden="true" className={cn("shrink-0", POINT_TONE[point.severity].text)}>
                {SEVERITY_STATUS[point.severity].glyph}
              </span>
            )}
            <span
              className={cn(
                "min-w-0 truncate text-ui",
                dismissed && "text-muted-foreground line-through",
              )}
            >
              {point.title}
            </span>
          </Button>
        )
      }
      // A step says where it went: "Finding 2 of 5: Delay overflows after 31 attempts".
      status={
        point === undefined || at === null
          ? ""
          : `${label} ${at + 1} of ${steps.length}: ${point.title}${
              dismissed ? " (dismissed)" : ""
            }`
      }
    />
  );
};
