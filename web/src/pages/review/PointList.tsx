import type { Point, PointId, PointState } from "../../../../src/domain/review/index.ts";
import { POINT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Dialog } from "./Dialog.tsx";

/** Every point Claude raised, in its order: a row per point that goes to its card. */
export const PointList = ({
  points,
  stateOf,
  onGo,
  onClose,
}: {
  readonly points: readonly Point[];
  readonly stateOf: (id: PointId) => PointState;
  readonly onGo: (id: PointId) => void;
  readonly onClose: () => void;
}) => (
  <Dialog title={`${points.length} points from Claude`} onClose={onClose} className="sm:max-w-2xl">
    <ul className="flex flex-col gap-1" aria-label="Points">
      {points.map((point) => {
        const { glyph, label } = POINT_STATUS[point.kind];
        const state = stateOf(point.id);
        return (
          <li key={point.id}>
            <button
              type="button"
              data-slot="point-row"
              data-kind={point.kind}
              className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
              onClick={() => onGo(point.id)}
            >
              <span aria-hidden="true">{glyph}</span>
              <span className="sr-only">{label}: </span>
              <span
                className={cn("min-w-0 flex-1 truncate", state === "dismissed" && "line-through")}
              >
                {point.title}
              </span>
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
