import { ArrowRightIcon, PencilIcon, PlusIcon } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import { cn } from "../../lib/utils.ts";
import type { AlsoChanged, FlowPath, FlowPaths, PathEnd, Stop, StopStatus } from "./flow-paths.ts";

// What the overview's three preview layouts share: a stop's chip, a path's label, the legend, and
// the changed files that are on no path.

/** A stop by its status, from the tokens: a new file as the tree colors one, a changed one as a box. */
export const STOP_STYLE: Readonly<Record<StopStatus | "outside", string>> = {
  new: "border-diff-add-fg bg-diff-add-bg text-diff-add-fg",
  changed: "border-risk-logic-solid bg-risk-logic-bg text-risk-logic",
  outside: "border-dashed border-input bg-surface-subtle text-muted-foreground",
};

export interface FlowViewProps {
  readonly flow: FlowPaths;
  /** Opens a part's code in the map; `path` is the file to come back to. */
  readonly onOpenPart: (partId: PartId, path: string | null) => void;
  readonly onOpenFile: (path: string) => void;
  /** A file to focus, at its first stop. A counter tells requests apart. */
  readonly focusKey: { readonly key: string; readonly n: number } | null;
}

/** Focuses the first stop of the file the page asks for, once per request. */
export const useFocusedStop = (
  box: RefObject<HTMLElement | null>,
  focusKey: FlowViewProps["focusKey"],
): void => {
  const focused = useRef(-1);
  useEffect(() => {
    if (focusKey === null || focused.current === focusKey.n) return;
    const stop = box.current?.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(focusKey.key)}"]`,
    );
    if (stop === null || stop === undefined) return;
    focused.current = focusKey.n;
    stop.focus();
    stop.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusKey, box]);
};

export const StatusGlyph = ({ status }: { readonly status: StopStatus }) =>
  status === "new" ? (
    <PlusIcon aria-hidden="true" className="size-3 shrink-0" />
  ) : (
    <PencilIcon aria-hidden="true" className="size-3 shrink-0" />
  );

const listed = (items: readonly string[]): string =>
  items.length <= 3
    ? items.join(", ")
    : `${items.slice(0, 3).join(", ")} and ${items.length - 3} more`;

/** What a screen reader hears for a stop, and its tooltip. */
export const stopName = (stop: Stop): string =>
  [
    stop.label,
    stop.status === "new" ? "new file" : "changed",
    stop.names.length > 0 ? listed(stop.names) : null,
    stop.shared > 1 ? `on ${stop.shared} paths` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

/** A changed file on a path: its status as a glyph and a color, its name, and how many paths run it. */
export const StopChip = ({
  stop,
  hot,
  onHot,
  onOpen,
  className,
}: {
  readonly stop: Stop;
  /** Another chip of the same file has the pointer or the focus. */
  readonly hot: boolean;
  readonly onHot: (path: string | null) => void;
  readonly onOpen: FlowViewProps["onOpenPart"];
  readonly className?: string;
}) => {
  const [first] = stop.partIds;
  return (
    <button
      type="button"
      data-slot="flow-stop"
      data-path={stop.path}
      data-status={stop.status}
      data-hot={hot || undefined}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-1.5 font-mono text-code-compact",
        STOP_STYLE[stop.status],
        hot && "shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--primary)]",
        className,
      )}
      aria-label={stopName(stop)}
      title={`${stop.path}${stop.names.length > 0 ? `: ${stop.names.join(", ")}` : ""}`}
      onClick={() => first !== undefined && onOpen(first, stop.path)}
      onFocus={() => onHot(stop.path)}
      onBlur={() => onHot(null)}
      onMouseEnter={() => onHot(stop.path)}
      onMouseLeave={() => onHot(null)}
    >
      <StatusGlyph status={stop.status} />
      <span className="truncate">{stop.label}</span>
      {stop.shared > 1 && <span className="shrink-0 text-kbd">×{stop.shared}</span>}
    </button>
  );
};

