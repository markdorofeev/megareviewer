import { type ReactNode, useEffect, useMemo, useState } from "react";
import { mapModelStages, type Point, PointId } from "../../../src/domain/review/index.ts";
import { fixtureModelOptions } from "../../dev/fixtures/index.ts";
import { ClaudeElement } from "../pages/review/ClaudeElement.tsx";
import { DecisionChip, FindingCard, PointFold, RiskNote } from "../pages/review/PointCard.tsx";
import { PointStepper } from "../pages/review/PointStepper.tsx";
import { tokenMs, useLanding } from "../pages/review/useLanding.ts";
import { FileTree, HunkCard, type LinePlace, PINNED, type PointLine } from "../review/index.ts";
import { Button } from "../ui/button.tsx";
import { DESIGN_RUN, POINTS, RETRY_FILE, TREE_FILES, useDemoChoice } from "./fixtures.ts";

/** The point card's points again, under ids of their own: the cards' anchors are ids on the page. */
const LANDED: readonly Point[] = POINTS.map((point) => ({
  ...point,
  id: PointId.parse(point.kind === "risk" ? `${point.id}-2` : `${point.id.slice(0, 1)}101`),
}));

const RANK: Readonly<Record<Point["kind"], number>> = { finding: 0, risk: 1, decision: 2 };

/**
 * Claude's run on made-up data, played as the review page plays it: Play starts a run, which
 * reads for one loop of the hairline and lands. Under reduced motion it changes at once.
 */
export const LandingDemo = () => {
  const [run, setRun] = useState<"running" | "after">("after");
  const choice = useDemoChoice(fixtureModelOptions);
  const points = run === "after" ? LANDED : [];
  const ids = useMemo(() => points.map((point) => point.id), [points]);
  const landing = useLanding(run === "running", ids);
  useEffect(() => {
    if (run !== "running") return;
    const timer = setTimeout(() => setRun("after"), tokenMs("--hairline-loop"));
    return () => clearTimeout(timer);
  }, [run]);

  const [hunk] = RETRY_FILE.hunks;
  const pointLines = new Map<string, PointLine>();
  for (const point of points) {
    // A decision is a footnote, and marks no line.
    if (point.lines === null || point.kind === "decision") continue;
    const { side, startLine, line: last } = point.lines;
    const at = landing.inView.get(point.id);
    for (let line = startLine; line <= last; line += 1) {
      const held = pointLines.get(`${side}:${line}`);
      if (held !== undefined && RANK[point.kind] >= RANK[held.kind]) continue;
      pointLines.set(`${side}:${line}`, {
        kind: point.kind,
        ...(at === undefined
          ? {}
          : { landing: { at, line: line - startLine, lines: last - startLine + 1 } }),
      });
    }
  }
  const actions = {
    state: "open",
    saving: false,
    readOnly: false,
    current: false,
    onRaise: () => {},
    onState: () => {},
  } as const;
  const card = (point: Point) =>
    point.kind === "risk" ? (
      <RiskNote key={point.id} point={point} {...actions} />
    ) : (
      <FindingCard
        key={point.id}
        point={point}
        {...actions}
        inReview={false}
        removed={null}
        language="typescript"
      />
    );
  const on = (place: LinePlace, kind: Point["kind"]) =>
    points.filter(
      (point) =>
        point.kind === kind &&
        point.lines !== null &&
        point.lines.side === place.side &&
        point.lines.line === place.line,
    );
  const fold = (together: readonly Point[], row: boolean, children: ReactNode) => {
    const [first] = together;
    return first === undefined ? null : (
      <PointFold
        pointId={first.id}
        fresh={together.some((point) => landing.fresh(point.id))}
        at={landing.inView.get(first.id)}
        row={row}
        {...(row
          ? {
              className: PINNED,
              bodyClassName: "flex max-w-3xl flex-col gap-2 py-2 pr-3 pl-29 font-sans",
            }
          : { bodyClassName: "flex flex-col gap-2 border-b bg-surface-subtle p-3" })}
      >
        {children}
      </PointFold>
    );
  };
  const pointsAt = (place: LinePlace) => {
    const here = [...on(place, "finding"), ...on(place, "risk")];
    return fold(here, true, here.map(card));
  };
  const pointsAtEnd = (place: LinePlace) =>
    on(place, "decision").map((point) => (
      <DecisionChip
        key={point.id}
        point={point}
        state="open"
        open={false}
        current={false}
        onToggle={() => {}}
      />
    ));
  const flagged = new Set(
    points.flatMap((point) =>
      point.kind === "finding" && point.lines !== null
        ? [`${point.lines.side}:${point.lines.line}`]
        : [],
    ),
  );
  const unlined = points.filter((point) => point.lines === null);
  const tree = run === "after" ? TREE_FILES : TREE_FILES.map(({ points: _, ...file }) => file);
  const ran = { ...DESIGN_RUN, stages: mapModelStages(DESIGN_RUN.stages, () => "done" as const) };

  return (
    <div data-landing={landing.phase} className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={run === "running" || landing.phase !== "done"}
        onClick={() => setRun("running")}
      >
        Play
      </Button>
      <header className="relative flex flex-wrap items-center gap-2 border-b pb-3 text-body">
        {(landing.running || landing.phase === "landing") && (
          <span
            data-slot="model-hairline"
            data-state={landing.running ? "running" : "finishing"}
            aria-hidden="true"
          >
            <span />
          </span>
        )}
        <span>Retry requests that fail on the network.</span>
        <ClaudeElement
          analysis={run === "running" ? DESIGN_RUN : ran}
          choice={choice}
          running={landing.running}
          startedAt={null}
          starting={false}
          error={null}
          points={points}
          narrowed={null}
          onNarrow={() => {}}
          onRun={() => setRun("running")}
        >
          <PointStepper
            points={points}
            current={null}
            stateOf={() => "open"}
            kind={null}
            onGo={() => {}}
            onOpenList={() => {}}
          />
        </ClaudeElement>
      </header>
      <div className="grid items-start gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <FileTree files={tree} activePath={RETRY_FILE.path} onSelect={() => {}} />
        {hunk !== undefined && (
          <HunkCard
            hunk={hunk}
            file={RETRY_FILE}
            risk={null}
            afterHeader={fold(unlined, false, unlined.map(card))}
            pointLines={pointLines}
            pointsAt={pointsAt}
            pointsAtEnd={pointsAtEnd}
            flagged={flagged}
          />
        )}
      </div>
    </div>
  );
};
