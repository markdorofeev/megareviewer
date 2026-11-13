import { memo, useId } from "react";
import type { Point, PointId, PointState } from "../../../../src/domain/review/index.ts";
import { POINT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { StatusBadge } from "../../ui/status-badge.tsx";

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const BORDER: Readonly<Record<Point["kind"], string>> = {
  finding: "border-l-review-changes",
  risk: "border-l-risk-contract-solid",
  decision: "border-l-review-pending",
};

export const pointAnchor = (id: PointId): string => `point-${id}`;

/**
 * One of Claude's points on the code it rests on. Raise opens a comment on its lines, prefilled
 * with its text; Dismiss folds it to one line. Saying nothing means it's fine.
 */
export const PointCard = memo(function PointCard({
  point,
  state,
  saving,
  readOnly,
  current,
  onRaise,
  onState,
}: {
  readonly point: Point;
  readonly state: PointState;
  readonly saving: boolean;
  /** After publishing, and before the analysis is complete, a point can't be acted on. */
  readonly readOnly: boolean;
  /** The point the list or Next is on. */
  readonly current: boolean;
  readonly onRaise: (point: Point) => void;
  readonly onState: (id: PointId, state: PointState) => void;
}) {
  const id = useId();
  const kind = POINT_STATUS[point.kind];
  if (state === "dismissed") {
    return (
      <article
        id={pointAnchor(point.id)}
        data-slot="point"
        data-kind={point.kind}
        data-state="dismissed"
        aria-label={point.title}
        className="flex scroll-mt-24 flex-wrap items-center gap-2 rounded-lg border bg-thread-bg px-3 py-1.5 text-muted-foreground"
      >
        <span aria-hidden="true">{kind.glyph}</span>
        <span className="min-w-0 flex-1 truncate line-through">{point.title}</span>
        <span className="text-caption">Dismissed</span>
        <Button
          variant="ghost"
          size="xs"
          disabled={readOnly}
          onClick={() => onState(point.id, "open")}
        >
          Undo
        </Button>
      </article>
    );
  }
  return (
    <article
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind={point.kind}
      data-state={state}
      data-current={current || undefined}
      className={cn(
        // The card grows out from under the lines it rests on; instant with reduced motion.
        "flex scroll-mt-24 animate-in flex-col gap-2 rounded-lg border border-l-3 bg-thread-bg p-3 duration-(--duration-slow) fade-in-0 slide-in-from-top-1 -outline-offset-2",
        BORDER[point.kind],
        current && "shadow-[inset_0_0_0_2px_var(--ring)]",
      )}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={kind} />
        <h3 id={`${id}-title`} className="min-w-0 font-semibold whitespace-pre-line">
          {point.title}
        </h3>
        {state === "raised" && (
          <span className="ml-auto text-caption text-review-changes">
            <span aria-hidden="true">✓ </span>Raised
          </span>
        )}
      </div>
      {point.explanation !== "" && (
        <p className="text-body whitespace-pre-line text-muted-foreground">{point.explanation}</p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={readOnly || saving}
          aria-label={`Raise: ${point.title}`}
          onClick={() => onRaise(point)}
        >
          {state === "raised" ? "Comment again" : "Raise"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={readOnly || saving}
          aria-label={`Dismiss: ${point.title}`}
          onClick={() => onState(point.id, "dismissed")}
        >
          Dismiss
        </Button>
      </div>
    </article>
  );
});

/** On another hunk a point rests on: one line back to its card. */
export const PointMention = ({
  point,
  onGo,
}: {
  readonly point: Point;
  readonly onGo: (id: PointId) => void;
}) => (
  <p data-slot="point-mention" className="text-muted-foreground">
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
