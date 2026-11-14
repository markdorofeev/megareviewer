import { EyeOffIcon, PencilIcon, XIcon } from "lucide-react";
import { memo, type ReactNode, useId } from "react";
import {
  type IntentMismatchKind,
  type Point,
  type PointId,
  type PointState,
  parseBody,
  type Severity,
} from "../../../../src/domain/review/index.ts";
import { POINT_ICON, POINT_STATUS } from "../../lib/status.ts";
import { cn, cssVars } from "../../lib/utils.ts";
import { CHIP, lineRef, RefChip, SuggestionDiff, ThreadBody } from "../../review/thread/index.ts";
import { Button } from "../../ui/button.tsx";

export const pointAnchor = (id: PointId): string => `point-${id}`;

const MISMATCH_LABEL: Readonly<Record<IntentMismatchKind, string>> = {
  contradicts: "Contradicts what was asked",
  missing: "Asked for, not done",
  unrequested: "Done, not asked for",
};

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const KIND_TEXT: Readonly<Record<Point["kind"], string>> = {
  finding: "text-review-changes",
  risk: "text-risk-contract",
  decision: "text-muted-foreground",
};

/** What every point's actions need. */
export interface PointActions {
  readonly state: PointState;
  readonly saving: boolean;
  /** After publishing, and before the analysis is complete, a point can't be acted on. */
  readonly readOnly: boolean;
  /** The point the list or Next is on. */
  readonly current: boolean;
  /**
   * Comments on the point's lines: `add` saves its text as a draft that posts with the review;
   * otherwise the comment box opens on it first.
   */
  readonly onRaise: (point: Point, add: boolean) => void;
  readonly onState: (id: PointId, state: PointState) => void;
}

const Kind = ({ kind }: { readonly kind: Point["kind"] }) => {
  const Icon = POINT_ICON[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", KIND_TEXT[kind])}>
      <Icon aria-hidden="true" className="size-3.5" />
      {POINT_STATUS[kind].label}
    </span>
  );
};

