import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { LaptopIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ActivityDay,
  type ActivityLevel,
  activityDays,
  activityLevel,
  activityTotals,
  type LocalDate,
  type ReviewActivity,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import {
  busiestDay,
  dayCounts,
  dayName,
  localDateOf,
  MAX_WEEKS,
  monthLabels,
  moveDay,
  rowOf,
  SIDE_BY_SIDE_PX,
  weekdayDate,
  weeksFor,
} from "./activity-layout.ts";

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const LEVEL: Readonly<Record<ActivityLevel, string>> = {
  0: "border-input bg-card",
  1: "border-primary bg-activity-1",
  2: "border-primary bg-activity-2",
  3: "border-primary bg-activity-3",
  4: "border-primary bg-primary",
};

const LEGEND: readonly { readonly level: ActivityLevel; readonly label: string }[] = [
  { level: 0, label: "0" },
  { level: 1, label: "1" },
  { level: 2, label: "2" },
  { level: 3, label: "3–4" },
  { level: 4, label: "5+" },
];

const ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

const Square = ({ level, className }: { level: ActivityLevel; className?: string }) => (
  <span
    className={cn("flex items-center justify-center rounded-[4px] border", LEVEL[level], className)}
  >
    {level === 4 && <span className="size-1.5 rounded-full bg-primary-foreground" />}
  </span>
);

/** The card's content width, followed as it resizes; null where nothing measures it. */
const useWidth = (element: RefObject<HTMLElement | null>): number | null => {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const target = element.current;
    if (target === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return width;
};

const tooltip = TooltipPrimitive.createHandle<ActivityDay>();

const Calendar = ({
  days,
  today,
  weeks,
}: {
  readonly days: readonly ActivityDay[];
  readonly today: LocalDate;
  readonly weeks: number;
}) => {
  const [focused, setFocused] = useState<LocalDate>(today);
  const cells = useRef(new Map<LocalDate, HTMLElement>());
  const boundary = useRef<HTMLDivElement>(null);
  // A resize that drops the focused day gives the focus to the first day shown.
  const current = days.some((day) => day.date === focused) ? focused : (days[0]?.date ?? today);
  const months = monthLabels(days);
  const columns = Math.ceil(days.length / 7);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = days.findIndex((day) => day.date === current);
    const next = moveDay(event.key, index, days.length - 1);
    if (next === null) return;
    event.preventDefault();
    const day = days[next];
    if (day === undefined) return;
    setFocused(day.date);
    cells.current.get(day.date)?.focus();
  };

  return (
    <div ref={boundary} className="flex min-w-0 flex-col gap-3">
      <div
        aria-hidden="true"
        className="grid pl-8 text-caption text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${columns}, 24px)` }}
      >
        {months.map((month, column) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position.
          <span key={column} className="h-4 overflow-visible whitespace-nowrap">
            {month}
          </span>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a calendar of squares, not a table of data. */}
      <div
        role="grid"
        aria-label={`Review activity for the last ${weeks} weeks, one square per day. Use arrow keys to move between days.`}
        className="flex flex-col"
        onKeyDown={onKeyDown}
      >
        {ROW_LABELS.map((label, row) => (
          // biome-ignore lint/a11y/useFocusableInteractive: the cells inside take the focus.
          // biome-ignore lint/suspicious/noArrayIndexKey: a row is its weekday.
          // biome-ignore lint/a11y/useSemanticElements: a row of the calendar's grid, not of a table.
          <div key={row} role="row" className="flex items-center">
            <span aria-hidden="true" className="w-8 shrink-0 text-caption text-muted-foreground">
              {label}
            </span>
            {Array.from({ length: columns }, (_, column) => {
              const day = days[column * 7 + row];
              if (day === undefined || rowOf(day.date) !== row) {
                // biome-ignore lint/suspicious/noArrayIndexKey: an empty cell is its position.
                return <span key={column} className="size-6 shrink-0" />;
              }
              const level = activityLevel(day.pullRequests);
              return (
                <TooltipTrigger
                  key={day.date}
                  handle={tooltip}
                  payload={day}
                  delay={150}
                  render={
                    // biome-ignore lint/a11y/useSemanticElements: a grid's cell.
                    <div
                      ref={(element: HTMLDivElement | null) => {
                        if (element === null) cells.current.delete(day.date);
                        else cells.current.set(day.date, element);
                      }}
                      role="gridcell"
                      tabIndex={day.date === current ? 0 : -1}
                      aria-label={dayName(day, today)}
                      onFocus={() => setFocused(day.date)}
                      className="group flex size-6 shrink-0 items-center justify-center rounded-md"
                    />
                  }
                >
                  <Square
                    level={level}
                    className={cn(
                      "size-5 group-hover:ring-2 group-hover:ring-foreground",
                      day.date === today && "outline-2 outline-offset-1 outline-foreground",
                    )}
                  />
                </TooltipTrigger>
              );
            })}
          </div>
        ))}
      </div>
      <TooltipPrimitive.Root handle={tooltip}>
        {({ payload }) =>
          payload === undefined ? null : (
            <TooltipContent collisionBoundary={boundary.current ?? undefined}>
              <span className="flex flex-col">
                <span className="font-semibold">{weekdayDate(payload.date)}</span>
                <span>{dayCounts(payload)}</span>
              </span>
            </TooltipContent>
          )
        }
      </TooltipPrimitive.Root>
      <div
        aria-hidden="true"
        className="flex items-start gap-2 pl-8 text-caption text-muted-foreground"
      >
        <span className="leading-4">PRs a day</span>
        {LEGEND.map(({ level, label }) => (
          <span key={level} className="flex w-6 flex-col items-center gap-0.5">
            <Square level={level} className="size-4" />
            <span className="whitespace-nowrap">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

const Total = ({ value, label }: { readonly value: number; readonly label: string }) => (
  <div className="flex flex-col">
    <span className="text-title font-semibold tabular-nums">{value}</span>
    <span className="text-caption text-muted-foreground">{label}</span>
  </div>
);

/** The calendar of what the reviewer posted, under the lists. */
export const ReviewActivityCard = ({
  activity,
  error,
  onRetry,
  now,
}: {
  /** null before the first read. */
  readonly activity: ReviewActivity | null;
  readonly error: ApiError | null;
  readonly onRetry: () => void;
  readonly now: () => number;
}) => {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const width = useWidth(body);
  const weeks = weeksFor(width);
  const wide = width === null || width >= SIDE_BY_SIDE_PX;
  const nowMs = now();
  const today = localDateOf(nowMs);

  const shown = useMemo(
    () => (activity === null ? null : activityDays(activity, { today, weeks, dayOf: localDateOf })),
    [activity, today, weeks],
  );
  const allWeeks = useMemo(
    () =>
      activity === null
        ? null
        : activityDays(activity, { today, weeks: MAX_WEEKS, dayOf: localDateOf }),
    [activity, today],
  );
  const totals = shown === null ? null : activityTotals(shown);
  const nothingYet =
    allWeeks?.every((day) => day.pullRequests === 0 && day.comments === 0) === true;

  return (
    <section aria-labelledby={id} className="flex flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2.5">
        <h2 id={id} className="text-heading font-semibold">
          Review activity
        </h2>
        <span className="text-caption text-muted-foreground">Last {weeks} weeks</span>
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground max-sm:basis-full sm:ml-auto">
          <LaptopIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Reviews and comments posted from megareviewer on this machine
        </span>
      </div>
      <div ref={body} className="px-4 py-4">
        {shown === null || totals === null ? (
          error !== null ? (
            <p className={cn(DANGER, "flex flex-wrap items-baseline gap-x-2 text-caption")}>
              <span className="font-medium">Couldn't read your review activity.</span>
              <span>{errorMessage(error)}</span>
              <Button variant="link" className="h-6 min-w-6 px-1 text-caption" onClick={onRetry}>
                Try again
              </Button>
            </p>
          ) : (
            <Skeleton
              aria-label="Loading review activity"
              className="h-[244px] w-full motion-reduce:animate-none"
            />
          )
        ) : (
          <div className={cn("flex gap-8", wide ? "flex-row" : "flex-col")}>
            <div className="flex min-w-0 flex-col gap-3">
              <Calendar days={shown} today={today} weeks={weeks} />
              {nothingYet && (
                <p className="rounded-md bg-muted px-3 py-2 text-caption text-muted-foreground">
                  <span className="font-medium text-foreground">No reviews yet.</span> Open a pull
                  request above and post your review. Each day you review fills a square here.
                </p>
              )}
            </div>
            <div className={cn("flex flex-col gap-3", wide && "w-[260px] shrink-0")}>
              <div
                className={cn(
                  "grid gap-x-6 gap-y-3",
                  wide || (width !== null && width < 520) ? "grid-cols-2" : "grid-cols-4",
                )}
              >
                <Total value={totals.pullRequests} label="PRs reviewed" />
                <Total value={totals.comments} label="comments posted" />
                <Total value={totals.daysWithReviews} label="days with reviews" />
                <Total value={totals.thisWeek} label="PRs this week" />
              </div>
              {totals.busiest !== null && (
                <p className="border-t pt-3 text-caption text-muted-foreground">
                  {busiestDay(totals.busiest)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
