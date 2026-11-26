import { type FocusEvent, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import {
  EndChip,
  type FlowFolds,
  FlowLegend,
  type FlowViewProps,
  NoPaths,
  OffThePaths,
  PathLabel,
  StopChip,
  useFocusedStop,
} from "./flow-parts.tsx";
import type { FlowPath, Stop } from "./flow-paths.ts";

/** A cell shows this many stops before folding the rest behind a button. */
const SHOWN = 3;

// Focus alone leaves a stop that's partly under the first column where it is. Not on a click,
// where scrolling would move the stop from under the pointer.
const showFocused = ({ target }: FocusEvent<HTMLElement>) => {
  if (target.matches(":focus-visible"))
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
};

/**
 * The pull request as lanes: a column per directory, callers before callees, and a row per flow
 * path, with a mark in each directory where the path runs changed files. The directories are the
 * headings, so the architecture is read once and the rows say what's particular to this change. No
 * line joins the cells, since it would join every file in one to every file in the next: the stop
 * with the pointer or the focus marks the ones on its path that call it or that it calls.
 */
export const FlowLanes = ({
  flow,
  onOpenPart,
  onOpenFile,
  focusKey,
  opened,
  onToggle,
}: FlowViewProps & FlowFolds) => {
  const box = useRef<HTMLElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [hotPath, setHotPath] = useState<string | null>(null);
  useFocusedStop(box, focusKey);
  const sends = flow.paths.some((path) => path.ends.length > 0);
  const chip = (path: FlowPath, stop: Stop) => (
    <StopChip
      key={stop.path}
      stop={stop}
      hot={hot === stop.path}
      linked={
        hotPath === path.key &&
        path.calls.some(
          ({ from, to }) =>
            (from === hot && to === stop.path) || (to === hot && from === stop.path),
        )
      }
      onHot={(one) => {
        setHot(one);
        setHotPath(one === null ? null : path.key);
      }}
      onOpen={onOpenPart}
    />
  );
  return (
    <section
      ref={box}
      data-slot="flow-lanes"
      aria-label="Flow paths of the pull request, by directory"
      className="flex min-w-0 flex-col gap-3"
    >
      <FlowLegend>
        Each column is a directory, callers first. Each row is a way the change is reached, with the
        changed files it runs. Hover or focus a file to mark what calls it and what it calls.
      </FlowLegend>
      {flow.paths.length === 0 ? (
        <NoPaths />
      ) : (
        // The first column stays while the lanes scroll, except where it would cover most of them.
        <div
          data-slot="flow-lanes-scroll"
          className="overflow-x-auto rounded-lg border bg-card sm:scroll-pl-64"
        >
          <table
            className="w-full border-separate border-spacing-0 text-left"
            onFocus={showFocused}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sm:sticky sm:left-0 sm:z-10 w-64 min-w-64 border-b bg-card px-3 py-2 text-caption font-medium text-muted-foreground"
                >
                  Reached from
                </th>
                {flow.layers.map((layer) => (
                  <th
                    key={layer.key}
                    scope="col"
                    title={`${layer.key}/`}
                    className="min-w-36 border-b px-2 py-2 text-center font-mono text-code-compact font-medium text-muted-foreground"
                  >
                    {layer.label}/
                  </th>
                ))}
                {sends && (
                  <th
                    scope="col"
                    className="min-w-36 border-b px-2 py-2 text-center text-caption font-medium text-muted-foreground"
                  >
                    Sends
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {flow.paths.map((path, row) => {
                const cells = flow.layers.map((layer) =>
                  path.stops.filter((stop) => stop.layer === layer.key),
                );
                const border = row > 0 && "border-t";
                return (
                  <tr key={path.key} data-slot="flow-lane">
                    <th
                      scope="row"
                      className={cn(
                        "sm:sticky sm:left-0 sm:z-10 w-64 max-w-64 min-w-64 bg-card px-3 py-2.5 text-left align-middle font-normal",
                        border,
                      )}
                    >
                      <PathLabel path={path} />
                    </th>
                    {cells.map((stops, at) => {
                      const layer = flow.layers[at]?.key ?? "";
                      const key = `${path.key}\u0000${layer}`;
                      const open = opened.has(key) || stops.length <= SHOWN;
                      const folded = open ? [] : stops.slice(SHOWN - 1);
                      const more = open ? "Show fewer" : `and ${folded.length} more`;
                      return (
                        <td key={layer} className={cn("px-2 py-2.5 align-middle", border)}>
                          <div className="flex flex-col items-center gap-1">
                            {(open ? stops : stops.slice(0, SHOWN - 1)).map((stop) =>
                              chip(path, stop),
                            )}
                            {stops.length > SHOWN && (
                              <button
                                type="button"
                                data-holds={folded.map((stop) => stop.path).join("\n")}
                                aria-expanded={open}
                                aria-label={`${more} in ${flow.layers[at]?.label ?? layer}/`}
                                className="min-h-6 rounded-md bg-card px-1.5 text-caption text-muted-foreground underline decoration-input underline-offset-2 hover:text-foreground"
                                onClick={() => onToggle(key)}
                              >
                                {more}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    {sends && (
                      <td className={cn("px-2 py-2.5 align-middle", border)}>
                        <div className="flex flex-col items-center gap-1">
                          {path.ends.map((end) => (
                            <EndChip
                              key={`${end.from} ${end.label}`}
                              end={end}
                              onOpen={onOpenPart}
                            />
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <OffThePaths
        flow={flow}
        hot={hot}
        onHot={setHot}
        onOpenPart={onOpenPart}
        onOpenFile={onOpenFile}
      />
    </section>
  );
};