/** A point folded to one line, dismissed or already in the review, with a way back. */
const Folded = ({
  point,
  state,
  current,
  note,
  action,
  className,
}: {
  readonly point: Point;
  readonly state: PointState;
  readonly current: boolean;
  readonly note: string;
  readonly action: ReactNode;
  readonly className?: string;
}) => {
  const Icon = POINT_ICON[point.kind];
  return (
    <article
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind={point.kind}
      data-state={state}
      data-current={current || undefined}
      aria-label={point.title}
      className={cn(
        "flex scroll-mt-24 flex-wrap items-center gap-2 text-muted-foreground",
        className,
        current && RING,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{POINT_STATUS[point.kind].label}: </span>
      <span className={cn("min-w-0 flex-1 truncate", state === "dismissed" && "line-through")}>
        {point.title}
      </span>
      <span className="text-caption">{note}</span>
      {action}
    </article>
  );
};

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const SEVERITY: Readonly<Record<Severity, { readonly glyph: string; readonly className: string }>> =
  {
    blocking: {
      glyph: "■",
      className: "text-severity-blocker bg-review-changes-bg border-severity-blocker/25",
    },
    major: {
      glyph: "▲",
      className: "text-severity-major bg-severity-major-bg border-severity-major/25",
    },
    minor: {
      glyph: "●",
      className: "text-severity-minor bg-review-pending-bg border-severity-minor/25",
    },
  };

/** How much Claude thinks a finding matters, while it's Claude's. */
const SeverityChip = ({ severity }: { readonly severity: Severity }) => (
  <span data-slot="severity" className={cn(CHIP, SEVERITY[severity].className)}>
    <span aria-hidden="true">{SEVERITY[severity].glyph}</span>
    {severity}
  </span>
);

const MOTION = "animate-in duration-(--duration-slow) fade-in-0 slide-in-from-top-1";
const RING = "shadow-[inset_0_0_0_2px_var(--ring)]";
/** The card a finding and a risk share, in the code's column. */
const SHELL = "relative max-w-3xl rounded-lg border bg-thread-bg";
/** Going to a card keeps the lines it rests on, above it, in view. */
const SCROLL_UNDER_LINES =
  "scroll-mt-[calc(6rem+var(--lines-above)*var(--text-code--line-height))] -outline-offset-2";
/** A card folded to one line. */
const FOLDED = cn(SHELL, "px-3 py-1.5");

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const KIND_BAR: Readonly<Record<"finding" | "risk", string>> = {
  finding: "bg-review-changes",
  risk: "bg-risk-contract-solid",
};

/** The kind's bar inside a card's left edge. */
const KindBar = ({ kind }: { readonly kind: "finding" | "risk" }) => (
  <span
    aria-hidden="true"
    className={cn("absolute top-2 bottom-2 left-1.5 w-[3px] rounded-full", KIND_BAR[kind])}
  />
);

/**
 * A finding: what looks wrong, as a draft comment under the line it rests on, with its severity
 * and suggested change. Add to review saves it as the reviewer's draft on its lines; Edit opens
 * the comment box on it first; Dismiss folds it. Saying nothing means it's fine.
 */
export const FindingCard = memo(function FindingCard({
  point,
  state,
  saving,
  readOnly,
  current,
  onRaise,
  onState,
  inReview,
  removed,
  language,
  linesAbove = 0,
}: PointActions & {
  readonly point: Point;
  /** The lines of code above the card that it rests on, which going to it keeps in view. */
  readonly linesAbove?: number;
  /** A draft on its lines holds it now, so it folds to a line above the draft. */
  readonly inReview: boolean;
  /** The lines its suggestion replaces, as the diff shows them. */
  readonly removed: readonly string[] | null;
  readonly language: string | null;
}) {
  const id = useId();
  if (state === "dismissed") {
    return (
      <Folded
        point={point}
        state={state}
        current={current}
        note="Dismissed"
        className={FOLDED}
        action={
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => onState(point.id, "open")}
          >
            Undo
          </Button>
        }
      />
    );
  }
  if (state === "raised" && inReview) {
    return (
      <Folded
        point={point}
        state={state}
        current={current}
        note="In your review, below"
        className="max-w-3xl px-1"
        action={<span aria-hidden="true">✓</span>}
      />
    );
  }
  const disabled = readOnly || saving;
  return (
    <article
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind="finding"
      data-state={state}
      data-current={current || undefined}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      style={cssVars({ "--lines-above": linesAbove })}
      className={cn(
        SHELL,
        SCROLL_UNDER_LINES,
        "flex flex-col gap-2 py-2.5 pr-4 pl-5",
        current && RING,
      )}
    >
      <KindBar kind="finding" />
      <header className="flex flex-wrap items-center gap-2">
        <Kind kind="finding" />
        {point.severity !== null && <SeverityChip severity={point.severity} />}
        <span
          className={cn(CHIP, "border-review-pending/25 bg-review-pending-bg text-review-pending")}
        >
          Draft
        </span>
        {point.lines !== null && (
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            on{" "}
            <RefChip>{lineRef(point.lines.side, point.lines.startLine, point.lines.line)}</RefChip>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-caption text-muted-foreground">
          <EyeOffIcon aria-hidden="true" className="size-3.5" />
          Only you see this
        </span>
      </header>
      <h3 id={`${id}-title`} className="font-semibold">
        {point.title}
      </h3>
      {point.explanation !== "" && (
        <ThreadBody blocks={parseBody(point.explanation).blocks} suggestion={() => null} />
      )}
      {point.mismatch !== null && (
        <p className="text-caption text-muted-foreground">
          <span className="font-medium text-foreground">
            {MISMATCH_LABEL[point.mismatch.kind]}:
          </span>{" "}
          {point.mismatch.description}
        </p>
      )}
      {point.suggestion !== null && (
        <SuggestionDiff
          title="Suggested change"
          removed={removed}
          added={point.suggestion}
          language={language}
        />
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Dismiss: ${point.title}`}
          onClick={() => onState(point.id, "dismissed")}
        >
          <XIcon aria-hidden="true" />
          Dismiss
        </Button>
        {point.lines !== null && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Edit: ${point.title}`}
              onClick={() => onRaise(point, false)}
            >
              <PencilIcon aria-hidden="true" />
              Edit
            </Button>
            <Button
              size="sm"
              disabled={disabled}
              aria-label={`Add to review: ${point.title}`}
              onClick={() => onRaise(point, true)}
            >
              Add to review
            </Button>
          </>
        )}
      </div>
    </article>
  );
});

/**
 * A risk: code worth reading closely, as a note under the last of its lines, with what could
 * break outside the PR. Comment opens the comment box on it; Dismiss folds it.
 */
export const RiskNote = memo(function RiskNote({
  point,
  state,
  saving,
  readOnly,
  current,
  onRaise,
  onState,
  linesAbove = 0,
}: PointActions & {
  readonly point: Point;
  /** The lines of code above the note that it's about, which going to it keeps in view. */
  readonly linesAbove?: number;
}) {
  const id = useId();
  if (state === "dismissed") {
    return (
      <Folded
        point={point}
        state={state}
        current={current}
        note="Dismissed"
        className={FOLDED}
        action={
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => onState(point.id, "open")}
          >
            Undo
          </Button>
        }
      />
    );
  }
  const disabled = readOnly || saving;
  return (
    <article
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind="risk"
      data-state={state}
      data-current={current || undefined}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      style={cssVars({ "--lines-above": linesAbove })}
      className={cn(
        SHELL,
        SCROLL_UNDER_LINES,
        "flex flex-col gap-0.5 py-1.5 pr-2 pl-5",
        current && RING,
      )}
    >
      <KindBar kind="risk" />
      <header className="flex flex-wrap items-center gap-2">
        <Kind kind="risk" />
        {point.lines !== null && (
          <RefChip>{lineRef(point.lines.side, point.lines.startLine, point.lines.line)}</RefChip>
        )}
        {state === "raised" && (
          <span className="text-caption text-muted-foreground">
            <span aria-hidden="true">✓ </span>Commented
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || point.lines === null}
            aria-label={`Comment: ${point.title}`}
            onClick={() => onRaise(point, false)}
          >
            Comment
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            aria-label={`Dismiss: ${point.title}`}
            onClick={() => onState(point.id, "dismissed")}
          >
            Dismiss
          </Button>
        </span>
      </header>
      <h3 id={`${id}-title`} className="pb-0.5 font-normal">
        {point.title}
      </h3>
    </article>
  );
});

/**
 * A decision's chip at the end of the line that makes the choice: the question it answers, which
 * opens its footnote. It stops the click, which on the line would open the comment box.
 */
export const DecisionChip = ({
  point,
  state,
  open,
  current,
  onToggle,
}: {
  readonly point: Point;
  readonly state: PointState;
  readonly open: boolean;
  readonly current: boolean;
  readonly onToggle: (id: PointId) => void;
}) => {
  const Icon = POINT_ICON.decision;
  return (
    <button
      type="button"
      id={pointAnchor(point.id)}
      data-slot="decision-chip"
      // As tall as its line of code: WCAG 2.5.8's inline exception, as for the line number.
      data-inline-target
      data-state={state}
      data-current={current || undefined}
      aria-expanded={open}
      aria-label={`Decision: ${point.title}`}
      className={cn(
        "ml-3 inline-flex min-h-5 scroll-mt-24 items-center gap-1 rounded-full border bg-background px-2 align-middle font-sans text-caption text-muted-foreground hover:text-foreground",
        state === "dismissed" && "line-through",
        current && RING,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(point.id);
      }}
    >
      <Icon aria-hidden="true" className="size-3" />
      {point.title}
    </button>
  );
};

/** A decision's footnote under its line: the answer, muted, with a way to comment or hide it. */
export const DecisionNote = ({
  point,
  state,
  saving,
  readOnly,
  onRaise,
  onState,
}: Omit<PointActions, "current"> & { readonly point: Point }) => {
  const disabled = readOnly || saving;
  return (
    <article
      data-slot="decision-note"
      data-state={state}
      aria-label={point.title}
      className={cn(
        "flex max-w-3xl flex-wrap items-baseline gap-x-2 border-l pl-3 text-caption",
        MOTION,
      )}
    >
      <p className="min-w-0 flex-1 basis-80 text-muted-foreground">
        <span className="font-medium text-foreground">{point.title}.</span> {point.explanation}
      </p>
      <span className="flex items-center gap-1">
        {state === "dismissed" ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => onState(point.id, "open")}
          >
            Show again
          </Button>
        ) : (
          <>
            {state === "raised" && (
              <span className="text-muted-foreground">
                <span aria-hidden="true">✓ </span>Commented
              </span>
            )}
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled || point.lines === null}
              aria-label={`Comment: ${point.title}`}
              onClick={() => onRaise(point, false)}
            >
              Comment
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled}
              aria-label={`Hide: ${point.title}`}
              onClick={() => onState(point.id, "dismissed")}
            >
              Hide
            </Button>
          </>
        )}
      </span>
    </article>
  );
};