/** A request the path sends to one of the pull request's routes. */
export const EndChip = ({
  end,
  onOpen,
}: {
  readonly end: PathEnd;
  readonly onOpen: FlowViewProps["onOpenPart"];
}) => (
  <button
    type="button"
    data-slot="flow-end"
    className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-dashed border-input bg-surface-subtle px-1.5 font-mono text-code-compact text-foreground"
    aria-label={`Sends ${end.label} to a route in this pull request`}
    title="A request to a route this pull request adds"
    onClick={() => onOpen(end.partId, null)}
  >
    <ArrowRightIcon aria-hidden="true" className="size-3 shrink-0" />
    <span className="truncate">{end.label}</span>
  </button>
);

/** Where a path is reached, each of its labels on a line, and whether that's in the pull request. */
export const PathLabel = ({ path }: { readonly path: FlowPath }) => (
  <div data-slot="flow-path-label" className="flex min-w-0 flex-col gap-0.5">
    {path.labels.slice(0, 3).map((label, at) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: two flows can share a title, and the list never reorders.
        key={at}
        className="truncate font-mono text-code-compact font-semibold"
        title={path.outside[at] ?? label}
      >
        {label}
      </span>
    ))}
    {path.labels.length > 3 && (
      <span className="text-caption text-muted-foreground" title={path.labels.slice(3).join("\n")}>
        and {path.labels.length - 3} more
      </span>
    )}
    <span className="text-caption text-muted-foreground">
      {path.inPullRequest ? "In this PR" : "Not in this PR"}
    </span>
  </div>
);

export const FlowLegend = ({ children }: { readonly children: string }) => (
  <p
    data-slot="flow-legend"
    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground"
  >
    <span>{children}</span>
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5",
        STOP_STYLE.changed,
      )}
    >
      <StatusGlyph status="changed" />
      changed
    </span>
    <span
      className={cn("inline-flex h-5 items-center gap-1 rounded-md border px-1.5", STOP_STYLE.new)}
    >
      <StatusGlyph status="new" />
      new file
    </span>
    <span>×3: three ways run it.</span>
  </p>
);

const ALSO: readonly { readonly key: keyof AlsoChanged; readonly label: string }[] = [
  { key: "tests", label: "Tests" },
  { key: "docs", label: "Docs" },
  { key: "generated", label: "Generated" },
  { key: "mechanical", label: "Mechanical" },
  { key: "other", label: "Other files" },
];

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The changed code no path runs, then the changed files that aren't code to follow, by kind. */
export const OffThePaths = ({
  flow,
  hot,
  onHot,
  onOpenPart,
  onOpenFile,
}: Pick<FlowViewProps, "flow" | "onOpenPart" | "onOpenFile"> & {
  readonly hot: string | null;
  readonly onHot: (path: string | null) => void;
}) => (
  <>
    {flow.unreached.length > 0 && (
      <section aria-label="Changed code on no path" className="flex flex-col gap-2">
        <h3 className="text-caption font-medium text-muted-foreground">On no path</h3>
        <div className="flex flex-wrap gap-1.5">
          {flow.unreached.map((stop) => (
            <StopChip
              key={stop.path}
              stop={stop}
              hot={hot === stop.path}
              onHot={onHot}
              onOpen={onOpenPart}
            />
          ))}
        </div>
      </section>
    )}
    {ALSO.some(({ key }) => flow.also[key].length > 0) && (
      <section aria-label="Also changed" className="flex flex-col gap-2">
        <h3 className="text-caption font-medium text-muted-foreground">Also changed</h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {ALSO.filter(({ key }) => flow.also[key].length > 0).map(({ key, label }) => (
            <div key={key} className="col-span-2 grid grid-cols-subgrid items-baseline">
              <dt className="text-caption text-muted-foreground">
                {label} · {flow.also[key].length}
              </dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                {flow.also[key].map((path) => (
                  <button
                    key={path}
                    type="button"
                    data-slot="flow-also-file"
                    className="min-h-6 font-mono text-code-compact text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                    title={path}
                    onClick={() => onOpenFile(path)}
                  >
                    {basename(path)}
                  </button>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    )}
  </>
);

export const NoPaths = () => (
  <p className="text-muted-foreground">
    No flow was found in this pull request: nothing it changes calls anything else it changes.
  </p>
);
