import type { Hunk } from "../../../../src/domain/diff/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";

const span = (start: number, count: number) =>
  count <= 1 ? `line ${start}` : `lines ${start} to ${start + count - 1}`;

/** Where a hunk is, as a screen reader says it: its new lines, or the old ones it deletes. */
export const hunkPlace = (hunk: Pick<Hunk, "oldStart" | "oldLines" | "newStart" | "newLines">) =>
  hunk.newLines > 0
    ? span(hunk.newStart, hunk.newLines)
    : `deleted ${span(hunk.oldStart, hunk.oldLines)}`;

const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);

export interface HunkHeaderProps {
  readonly hunk: Pick<Hunk, "oldStart" | "oldLines" | "newStart" | "newLines" | "sectionHeading">;
  /** Position among the file's hunks, from 1. */
  readonly position: number;
  readonly count: number;
}

/** The `@@` ranges and the enclosing symbol git found, above a hunk's lines. */
export const HunkHeader = ({ hunk, position, count }: HunkHeaderProps) => (
  <div
    role="row"
    className="flex h-7 items-center bg-diff-hunk-bg font-mono text-code text-diff-hunk-fg"
  >
    <span role="gridcell" className="truncate px-3">
      <span className="sr-only">{`Hunk ${position} of ${count}, ${hunkPlace(hunk)}. `}</span>
      <span aria-hidden="true">
        @@ -{range(hunk.oldStart, hunk.oldLines)} +{range(hunk.newStart, hunk.newLines)} @@
      </span>
      {hunk.sectionHeading !== null && <span className="ml-2">{hunk.sectionHeading}</span>}
    </span>
  </div>
);

export type ExpandDirection = "up" | "down" | "all";

/** Lines a step of "expand up" or "expand down" opens. */
export const EXPAND_STEP = 20;

export interface CollapsedHunkProps {
  /** Unchanged lines hidden here. */
  readonly hidden: number;
  /** Opens hidden lines; without it the gap only says how many there are. */
  readonly onExpand?: (direction: ExpandDirection) => void;
  /** The lines are being fetched. */
  readonly expanding?: boolean;
}

/** Unchanged lines between hunks, folded, with buttons to open them when they can be fetched. */
export const CollapsedHunk = ({ hidden, onExpand, expanding = false }: CollapsedHunkProps) => {
  const label = `${hidden} ${hidden === 1 ? "line" : "lines"} unchanged`;
  return (
    <div
      role="row"
      className="flex h-8 items-center gap-1 bg-surface-subtle px-2 text-ui text-muted-foreground"
    >
      <span role="gridcell" className="flex items-center gap-1">
        <span aria-hidden="true" className="w-5 text-center">
          ↕
        </span>
        {expanding ? (
          <span role="status" className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
            />
            Opening {label}
          </span>
        ) : (
          <span>{label}</span>
        )}
      </span>
      {onExpand !== undefined && !expanding && (
        <span role="gridcell" className={cn("ml-auto flex gap-1")}>
          {hidden > EXPAND_STEP && (
            <>
              <Button variant="ghost" size="xs" onClick={() => onExpand("up")}>
                ↑ {EXPAND_STEP} up
              </Button>
              <Button variant="ghost" size="xs" onClick={() => onExpand("down")}>
                ↓ {EXPAND_STEP} down
              </Button>
            </>
          )}
          <Button variant="ghost" size="xs" onClick={() => onExpand("all")}>
            Show all
          </Button>
        </span>
      )}
    </div>
  );
};
