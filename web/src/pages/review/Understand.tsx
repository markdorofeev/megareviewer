import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  RouteIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point, PointState } from "../../../../src/domain/review/index.ts";
import { POINT_ICON, POINT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { holdInPlace } from "./heldScroll.ts";
import { ModelText } from "./IntentLine.tsx";
import {
  depthText,
  type LedgerGroupId,
  listOf,
  type TourBox,
  type TourExcerpt,
  type TourStep,
  type TourView,
} from "./tour.ts";

// The Understand layout with a tour: a strip of the directories the steps reach, the steps, then
// what the tour didn't show. The window scrolls; the strip sticks under the bar.

export const stepAnchor = (number: number): string => `tour-step-${number}`;
const groupAnchor = (id: LedgerGroupId): string => `tour-ledger-${id}`;

/** "src/routes/" as its parents, muted, and its last directory. */
const splitLabel = (label: string): { readonly prefix: string; readonly name: string } => {
  const trimmed = label.endsWith("/") ? label.slice(0, -1) : label;
  const cut = trimmed.lastIndexOf("/");
  return cut === -1
    ? { prefix: "", name: trimmed || label }
    : { prefix: trimmed.slice(0, cut + 1), name: trimmed.slice(cut + 1) };
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const linesLabel = (excerpt: TourExcerpt): string => {
  const { startLine, line, side } = excerpt.lines;
  const range = startLine === line ? `line ${line}` : `lines ${startLine}–${line}`;
  return side === "old" ? `base ${range}` : range;
};

const StepNumber = ({
  number,
  current,
}: {
  readonly number: number;
  readonly current: boolean;
}) => (
  <span
    className={cn(
      "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-primary font-semibold text-caption tabular-nums",
      current ? "bg-primary text-primary-foreground" : "text-primary",
    )}
  >
    {number}
  </span>
);

/** A directory on the strip: on the tour with its steps' numbers, or dashed with no step. */
const StripBox = ({
  box,
  current,
  compact,
  onGo,
}: {
  readonly box: TourBox;
  readonly current: number | null;
  readonly compact: boolean;
  readonly onGo: () => void;
}) => {
  const onTour = box.steps.length > 0;
  const isCurrent = current !== null && box.steps.includes(current);
  const { prefix, name } = splitLabel(box.label);
  const label = onTour
    ? `${box.label}, ${box.steps.length === 1 ? "step" : "steps"} ${listOf(box.steps)}${isCurrent ? ", current step" : ""}`
    : `${box.label}, no step, see Not in the tour`;
  return (
    <button
      type="button"
      data-slot="tour-box"
      aria-label={label}
      {...(isCurrent ? { "aria-current": "step" as const } : {})}
      onClick={onGo}
      className={cn(
        "relative flex min-w-0 shrink-0 cursor-pointer flex-col items-start rounded-lg text-left",
        compact
          ? "flex-row items-center gap-1.5 px-2 py-1"
          : "min-w-36 max-w-60 gap-0.5 px-2.5 py-2",
        onTour
          ? isCurrent
            ? "border-2 border-primary bg-background"
            : "border border-primary bg-ai-soft"
          : "border border-dashed border-input bg-background",
      )}
    >
      <span className={cn("flex min-w-0 items-start gap-2", compact && "items-center")}>
        <span className="min-w-0 font-mono">
          {!compact && prefix !== "" && (
            <span className="block truncate text-caption text-muted-foreground">{prefix}</span>
          )}
          <span className="block truncate font-semibold text-ui">{name}</span>
        </span>
        {onTour && (
          <span className="flex shrink-0 gap-1">
            {box.steps.map((number) => (
              <StepNumber key={number} number={number} current={number === current} />
            ))}
          </span>
        )}
      </span>
      {!onTour && !compact && <span className="text-caption text-muted-foreground">No step</span>}
      {isCurrent && (
        <span
          className={cn(
            "rounded-full bg-primary px-1.5 font-semibold text-caption text-primary-foreground",
            compact ? "" : "absolute -bottom-2.5 left-2",
          )}
        >
          Current step
        </span>
      )}
    </button>
  );
};

/** The directories the steps reach, in order, then the others; sticky, compact once stuck. */
const TourStrip = ({
  tour,
  current,
  compact,
  onGoToStep,
  onGoToGroup,
}: {
  readonly tour: TourView;
  readonly current: number | null;
  readonly compact: boolean;
  readonly onGoToStep: (number: number) => void;
  readonly onGoToGroup: (id: LedgerGroupId) => void;
}) => {
  const lowest = (box: TourBox) => Math.min(...box.steps);
  const items: ReactNode[] = [];
  for (let at = 0; at < tour.boxes.length; at += 1) {
    const box = tour.boxes[at];
    if (box === undefined) continue;
    const span = tour.spans.find((one) => one.keys[0] === box.key);
    const next = span === undefined ? undefined : tour.boxes[at + 1];
    if (at > 0) {
      items.push(
        <ChevronRightIcon
          key={`arrow-${box.key}`}
          aria-hidden="true"
          className="size-4 shrink-0 text-primary"
        />,
      );
    }
    if (span !== undefined && next !== undefined) {
      items.push(
        // biome-ignore lint/a11y/useSemanticElements: a group of two boxes, not of form controls.
        <div
          key={`span-${box.key}`}
          role="group"
          aria-label={`Step ${span.step} spans both`}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-xl border-[1.5px] border-dashed border-primary",
            compact ? "px-1.5 py-1" : "flex-col items-start px-1.5 pt-1 pb-1.5",
          )}
        >
          <span className="text-caption font-medium text-primary">Step {span.step} spans both</span>
          <div className="flex items-center gap-1">
            <StripBox
              box={box}
              current={current}
              compact={compact}
              onGo={() => onGoToStep(lowest(box))}
            />
            <span aria-hidden="true" className="text-primary">
              +
            </span>
            <StripBox
              box={next}
              current={current}
              compact={compact}
              onGo={() => onGoToStep(lowest(next))}
            />
          </div>
        </div>,
      );
      at += 1;
    } else {
      items.push(
        <StripBox
          key={box.key}
          box={box}
          current={current}
          compact={compact}
          onGo={() => onGoToStep(lowest(box))}
        />,
      );
    }
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not of form controls.
    <div
      data-slot="tour-strip"
      role="group"
      aria-label="Directories on the tour"
      className={cn(
        "sticky top-(--review-bar-h) z-10 -mx-1 flex flex-wrap items-start gap-3 border-b bg-background px-1",
        compact ? "py-2" : "py-3 pb-4",
      )}
    >
      {/* The tour's path keeps its width; the directories off it wrap in what's left, or below. */}
      <div className="flex max-w-full flex-wrap items-center gap-1.5">{items}</div>
      {tour.others.length > 0 && (
        <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-1.5 border-l pl-3">
          {!compact && (
            <span className="w-full text-caption text-muted-foreground">Not on the tour</span>
          )}
          {tour.others.map((box) => (
            <StripBox
              key={box.key}
              box={box}
              current={null}
              compact={compact}
              onGo={() => {
                if (box.group !== null) onGoToGroup(box.group);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** One of Claude's points as a chip: its glyph and kind in words, its title, a click to its card. */
const PointChip = ({
  point,
  state,
  onOpen,
  wide = false,
  after,
}: {
  readonly point: Point;
  readonly state: PointState;
  readonly onOpen: () => void;
  readonly wide?: boolean;
  readonly after?: ReactNode;
}) => {
  const status = POINT_STATUS[point.kind];
  const Icon = POINT_ICON[point.kind];
  const dismissed = state === "dismissed";
  return (
    <button
      type="button"
      data-slot="tour-point"
      onClick={onOpen}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-body",
        wide ? "w-full max-w-4xl" : "w-fit max-w-full",
        status.className,
      )}
    >
      <Icon aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
      <span className="font-semibold">{status.label}</span>
      <span className={cn("min-w-0", dismissed && "line-through")}>
        <ModelText text={point.title} />
        {dismissed && <span className="sr-only">, dismissed</span>}
        {after}
      </span>
    </button>
  );
};

const StepSection = ({
  step,
  current,
  stateOf,
  renderExcerpt,
  onOpenPoint,
  onOpenInCode,
}: {
  readonly step: TourStep;
  readonly current: boolean;
  readonly stateOf: (point: Point) => PointState;
  readonly renderExcerpt: (excerpt: TourExcerpt) => ReactNode;
  readonly onOpenPoint: (point: Point) => void;
  readonly onOpenInCode: (step: TourStep, excerpt: TourExcerpt) => void;
}) => {
  const heading = `${stepAnchor(step.number)}-title`;
  return (
    <section
      id={stepAnchor(step.number)}
      data-slot="tour-step"
      aria-labelledby={heading}
      {...(current ? { "aria-current": "step" as const } : {})}
      className="grid grid-cols-[1.5rem_1fr] gap-x-2.5 border-b py-5 lg:grid-cols-[1.875rem_1fr]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "text-right font-semibold text-heading tabular-nums",
          current ? "text-primary" : "text-muted-foreground",
        )}
      >
        {step.number}
      </span>
      <div className="flex min-w-0 flex-col gap-2.5">
        <h2 id={heading} tabIndex={-1} className="font-semibold text-heading outline-none">
          <span className="sr-only">Step {step.number}: </span>
          <ModelText text={step.sentence} />
        </h2>
        {step.points.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {step.points.map((point) => (
              <PointChip
                key={point.id}
                point={point}
                state={stateOf(point)}
                onOpen={() => onOpenPoint(point)}
              />
            ))}
          </div>
        )}
        {step.excerpts.map((excerpt) => {
          const cut = excerpt.path.lastIndexOf("/") + 1;
          return (
            <div
              key={excerpt.key}
              data-slot="tour-card"
              className="mt-1 min-w-0 overflow-hidden rounded-lg border bg-card"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
                <span className="min-w-0 font-mono text-code-compact">
                  <span className="text-muted-foreground">{excerpt.path.slice(0, cut)}</span>
                  <span className="font-medium">{excerpt.path.slice(cut)}</span>
                </span>
                <span className="text-caption text-muted-foreground">
                  {linesLabel(excerpt)} · {excerpt.shown} of{" "}
                  {count(excerpt.fileChanged, "changed line")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-primary"
                  aria-label={`Open ${excerpt.path} ${linesLabel(excerpt)} in code`}
                  onClick={() => onOpenInCode(step, excerpt)}
                >
                  <CodeIcon aria-hidden="true" />
                  Open in code
                </Button>
              </div>
              {renderExcerpt(excerpt)}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const LineCounts = ({ added, deleted }: { readonly added: number; readonly deleted: number }) => (
  <span className="font-mono text-code-compact">
    {added > 0 && <span className="text-stat-add">+{added}</span>}
    {added > 0 && deleted > 0 && " "}
    {deleted > 0 && <span className="text-stat-del">−{deleted}</span>}
  </span>
);

/** What the tour didn't show, Claude's points outside it, and where to read in the code. */
const TourEnd = ({
  tour,
  stateOf,
  openGroups,
  onToggleGroup,
  flashed,
  onOpenFile,
  onOpenPoint,
}: {
  readonly tour: TourView;
  readonly stateOf: (point: Point) => PointState;
  readonly openGroups: ReadonlySet<LedgerGroupId>;
  readonly onToggleGroup: (id: LedgerGroupId, open: boolean) => void;
  readonly flashed: LedgerGroupId | null;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenPoint: (point: Point) => void;
}) => {
  const files = tour.ledger.reduce((sum, group) => sum + group.files.length, 0);
  return (
    <section
      aria-labelledby="tour-end-title"
      data-slot="tour-end"
      className="flex flex-col gap-5 py-6 lg:pl-10"
    >
      <h2 id="tour-end-title" className="font-semibold text-heading">
        After the tour
      </h2>
      {tour.ledger.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-semibold text-body">
            Not in the tour{" "}
            <span className="font-normal text-muted-foreground">· {count(files, "file")}</span>
          </h3>
          {tour.ledger.map((group) => {
            const added = group.files.reduce((sum, file) => sum + file.added, 0);
            const deleted = group.files.reduce((sum, file) => sum + file.deleted, 0);
            return (
              <details
                key={group.id}
                id={groupAnchor(group.id)}
                open={openGroups.has(group.id)}
                onToggle={(event) => onToggleGroup(group.id, event.currentTarget.open)}
                className={cn(
                  "group max-w-3xl rounded-lg border bg-card",
                  flashed === group.id && "border-primary ring-2 ring-ai-soft-bd",
                )}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-body [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
                  />
                  <span className="font-medium">{group.label}</span>
                  <span className="ml-auto text-ui text-muted-foreground">
                    {count(group.files.length, "file")} ·{" "}
                    <LineCounts added={added} deleted={deleted} />
                  </span>
                </summary>
                <ul className="flex flex-col border-t py-1">
                  {group.files.map((file) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => onOpenFile(file.path)}
                        className="flex w-full cursor-pointer items-center gap-3 px-3 py-1 text-left hover:bg-surface-row"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-code-compact">
                          {file.path}
                        </span>
                        <LineCounts added={file.added} deleted={file.deleted} />
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
      {tour.outside.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-semibold text-body">Findings and risks outside the steps</h3>
          {tour.outside.map((point) => (
            <PointChip
              key={point.id}
              point={point}
              state={stateOf(point)}
              wide
              onOpen={() => onOpenPoint(point)}
              after={
                point.path === null ? null : (
                  <span className="font-mono text-code-compact">
                    {" "}
                    · {point.path.slice(point.path.lastIndexOf("/") + 1)}
                  </span>
                )
              }
            />
          ))}
        </div>
      )}
      <div
        data-slot="tour-depth"
        className="flex max-w-4xl items-start gap-2 rounded-lg border border-ai-soft-bd bg-ai-soft px-4 py-3 text-body"
      >
        <SparklesIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
        <div>
          <h3 className="font-semibold">Suggested depth</h3>
          <p>{depthText(tour.depth)}</p>
        </div>
      </div>
    </section>
  );
};

/** The step whose top last passed under the strip, as the window scrolls. */
const useCurrentStep = (
  container: React.RefObject<HTMLDivElement | null>,
  strip: () => HTMLElement | null,
  count: number,
) => {
  const [current, setCurrent] = useState<number | null>(count > 0 ? 1 : null);
  const [stuck, setStuck] = useState(false);
  // A step the page went to stays current until the reader moves, whatever the geometry says.
  const pinned = useRef<number | null>(null);
  const pin = useCallback((step: number) => {
    pinned.current = step;
    setCurrent(step);
  }, []);
  useEffect(() => {
    const unpin = () => {
      pinned.current = null;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const event of events) window.addEventListener(event, unpin, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, unpin);
    };
  }, []);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const root = container.current;
      const bar = strip();
      if (root === null || bar === null) return;
      const line = bar.getBoundingClientRect().bottom + 8;
      const sections = [...root.querySelectorAll<HTMLElement>("[data-slot=tour-step]")];
      let passed = sections.length > 0 ? 1 : null;
      sections.forEach((section, at) => {
        if (section.getBoundingClientRect().top <= line) passed = at + 1;
      });
      if (pinned.current === null) setCurrent(passed);
      const barHeight = Number.parseFloat(getComputedStyle(bar).top) || 0;
      setStuck(window.scrollY > 0 && bar.getBoundingClientRect().top <= barHeight + 1);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [container, strip]);
  return { current, stuck, pin };
};

const useNarrow = () => {
  const query = "(max-width: 1179px)";
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const change = () => setNarrow(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return narrow;
};

export const Understand = ({
  tour,
  stateOf,
  renderExcerpt,
  onOpenPoint,
  onOpenFile,
  onOpenInCode,
  onCurrentStep,
  landOn = null,
}: {
  readonly tour: TourView;
  readonly stateOf: (point: Point) => PointState;
  readonly renderExcerpt: (excerpt: TourExcerpt) => ReactNode;
  readonly onOpenPoint: (point: Point) => void;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenInCode: (step: TourStep, excerpt: TourExcerpt) => void;
  /** Told the step now current as the window scrolls, to come back to it. */
  readonly onCurrentStep?: (number: number | null) => void;
  /** A step to go to once drawn, as when coming back from the code; 0 for the tour's top. */
  readonly landOn?: { readonly step: number; readonly n: number } | null;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const strip = useCallback(
    () => container.current?.querySelector<HTMLElement>("[data-slot=tour-strip]") ?? null,
    [],
  );
  const { current, stuck, pin } = useCurrentStep(container, strip, tour.steps.length);
  const narrow = useNarrow();
  // Going to a step compacts the strip first, so the step lands under the strip it'll stay under.
  const [forced, setForced] = useState(false);
  const compact = stuck || narrow || forced;
  useEffect(() => {
    const top = () => {
      if (window.scrollY === 0) setForced(false);
    };
    window.addEventListener("scroll", top, { passive: true });
    return () => window.removeEventListener("scroll", top);
  }, []);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<LedgerGroupId>>(new Set());
  const [flashed, setFlashed] = useState<LedgerGroupId | null>(null);

  const reported = useRef(onCurrentStep);
  reported.current = onCurrentStep;
  useEffect(() => reported.current?.(current), [current]);

  /** Scrolls `element` under the strip, instantly: nothing moves on its own. */
  const scrollUnderStrip = useCallback(
    (element: HTMLElement) => {
      const bar = strip();
      const below = bar === null ? 0 : bar.getBoundingClientRect().height;
      const barTop = bar === null ? 0 : Number.parseFloat(getComputedStyle(bar).top) || 0;
      const top = window.scrollY + element.getBoundingClientRect().top - barTop - below - 4;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    },
    [strip],
  );

  const [going, setGoing] = useState<{ readonly step: number; readonly n: number } | null>(null);
  const goToStep = useCallback((step: number) => {
    setForced(true);
    setGoing((previous) => ({ step, n: (previous?.n ?? 0) + 1 }));
  }, []);
  // Once the strip is compact: the step at the top under it, focused and current.
  useLayoutEffect(() => {
    if (going === null) return;
    const section = document.getElementById(stepAnchor(going.step));
    if (section === null) return;
    scrollUnderStrip(section);
    section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    pin(going.step);
    // Steps above it take their size once near the window, and would push it down.
    return holdInPlace("[data-slot=understand]", () => scrollUnderStrip(section));
  }, [going, scrollUnderStrip, pin]);

  const goToGroup = (id: LedgerGroupId) => {
    setOpenGroups((previous) => new Set([...previous, id]));
    setFlashed(id);
    window.setTimeout(() => setFlashed((now) => (now === id ? null : now)), 1600);
    const group = document.getElementById(groupAnchor(id));
    if (group !== null) {
      scrollUnderStrip(group);
      group.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
  };

  const landed = useRef<number | null>(null);
  useEffect(() => {
    if (landOn === null || landed.current === landOn.n) return;
    landed.current = landOn.n;
    if (landOn.step > 0) return goToStep(landOn.step);
    const root = container.current;
    if (root === null) return;
    const bar =
      document.querySelector("[data-slot=review-bar]")?.getBoundingClientRect().height ?? 0;
    const top = window.scrollY + root.getBoundingClientRect().top - bar - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, [landOn, goToStep]);

  return (
    <div ref={container} data-slot="understand" className="flex min-w-0 flex-col">
      <TourStrip
        tour={tour}
        current={current}
        compact={compact}
        onGoToStep={goToStep}
        onGoToGroup={goToGroup}
      />
      <section className="max-w-[73.75rem]" aria-label="Tour steps">
        {tour.steps.map((step) => (
          <StepSection
            key={step.id}
            step={step}
            current={step.number === current}
            stateOf={stateOf}
            renderExcerpt={renderExcerpt}
            onOpenPoint={onOpenPoint}
            onOpenInCode={onOpenInCode}
          />
        ))}
        <TourEnd
          tour={tour}
          stateOf={stateOf}
          openGroups={openGroups}
          onToggleGroup={(id, open) =>
            setOpenGroups((previous) => {
              if (previous.has(id) === open) return previous;
              const next = new Set(previous);
              if (open) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          flashed={flashed}
          onOpenFile={onOpenFile}
          onOpenPoint={onOpenPoint}
        />
      </section>
    </div>
  );
};

/** Why Understand shows the overview instead of a tour, in one line. */
export const NoTourLine = ({
  children,
  busy,
}: {
  readonly children: ReactNode;
  readonly busy?: boolean;
}) => (
  <p
    data-slot="no-tour"
    {...(busy ? { role: "status" } : {})}
    className="flex items-center gap-2 text-ui text-muted-foreground"
  >
    <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
    {children}
  </p>
);

/** The landing label's anchor, which Open in code scrolls to. */
export const TOUR_LANDING = "tour-landing";

/** Over the excerpt's lines in the map: which step of the tour they are. */
export const TourLanding = ({
  step,
  excerpt,
}: {
  readonly step: TourStep;
  readonly excerpt: TourExcerpt;
}) => (
  <p
    id={TOUR_LANDING}
    data-slot="tour-landing"
    className="scroll-mt-24 flex flex-wrap items-center gap-x-1.5 border-b bg-ai-soft px-3 py-1.5 text-ui text-primary"
  >
    <RouteIcon aria-hidden="true" className="size-3.5 shrink-0" />
    <span className="font-semibold">Tour step {step.number}</span>
    <span aria-hidden="true">·</span>
    <span>{linesLabel(excerpt)}</span>
    <span aria-hidden="true">·</span>
    <span className="text-foreground">
      <ModelText text={step.sentence} />
    </span>
  </p>
);

/** The bar's second row in the map, once it was opened from a step: back to it, or put away. */
export const BackToTour = ({
  step,
  onBack,
  onDismiss,
}: {
  readonly step: number;
  readonly onBack: () => void;
  readonly onDismiss: () => void;
}) => (
  <div
    data-slot="back-to-tour"
    className="sticky top-(--review-bar-row) z-20 -mt-px flex h-9 items-center gap-2 border-b bg-background"
  >
    <Button
      variant="outline"
      size="sm"
      className="border-ai-soft-bd bg-ai-soft text-primary hover:bg-ai-soft-hover"
      onClick={onBack}
    >
      <ArrowLeftIcon aria-hidden="true" />
      Back to tour · Step {step}
    </Button>
    <Button variant="ghost" size="icon-sm" aria-label="Hide Back to tour" onClick={onDismiss}>
      <XIcon aria-hidden="true" />
    </Button>
  </div>
);
