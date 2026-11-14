import type { Point, PointId, PointKind, PointState } from "../../../../src/domain/review/index.ts";
import { POINT_ICON, POINT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Dialog } from "./Dialog.tsx";

const KIND_WORDS: Readonly<Record<PointKind, [string, string]>> = {
  finding: ["finding", "findings"],
  risk: ["risk", "risks"],
  decision: ["decision", "decisions"],
};

/**
 * The points Claude raised, in its order: every one, or those of the kind a chip narrowed the
 * stepper to. A row per point goes to its card.
 */
export const PointList = ({
  points,
  kind,
  stateOf,
  onGo,
  onClose,
  family = "Claude",
}: {
  readonly points: readonly Point[];
  /** The kind a chip narrowed the stepper to, or null for every point. */
  readonly kind: PointKind | null;
  readonly stateOf: (id: PointId) => PointState;
  readonly onGo: (id: PointId) => void;
  readonly onClose: () => void;
  /** Who made the points: "Claude". */
  readonly family?: string;
}) => {
  const shown = kind === null ? points : points.filter((point) => point.kind === kind);
  const [one, many] = kind === null ? ["point", "points"] : KIND_WORDS[kind];
  return (
    <Dialog
      title={`${shown.length} ${shown.length === 1 ? one : many} from ${family}`}
      onClose={onClose}
      className="sm:max-w-2xl"
    >
      {/* The dialog is a grid: without min-w-0 the list grows to its longest title. */}
      <ul className="flex min-w-0 flex-col gap-1" aria-label="Points">
        {shown.map((point) => {
          const { label } = POINT_STATUS[point.kind];
          const Icon = POINT_ICON[point.kind];
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
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
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
};
