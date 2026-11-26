import { ChevronRightIcon, CodeIcon, RouteIcon, SparklesIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point, PointState } from "../../../../src/domain/review/index.ts";
import { holdInPlace } from "../../lib/held-scroll.ts";
import { FINDING_STATUS, POINT_TONE, pointTone } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
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
import { boxLabel, chipLabels, compactLabels } from "./tour-labels.ts";

// The Understand layout with a tour: a strip of the directories the steps reach, the steps, then
// what the tour didn't show. The window scrolls. The strip scrolls away with it, and a compact one
// takes its place under the bar: one strip that shrank when it stuck moved the steps under the
// reader by the difference, 780 px on a pull request with ten directories off the tour.

export const stepAnchor = (number: number): string => `tour-step-${number}`;
const groupAnchor = (id: LedgerGroupId): string => `tour-ledger-${id}`;
const END_TITLE = "tour-end-title";

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

/** A directory on the tour's path, with its steps' numbers; one line of it on the compact strip. */
const PathBox = ({
  box,
  current,
  compactName,
  focusable,
  onGo,
}: {
  readonly box: TourBox;
  readonly current: number | null;
  /** Its name on the compact strip; absent on the full one, which shows its parents too. */
  readonly compactName?: string;
  readonly focusable: boolean;
  readonly onGo: () => void;
}) => {
  const compact = compactName !== undefined;
  const isCurrent = current !== null && box.steps.includes(current);
  const { prefix, name } = boxLabel(box.label);
  return (
    <button
      type="button"
      data-slot="tour-box"
      aria-label={`${box.label}, ${box.steps.length === 1 ? "step" : "steps"} ${listOf(box.steps)}${isCurrent ? ", current step" : ""}`}
      title={box.label}
      {...(isCurrent ? { "aria-current": "step" as const } : {})}
      {...(focusable ? {} : { tabIndex: -1 })}
      onClick={onGo}
      className={cn(
        "relative flex min-w-0 shrink-0 cursor-pointer rounded-lg text-left",
        compact
          ? "max-w-md items-center gap-1.5 px-2 py-1"
          : "max-w-60 min-w-36 flex-col items-stretch gap-0.5 px-2.5 py-2",
        isCurrent ? "border-2 border-primary bg-background" : "border border-primary bg-ai-soft",
      )}
    >
      {!compact && prefix !== "" && (
        <span className="truncate font-mono text-caption text-muted-foreground">{prefix}</span>
      )}
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono font-semibold text-ui">
          {compactName ?? name}
        </span>
        <span className="flex shrink-0 gap-1">
          {box.steps.map((number) => (
            <StepNumber key={number} number={number} current={number === current} />
          ))}
        </span>
      </span>
      {isCurrent && (
        <span
          className={cn(
            "shrink-0 rounded-full bg-primary px-1.5 font-semibold text-caption text-primary-foreground",
            !compact && "absolute -bottom-2.5 left-2",
          )}
        >
          Current step
        </span>
      )}
    </button>
  );
};

/** The directories the steps reach, in the order they first reach them, with arrows between. */
const PathBoxes = ({
  tour,
  current,
  compact,
  focusable,
  onGoToStep,
}: {
  readonly tour: TourView;
  readonly current: number | null;
  readonly compact: boolean;
  readonly focusable: boolean;
  readonly onGoToStep: (number: number) => void;
}) => {
  const names = compact ? compactLabels(tour.boxes.map((box) => box.label)) : null;
  const boxAt = (at: number) => {
    const box = tour.boxes[at];
    if (box === undefined) return null;
    const compactName = names?.[at];
    return (
      <PathBox
        key={box.key}
        box={box}
        current={current}
        {...(compactName === undefined ? {} : { compactName })}
        focusable={focusable}
        onGo={() => onGoToStep(Math.min(...box.steps))}
      />
    );
  };
  const items: ReactNode[] = [];
  for (let at = 0; at < tour.boxes.length; at += 1) {
    const box = tour.boxes[at];
    if (box === undefined) continue;
    const span = tour.spans.find((one) => one.keys[0] === box.key);
    if (at > 0) {
      items.push(
        <ChevronRightIcon
          key={`arrow-${box.key}`}
          aria-hidden="true"
          className="size-4 shrink-0 text-primary"
        />,
      );
    }
    if (span !== undefined && tour.boxes[at + 1] !== undefined) {
      items.push(
        // biome-ignore lint/a11y/useSemanticElements: a group of two boxes, not of form controls.
        <div
          key={`span-${box.key}`}
          role="group"
          aria-label={`Step ${span.step} spans both`}
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-xl border-[1.5px] border-dashed border-primary",
            compact ? "px-1.5 py-1" : "flex-col items-start px-1.5 pt-1 pb-1.5",
          )}
        >
          <span className="text-caption font-medium text-primary">Step {span.step} spans both</span>
          <div className="flex min-w-0 items-center gap-1">
            {boxAt(at)}
            <span aria-hidden="true" className="text-primary">
              +
            </span>
            {boxAt(at + 1)}
          </div>
        </div>,
      );
      at += 1;
    } else {
      items.push(boxAt(at));
    }
  }
  return items;
};

