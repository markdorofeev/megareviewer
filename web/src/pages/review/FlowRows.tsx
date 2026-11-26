import { ChevronRightIcon, CornerDownRightIcon } from "lucide-react";
import { useRef, useState } from "react";
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

interface BranchProps {
  readonly path: FlowPath;
  readonly stop: Stop;
  readonly hot: string | null;
  readonly onHot: (path: string | null) => void;
  readonly onOpen: FlowViewProps["onOpenPart"];
}

/**
 * A stop and the ones drawn under it. A stop that calls one other goes on along the line, with a
 * chevron for the call; one that calls several has them under it.
 */
const Branch = ({ path, stop, hot, onHot, onOpen }: BranchProps) => {
  const line = [stop];
  const next = (one: Stop | undefined) => path.stops.filter((other) => other.from === one?.path);
  const sends = (one: Stop | undefined) => path.ends.filter((end) => end.from === one?.path);
  for (let called = next(stop); called.length === 1 && sends(line.at(-1)).length === 0; ) {
    line.push(...called);
    called = next(line.at(-1));
  }
  const last = line.at(-1);
  const called = next(last);
  const ends = sends(last);
  return (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {line.map((one, at) => (
          <span key={one.path} className="flex min-w-0 items-center gap-1">
            {at > 0 && (
              <ChevronRightIcon
                aria-hidden="true"
                data-slot="flow-call"
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
            <StopChip stop={one} hot={hot === one.path} onHot={onHot} onOpen={onOpen} />
          </span>
        ))}
      </span>
      {called.length + ends.length > 0 && (
        <div className="mt-1.5 flex min-w-0 items-start gap-1.5 pl-2">
          <CornerDownRightIcon
            aria-hidden="true"
            className="mt-1.5 size-3 shrink-0 text-muted-foreground"
          />
          <ol data-slot="flow-calls" className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-1.5">
            {called
              .filter((one) => next(one).length + sends(one).length === 0)
              .map((one) => (
                <li key={one.path} className="flex min-w-0">
                  <StopChip stop={one} hot={hot === one.path} onHot={onHot} onOpen={onOpen} />
                </li>
              ))}
            {ends.map((end) => (
              <li key={end.label} className="flex min-w-0">
                <EndChip end={end} onOpen={onOpen} />
              </li>
            ))}
            {called
              .filter((one) => next(one).length + sends(one).length > 0)
              .map((one) => (
                <li key={one.path} className="min-w-0 basis-full">
                  <Branch path={path} stop={one} hot={hot} onHot={onHot} onOpen={onOpen} />
                </li>
              ))}
          </ol>
        </div>
      )}
    </>
  );
};

/**
 * The pull request as a list: a row per flow path, the changed files it runs as a tree from where it
 * starts, each under a file that calls it, with the requests they send.
 */
export const FlowRows = ({ flow, onOpenPart, onOpenFile, focusKey }: FlowViewProps) => {
  const box = useRef<HTMLElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  useFocusedStop(box, focusKey);
  return (
    <section
      ref={box}
      data-slot="flow-rows"
      aria-label="Flow paths of the pull request"
      className="flex min-w-0 flex-col gap-3"
    >
      <FlowLegend>
        Each row is a way the change is reached, and the changed files it runs, each after or under
        a file that calls it.
      </FlowLegend>
      {flow.paths.length === 0 ? (
        <NoPaths />
      ) : (
        <ol className="divide-y rounded-lg border bg-card">
          {flow.paths.map((path) => (
            <li
              key={path.key}
              data-slot="flow-row"
              className="grid items-start gap-x-4 gap-y-2 px-3 py-2.5 md:grid-cols-[16rem_minmax(0,1fr)]"
            >
              <PathLabel path={path} />
              <ol className="flex min-w-0 flex-col gap-1.5">
                {path.stops
                  .filter((stop) => stop.from === null)
                  .map((stop) => (
                    <li key={stop.path} className="min-w-0">
                      <Branch
                        path={path}
                        stop={stop}
                        hot={hot}
                        onHot={setHot}
                        onOpen={onOpenPart}
                      />
                    </li>
                  ))}
              </ol>
            </li>
          ))}
        </ol>
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