/** On another hunk a point rests on: one line back to it. */
export const PointMention = ({
  point,
  onGo,
}: {
  readonly point: Point;
  readonly onGo: (id: PointId) => void;
}) => {
  const Icon = POINT_ICON[point.kind];
  return (
    <p data-slot="point-mention" className="flex items-center gap-1.5 text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {POINT_STATUS[point.kind].label}:{" "}
      <button
        type="button"
        className="min-h-6 rounded-sm text-left whitespace-pre-line text-primary underline-offset-2 hover:underline"
        onClick={() => onGo(point.id)}
      >
        {point.title}
      </button>
    </p>
  );
};

/**
 * Where point cards unfold when they land: in height from nothing, under the lines they rest on
 * (globals.css). `fresh` cards take no room while the page finds which are in view; `at` is an
 * in-view card's place in the code's order, and only those unfold.
 */
export const PointFold = ({
  pointId,
  fresh,
  at,
  row = false,
  className,
  bodyClassName,
  children,
}: {
  /** The first point in the fold, which the page measures it by. */
  readonly pointId: PointId;
  readonly fresh: boolean;
  readonly at: number | undefined;
  /** A row of a part's lines, under the line it follows. */
  readonly row?: boolean;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly children: ReactNode;
}) => (
  <div
    role={row ? "row" : undefined}
    data-slot="point-fold"
    data-point-id={pointId}
    data-fresh={fresh || undefined}
    data-unfold={at === undefined ? undefined : true}
    style={at === undefined ? undefined : cssVars({ "--landing-i": at })}
    className={className}
  >
    <div role={row ? "cell" : undefined}>
      <div className={bodyClassName}>{children}</div>
    </div>
  </div>
);