/**
 * The tour's path and, under it, the directories it leaves out, each a chip that goes to its group
 * in Not in the tour. Part of the page: it scrolls away, so its height costs the steps nothing.
 */
const TourStrip = ({
  tour,
  current,
  onGoToStep,
  onGoToGroup,
}: {
  readonly tour: TourView;
  readonly current: number | null;
  readonly onGoToStep: (number: number) => void;
  readonly onGoToGroup: (id: LedgerGroupId) => void;
}) => {
  const chips = chipLabels(tour.others.map((box) => box.label));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not of form controls.
    <div
      data-slot="tour-strip"
      role="group"
      aria-label="Directories on the tour"
      className="flex flex-col gap-3 border-b pt-3 pb-4"
    >
      {/* A row apart from the next by more than the "Current step" label hangs under its box. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-4">
        <PathBoxes
          tour={tour}
          current={current}
          compact={false}
          focusable
          onGoToStep={onGoToStep}
        />
      </div>
      {tour.others.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-caption text-muted-foreground">Not on the tour</span>
          {tour.others.map((box, at) => (
            <button
              key={box.key}
              type="button"
              data-slot="tour-box"
              aria-label={`${box.label}, no step, see Not in the tour`}
              title={box.label}
              onClick={() => {
                if (box.group !== null) onGoToGroup(box.group);
              }}
              className="max-w-full cursor-pointer truncate rounded-md border border-dashed border-input bg-background px-2 py-1 font-mono text-caption hover:bg-surface-row"
            >
              {chips[at]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The path on one line, under the bar. Beside the full strip it's drawn over the page once that
 * one has scrolled away, taking no room, and only for the pointer: the full strip is the one a
 * keyboard and a screen reader find. Below 1180 px it's the only strip, and part of the page.
 */
const CompactStrip = ({
  tour,
  current,
  overlay,
  shown,
  onGoToStep,
  onGoToEnd,
}: {
  readonly tour: TourView;
  readonly current: number | null;
  readonly overlay: boolean;
  readonly shown: boolean;
  readonly onGoToStep: (number: number) => void;
  readonly onGoToEnd: () => void;
}) => (
  <div
    data-slot="tour-strip-compact"
    {...(overlay ? { "aria-hidden": true } : {})}
    className={cn("sticky top-(--review-bar-h) z-10", overlay && "h-0")}
  >
    {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not of form controls. */}
    <div
      role="group"
      aria-label="Directories on the tour"
      className={cn(
        "flex flex-wrap items-center gap-1.5 border-b bg-background px-1 py-2",
        overlay ? "absolute -inset-x-1 top-0" : "-mx-1",
        overlay && !shown && "invisible",
      )}
    >
      <PathBoxes
        tour={tour}
        current={current}
        compact
        focusable={!overlay}
        onGoToStep={onGoToStep}
      />
      {tour.others.length > 0 && (
        <button
          type="button"
          data-slot="tour-off"
          {...(overlay ? { tabIndex: -1 } : {})}
          onClick={onGoToEnd}
          className="ml-1 cursor-pointer rounded-md border border-dashed border-input bg-background px-2 py-1 text-caption text-muted-foreground hover:bg-surface-row"
        >
          {count(tour.others.length, "directory", "directories")} not on the tour
        </button>
      )}
    </div>
  </div>
);

/** One of Claude's points as a chip: its icon and word, its title, a click to its card. */
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
  const { icon: Icon, label } = FINDING_STATUS;
  const dismissed = state === "dismissed";
  return (
    <button
      type="button"
      data-slot="tour-point"
      onClick={onOpen}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-body",
        wide ? "w-full max-w-4xl" : "w-fit max-w-full",
        POINT_TONE[pointTone(point)].chip,
      )}
    >
      <Icon aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
      <span className="font-semibold">{label}</span>
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
      aria-labelledby={END_TITLE}
      data-slot="tour-end"
      className="flex flex-col gap-5 py-6 lg:pl-10"
    >
      <h2 id={END_TITLE} tabIndex={-1} className="font-semibold text-heading outline-none">
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
          <h3 className="font-semibold text-body">Findings outside the steps</h3>
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

/** How tall the compact strip is, and where under the bar it sticks. */
const stripGeometry = (sticky: HTMLElement | null) => ({
  top: sticky === null ? 0 : Number.parseFloat(getComputedStyle(sticky).top) || 0,
  height: sticky?.firstElementChild?.getBoundingClientRect().height ?? 0,
});

/**
 * The step whose top last passed under the compact strip, as the window scrolls, and whether that
 * strip has reached the bar, which is when the full one above it has scrolled away.
 */
const useCurrentStep = (
  container: React.RefObject<HTMLDivElement | null>,
  sticky: () => HTMLElement | null,
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
      const bar = sticky();
      if (root === null || bar === null) return;
      const { top, height } = stripGeometry(bar);
      const at = bar.getBoundingClientRect().top;
      const line = at + height + 8;
      const sections = [...root.querySelectorAll<HTMLElement>("[data-slot=tour-step]")];
      let passed = sections.length > 0 ? 1 : null;
      sections.forEach((section, index) => {
        if (section.getBoundingClientRect().top <= line) passed = index + 1;
      });
      if (pinned.current === null) setCurrent(passed);
      // At its place under the bar, not past it: where nothing holds it there it scrolls away.
      setStuck(window.scrollY > 0 && Math.abs(at - top) <= 1);
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
  }, [container, sticky]);
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
  readonly landOn?: {
    readonly step: number;
    readonly n: number;
    /** Back from the code, where the window is put back as the reader left it: focus only. */
    readonly inPlace?: boolean;
  } | null;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const sticky = useCallback(
    () => container.current?.querySelector<HTMLElement>("[data-slot=tour-strip-compact]") ?? null,
    [],
  );
  const { current, stuck, pin } = useCurrentStep(container, sticky, tour.steps.length);
  const narrow = useNarrow();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<LedgerGroupId>>(new Set());
  const [flashed, setFlashed] = useState<LedgerGroupId | null>(null);

  const reported = useRef(onCurrentStep);
  reported.current = onCurrentStep;
  useEffect(() => reported.current?.(current), [current]);

  /** Scrolls `element` under the compact strip, instantly: nothing moves on its own. */
  const scrollUnderStrip = useCallback(
    (element: HTMLElement) => {
      const { top: barTop, height } = stripGeometry(sticky());
      const top = window.scrollY + element.getBoundingClientRect().top - barTop - height - 4;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    },
    [sticky],
  );

  const [going, setGoing] = useState<{ readonly step: number; readonly n: number } | null>(null);
  const goToStep = useCallback((step: number) => {
    setGoing((previous) => ({ step, n: (previous?.n ?? 0) + 1 }));
  }, []);
  // The step at the top under the compact strip, focused and current.
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

  const goToEnd = () => {
    const title = document.getElementById(END_TITLE);
    if (title === null) return;
    scrollUnderStrip(title);
    title.focus({ preventScroll: true });
  };

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
    if (landOn.inPlace === true) {
      document
        .getElementById(stepAnchor(landOn.step))
        ?.querySelector<HTMLElement>("h2")
        ?.focus({ preventScroll: true });
      if (landOn.step > 0) pin(landOn.step);
      return;
    }
    if (landOn.step > 0) return goToStep(landOn.step);
    const root = container.current;
    if (root === null) return;
    const bar =
      document.querySelector("[data-slot=review-bar]")?.getBoundingClientRect().height ?? 0;
    const top = window.scrollY + root.getBoundingClientRect().top - bar - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, [landOn, goToStep, pin]);

  return (
    <div ref={container} data-slot="understand" className="flex min-w-0 flex-col">
      {!narrow && (
        <TourStrip tour={tour} current={current} onGoToStep={goToStep} onGoToGroup={goToGroup} />
      )}
      <CompactStrip
        tour={tour}
        current={current}
        overlay={!narrow}
        shown={stuck}
        onGoToStep={goToStep}
        onGoToEnd={goToEnd}
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
