import { useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import {
  EndChip,
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

/** The line of a path through a cell: from its first directory to its last, or to its requests. */
const Line = ({
  path,
  from,
  to,
}: {
  readonly path: FlowPath;
  readonly from: "edge" | "middle";
  readonly to: "edge" | "middle";
}) => (
  <span
    aria-hidden="true"
    data-slot="flow-lane-line"
    className={cn("absolute top-1/2 border-t border-input", !path.inPullRequest && "border-dashed")}
    style={{ left: from === "edge" ? 0 : "50%", right: to === "edge" ? 0 : "50%" }}
  />
);

/**
 * The pull request as lanes: a column per directory, callers before callees, and a row per flow
 * path, with a mark in each directory where the path runs changed files. The directories are the
 * headings, so the architecture is read once and the rows say what's particular to this change.
 */
export const FlowLanes = ({ flow, onOpenPart, onOpenFile, focusKey }: FlowViewProps) => {
  const box = useRef<HTMLElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  useFocusedStop(box, focusKey);
  const sends = flow.paths.some((path) => path.ends.length > 0);
  const chip = (stop: Stop) => (
    <StopChip
      key={stop.path}
      stop={stop}
      hot={hot === stop.path}
      onHot={setHot}
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
        Each column is a directory, callers first. Each row is a way the change is reached, with a
        mark where it runs changed files; a dashed row starts outside the pull request.
      </FlowLegend>
      {flow.paths.length === 0 ? (
        <NoPaths />
      ) : (
        <div data-slot="flow-lanes-scroll" className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-64 min-w-64 border-b bg-card px-3 py-2 text-caption font-medium text-muted-foreground"
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
                const marked = cells.flatMap((stops, at) => (stops.length > 0 ? [at] : []));
                const first = marked[0] ?? -1;
                const last = marked[marked.length - 1] ?? -1;
                const border = row > 0 && "border-t";
                return (
                  <tr key={path.key} data-slot="flow-lane">
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 z-10 w-64 max-w-64 min-w-64 bg-card px-3 py-2.5 text-left align-middle font-normal",
                        border,
                      )}
                    >
                      <PathLabel path={path} />
                    </th>
                    {cells.map((stops, at) => {
                      const layer = flow.layers[at]?.key ?? "";
                      const key = `${path.key}\u0000${layer}`;
                      const open = unfolded.has(key) || stops.length <= SHOWN;
                      const onLine = at >= first && at <= last && first !== -1;
                      const ends = path.ends.length > 0;
                      return (
                        <td key={layer} className={cn("relative px-2 py-2.5 align-middle", border)}>
                          {onLine && (first !== last || ends) && (
                            <Line
                              path={path}
                              from={at === first ? "middle" : "edge"}
                              to={at === last && !ends ? "middle" : "edge"}
                            />
                          )}
                          {at > last && ends && <Line path={path} from="edge" to="edge" />}
                          <div className="relative flex flex-col items-center gap-1">
                            {(open ? stops : stops.slice(0, SHOWN - 1)).map(chip)}
                            {stops.length > SHOWN && (
                              <button
                                type="button"
                                aria-expanded={open}
                                className="min-h-6 rounded-md bg-card px-1.5 text-caption text-muted-foreground underline decoration-input underline-offset-2 hover:text-foreground"
                                onClick={() =>
                                  setUnfolded((previous) => {
                                    const next = new Set(previous);
                                    if (!next.delete(key)) next.add(key);
                                    return next;
                                  })
                                }
                              >
                                {open ? "Show fewer" : `and ${stops.length - SHOWN + 1} more`}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    {sends && (
                      <td className={cn("relative px-2 py-2.5 align-middle", border)}>
                        {path.ends.length > 0 && <Line path={path} from="edge" to="middle" />}
                        <div className="relative flex flex-col items-center gap-1">
                          {path.ends.map((end) => (
                            <EndChip key={end.label} end={end} onOpen={onOpenPart} />
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
