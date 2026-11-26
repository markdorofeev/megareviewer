import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import type {
  FindingType,
  Point,
  PointId,
  PointState,
} from "../../../../src/domain/review/index.ts";
import { FINDING_STATUS, FINDING_TYPE_STATUS, POINT_TONE, pointTone } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { stepFrom, stepperPlace } from "./stepper.ts";

/**
 * Previous and Next round a set of steps, the position that opens the whole list, and after them
 * the current step's title, which goes back to it. Before the first step, the position is a count.
 * Claude's points and the PR's threads share it.
 */
export const Stepper = ({
  slot,
  noun,
  total,
  at,
  count,
  title,
  status,
  onStep,
  onOpenList,
}: {
  readonly slot: string;
  /** What a step is, for the buttons' names: "point", "thread". */
  readonly noun: string;
  readonly total: number;
  /** The current step's place among them, from 0; null before the first step or outside the set. */
  readonly at: number | null;
  /** The position before the first step: "5 points". */
  readonly count: string;
  /** The current step's title, a button that goes back to it. */
  readonly title: ReactNode;
  /** What a screen reader hears once a step lands: "Finding 2 of 5: …". */
  readonly status: string;
  readonly onStep: (direction: 1 | -1) => void;
  readonly onOpenList: () => void;
}) => {
  const position = at === null ? count : `${at + 1} of ${total}`;
  const Noun = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
  return (
    <span data-slot={slot} className="flex min-w-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Previous ${noun}`}
        disabled={total === 0}
        onClick={() => onStep(-1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="tabular"
        aria-label={at === null ? `${count}, show all` : `${Noun} ${position}, show all`}
        onClick={onOpenList}
      >
        {position}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Next ${noun}`}
        disabled={total === 0}
        onClick={() => onStep(1)}
      >
        <ChevronRightIcon aria-hidden="true" />
      </Button>
      {title}
      <span role="status" className="sr-only">
        {status}
      </span>
    </span>
  );
};

/** The current step's title after the stepper; it gives way first as the bar narrows. */
export const STEPPER_TITLE =
  "ml-1 flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1 text-left max-sm:hidden hover:bg-muted";

/**
 * Previous and Next through Claude's points, round from the last to the first, with the position
 * that opens the whole list and the current point's title, which goes back to its card. Before the
 * first step, the position is a count. A type's chip narrows it to that type's findings.
 */
export const PointStepper = ({
  points,
  type = null,
  current,
  stateOf,
  onGo,
  onOpenList,
}: {
  readonly points: readonly Point[];
  /** The type a chip narrowed the steps to. */
  readonly type?: FindingType | null;
  /** The point last gone to, by the stepper, the list, a mention or Raise. */
  readonly current: PointId | null;
  readonly stateOf: (id: PointId) => PointState;
  readonly onGo: (id: PointId) => void;
  readonly onOpenList: () => void;
}) => {
  const place = stepperPlace(points, type, current);
  const { steps, at } = place;
  const point = at === null ? undefined : steps[at];
  const { label, icon: Icon } = FINDING_STATUS;
  const noun = type === null ? "point" : `${FINDING_TYPE_STATUS[type].label} finding`;
  const dismissed = point !== undefined && stateOf(point.id) === "dismissed";

  return (
    <Stepper
      slot="point-stepper"
      noun="point"
      total={steps.length}
      at={at}
      count={`${steps.length} ${steps.length === 1 ? noun : `${noun}s`}`}
      onStep={(direction) => {
        const to = stepFrom(place, direction);
        if (to !== null) onGo(to);
      }}
      onOpenList={onOpenList}
      title={
        point !== undefined && (
          <button
            type="button"
            data-slot="stepper-title"
            className={STEPPER_TITLE}
            aria-label={`Go to ${label.toLowerCase()}: ${point.title}`}
            onClick={() => onGo(point.id)}
          >
            <Icon
              aria-hidden="true"
              className={cn("size-3.5 shrink-0", POINT_TONE[pointTone(point)].text)}
            />
            <span
              className={cn("min-w-0 truncate", dismissed && "text-muted-foreground line-through")}
            >
              {point.title}
            </span>
          </button>
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
