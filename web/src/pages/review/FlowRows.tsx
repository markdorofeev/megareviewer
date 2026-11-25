import { ChevronRightIcon } from "lucide-react";
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

/**
 * The pull request as a list: a row per flow path, the changed files it runs in the order it
 * reaches them, then the requests it sends.
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
        Each row is a way the change is reached, and the changed files it runs, in call order.
      </FlowLegend>
      {flow.paths.length === 0 ? (
        <NoPaths />
      ) : (
        <ol className="divide-y rounded-lg border bg-card">
          {flow.paths.map((path) => (
            <li
              key={path.key}
              data-slot="flow-row"
              className="grid items-center gap-x-4 gap-y-2 px-3 py-2.5 md:grid-cols-[16rem_minmax(0,1fr)]"
            >
              <PathLabel path={path} />
              <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5">
                {path.stops.map((stop, at) => (
                  <li key={stop.path} className="flex min-w-0 items-center gap-1">
                    {at > 0 && (
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    )}
                    <StopChip
                      stop={stop}
                      hot={hot === stop.path}
                      onHot={setHot}
                      onOpen={onOpenPart}
                    />
                  </li>
                ))}
                {path.ends.map((end) => (
                  <li key={end.label} className="flex min-w-0 items-center gap-1">
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                    <EndChip end={end} onOpen={onOpenPart} />
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
