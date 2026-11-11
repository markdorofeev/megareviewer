import type { ShortcutId } from "../../lib/keymap.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { KeyHint } from "./key-hint.tsx";

export interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
  /** The shortcut that does the same, shown beside the label. */
  readonly shortcut?: ShortcutId;
}

const TONES = {
  muted: "bg-muted text-muted-foreground",
  done: "bg-review-approved-bg text-review-approved",
  info: "bg-diff-hunk-bg text-diff-hunk-fg",
} as const;

export interface EmptyStateProps {
  /** A glyph in a tinted circle; decorative, the title says it. */
  readonly glyph: string;
  readonly title: string;
  /** One line: what to do next. */
  readonly body: string;
  readonly actions?: readonly EmptyStateAction[];
  readonly tone?: keyof typeof TONES;
  /** In a panel, smaller and left-aligned; else centered for a whole page. */
  readonly inline?: boolean;
}

/** Nothing to show, and what to do next: no changes, nothing matches a filter, all reviewed. */
export const EmptyState = ({
  glyph,
  title,
  body,
  actions = [],
  tone = "muted",
  inline = false,
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col gap-2",
      inline ? "items-start p-3" : "mx-auto max-w-sm items-center px-6 py-12 text-center",
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-full font-semibold",
        inline ? "size-7 text-ui" : "size-10 text-heading",
        TONES[tone],
      )}
    >
      {glyph}
    </span>
    <p className={cn("font-semibold", inline ? "text-ui" : "text-heading")}>{title}</p>
    <p className="text-muted-foreground">{body}</p>
    {actions.length > 0 && (
      <div className="mt-1 flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <Button
            key={action.label}
            variant={index === 0 ? "outline" : "ghost"}
            size="sm"
            onClick={action.onClick}
          >
            {action.label}
            {action.shortcut !== undefined && <KeyHint id={action.shortcut} />}
          </Button>
        ))}
      </div>
    )}
  </div>
);

/** A file's diff loading: its header bar, then line bars at the default row height. */
export const DiffSkeleton = ({ lines = 7 }: { readonly lines?: number }) => (
  <div
    role="status"
    aria-label="Loading the diff"
    className="overflow-hidden rounded-lg border bg-card"
  >
    <div className="flex h-10 items-center gap-3 border-b px-3">
      <Skeleton className="h-3 w-3" />
      <Skeleton className="h-3 w-56" />
      <Skeleton className="ml-auto h-3 w-12" />
    </div>
    <div className="flex flex-col py-1">
      {Array.from({ length: lines }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder bars, a fixed list.
        <div key={index} className="flex h-5 items-center gap-3 px-3">
          <Skeleton className="h-2.5 w-8" />
          {/* Widths vary so it reads as code, not as a table. */}
          <Skeleton className="h-2.5" style={{ width: `${30 + ((index * 37) % 55)}%` }} />
        </div>
      ))}
    </div>
  </div>
);

/** The file tree loading: a filter field and rows of names. */
export const TreeSkeleton = ({ rows = 8 }: { readonly rows?: number }) => (
  <div role="status" aria-label="Loading the files" className="flex flex-col gap-2 px-1">
    <Skeleton className="h-7 w-full" />
    {Array.from({ length: rows }, (_, index) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows, a fixed list.
        key={index}
        className="flex h-6 items-center gap-2"
        style={{ paddingLeft: `${(index % 3) * 12}px` }}
      >
        <Skeleton className="h-2.5 flex-1" />
        <Skeleton className="h-2.5 w-10" />
      </div>
    ))}
  </div>
);
