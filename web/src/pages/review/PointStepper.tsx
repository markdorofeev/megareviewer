import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Point, PointId, PointKind, PointState } from "../../../../src/domain/review/index.ts";
import { POINT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { stepFrom, stepperPlace } from "./stepper.ts";

const KIND_PLURALS: Readonly<Record<PointKind, string>> = {
  finding: "findings",
  risk: "risks",
  decision: "decisions",
};

/** The glyph's color, as its chip's text. */
const KIND_TEXT: Readonly<Record<PointKind, string>> = {
  finding: "text-review-changes",
  risk: "text-risk-contract",
  decision: "text-review-pending",
};

/**
 * Previous and Next through Claude's points, round from the last to the first, with the position
 * that opens the whole list and the current point's kind and title, which goes back to its card.
 * Before the first step, the position is a count.
 */
export const PointStepper = ({
  points,
  current,
  stateOf,
  kind,
  onGo,
  onOpenList,
}: {
  readonly points: readonly Point[];
  /** The point last gone to, by the stepper, the list, a mention or Raise. */
  readonly current: PointId | null;
  readonly stateOf: (id: PointId) => PointState;
  /** The kind a chip narrowed the steps to, or null for every point. */
  readonly kind: PointKind | null;
  readonly onGo: (id: PointId) => void;
  readonly onOpenList: () => void;
}) => {
  const place = stepperPlace(points, kind, current);
  const { steps, at } = place;
  const point = at === null ? undefined : steps[at];
  const step = (direction: 1 | -1) => {
    const to = stepFrom(place, direction);
    if (to !== null) onGo(to);
  };
  const count =
    kind === null || steps.length === 1
      ? `${steps.length} ${steps.length === 1 ? "point" : "points"}`
      : `${steps.length} ${KIND_PLURALS[kind]}`;
  const position = at === null ? count : `${at + 1} of ${steps.length}`;

  return (
    <span data-slot="point-stepper" className="flex min-w-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous point"
        disabled={steps.length === 0}
        onClick={() => step(-1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="tabular"
        aria-label={at === null ? `${count}, show all` : `Point ${position}, show all`}
        onClick={onOpenList}
      >
        {position}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next point"
        disabled={steps.length === 0}
        onClick={() => step(1)}
      >
        <ChevronRightIcon aria-hidden="true" />
      </Button>
      {point !== undefined && (
        <button
          type="button"
          data-slot="stepper-title"
          data-kind={point.kind}
          // The title gives way first as the bar narrows; the position stays.
          className="ml-1 flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1 text-left max-sm:hidden hover:bg-muted"
          aria-label={`Go to ${POINT_STATUS[point.kind].label.toLowerCase()}: ${point.title}`}
          onClick={() => onGo(point.id)}
        >
          <span aria-hidden="true" className={KIND_TEXT[point.kind]}>
            {POINT_STATUS[point.kind].glyph}
          </span>
          <span
            className={cn(
              "min-w-0 truncate",
              stateOf(point.id) === "dismissed" && "text-muted-foreground line-through",
            )}
          >
            {point.title}
          </span>
        </button>
      )}
      {/* A step says where it went: "Finding 2 of 5: Delay overflows after 31 attempts". */}
      <span role="status" className="sr-only">
        {point === undefined
          ? ""
          : `${POINT_STATUS[point.kind].label} ${position}: ${point.title}${
              stateOf(point.id) === "dismissed" ? " (dismissed)" : ""
            }`}
      </span>
    </span>
  );
};
