import { useRef } from "react";
import type { Point, PointId, PointState } from "../../../../src/domain/review/index.ts";
import { FINDING_STATUS, POINT_TONE, pointTone } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Dialog } from "./Dialog.tsx";
import { SeverityChip, TypeChip } from "./PointCard.tsx";

/**
 * The points Claude raised, findings by severity first, each with its type and severity. A row per
 * point goes to its card.
 */
export const PointList = ({
  points,
  stateOf,
  onGo,
  onClose,
  family = "Claude",
}: {
  readonly points: readonly Point[];
  readonly stateOf: (id: PointId) => PointState;
  readonly onGo: (id: PointId) => void;
  readonly onClose: () => void;
  /** Who made the points: "Claude". */
  readonly family?: string;
}) => {
  const went = useRef(false);
  return (
    <Dialog
      title={`${points.length} ${points.length === 1 ? "point" : "points"} from ${family}`}
      onClose={onClose}
      // A row moves the focus to what it goes to; closing mustn't take it back to the stepper.
      returnFocus={() => !went.current}
      className="sm:max-w-2xl"
    >
      {/* The dialog is a grid: without min-w-0 the list grows to its longest title. */}
      <ul className="flex min-w-0 flex-col gap-1" aria-label="Points">
        {points.map((point) => {
          const { label, icon: Icon } = FINDING_STATUS;
          const state = stateOf(point.id);
          return (
            <li key={point.id}>
              <button
                type="button"
                data-slot="point-row"
                className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                onClick={() => {
                  went.current = true;
                  onGo(point.id);
                }}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("size-3.5 shrink-0", POINT_TONE[pointTone(point)].text)}
                />
                <span className="sr-only">{label}: </span>
                <span
                  className={cn("min-w-0 flex-1 truncate", state === "dismissed" && "line-through")}
                >
                  {point.title}
                </span>
                {point.type !== null && <TypeChip type={point.type} />}
                {point.severity !== null && <SeverityChip severity={point.severity} />}
                {state !== "open" && (
                  <span className="text-caption text-muted-foreground">
                    {state === "raised" ? "Raised" : "Dismissed"}
                  </span>
                )}
                {point.path !== null && (
                  <span className="truncate font-mono text-code-compact text-muted-foreground">
                    {point.path}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
};
