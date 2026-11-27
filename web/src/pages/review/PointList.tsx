import {
  FindingType,
  type Point,
  type PointId,
  type PointState,
} from "../../../../src/domain/review/index.ts";
import { FINDING_STATUS, FINDING_TYPE_STATUS, POINT_TONE, pointTone } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { PopoverHeader, PopoverTitle } from "../../ui/popover.tsx";
import { SeverityChip, TypeChip } from "./PointCard.tsx";
import { Segmented } from "./Segmented.tsx";

const ALL = "all";

/**
 * Claude's findings, by severity first, each with its type and severity, in the popover the
 * pager's position opens. A row per finding goes to its card. When more than one type has
 * findings, a filter narrows the rows and what the pager walks to one type.
 */
export const PointList = ({
  points,
  type,
  onType,
  current,
  stateOf,
  onGo,
  family = "Claude",
}: {
  readonly points: readonly Point[];
  readonly type: FindingType | null;
  readonly onType: (type: FindingType | null) => void;
  /** The finding the pager is on. */
  readonly current: PointId | null;
  readonly stateOf: (id: PointId) => PointState;
  readonly onGo: (id: PointId) => void;
  /** Who made the findings: "Claude". */
  readonly family?: string;
}) => {
  const types = FindingType.options.flatMap((one) => {
    const count = points.filter((point) => point.type === one).length;
    return count === 0 ? [] : [{ type: one, count }];
  });
  const rows = type === null ? points : points.filter((point) => point.type === type);
  return (
    <>
      <PopoverHeader>
        <PopoverTitle>
          {points.length} {points.length === 1 ? "finding" : "findings"} from {family}
        </PopoverTitle>
      </PopoverHeader>
      {types.length > 1 && (
        <Segmented
          legend="Show and step through"
          options={[
            { value: ALL, label: `All ${points.length}` },
            ...types.map(({ type: one, count }) => ({
              value: one,
              label: `${FINDING_TYPE_STATUS[one].glyph} ${FINDING_TYPE_STATUS[one].label} ${count}`,
            })),
          ]}
          value={type ?? ALL}
          onChange={(value) => onType(value === ALL ? null : value)}
        />
      )}
      <ul className="flex min-w-0 flex-col gap-1" aria-label="Findings">
        {rows.map((point) => {
          const { label, icon: Icon } = FINDING_STATUS;
          const state = stateOf(point.id);
          const here = point.id === current;
          return (
            <li key={point.id}>
              <button
                type="button"
                data-slot="point-row"
                aria-current={here ? "true" : undefined}
                className={cn(
                  "flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent",
                  here && "bg-muted font-medium",
                )}
                onClick={() => onGo(point.id)}
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
                  <span className="max-w-40 truncate font-mono text-code-compact text-muted-foreground">
                    {point.path}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
};
