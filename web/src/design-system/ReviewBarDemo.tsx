import { type ReactNode, useState } from "react";
import {
  mapModelStages,
  type Point,
  PointId,
  type PointKind,
  type PointState,
} from "../../../src/domain/review/index.ts";
import { ClaudeElement, type ClaudeRun } from "../pages/review/ClaudeElement.tsx";
import { PointStepper } from "../pages/review/PointStepper.tsx";
import { type HairlineState, ReviewBar } from "../pages/review/ReviewBar.tsx";
import { narrowTo } from "../pages/review/stepper.ts";
import { Button } from "../ui/button.tsx";
import { DESIGN_RUN, POINTS, PULL_REQUEST } from "./fixtures.ts";

/** The point card's points and a second finding, so a chip has more than one to walk. */
const MORE_POINTS: readonly Point[] = [
  ...POINTS,
  {
    id: PointId.parse("f2"),
    kind: "finding",
    title: "Gives up after the fifth attempt without saying why",
    explanation: "",
    path: "src/http/retry.ts",
    lines: null,
    hunkIds: [],
  },
];

const RAN: ClaudeRun = {
  ...DESIGN_RUN,
  stages: mapModelStages(DESIGN_RUN.stages, () => "done" as const),
};

/**
 * The review bar on made-up data, with a stepper that steps: Previous, Next and the chips work,
 * and the position and title follow.
 */
const BarDemo = ({
  label,
  run = RAN,
  points = MORE_POINTS,
  start = null,
  narrowedAt = null,
  dismissed = [],
  running = false,
  hairline = null,
  stuck = false,
  published = false,
}: {
  readonly label: string;
  readonly run?: ClaudeRun;
  readonly points?: readonly Point[];
  readonly start?: PointId | null;
  readonly narrowedAt?: PointKind | null;
  readonly dismissed?: readonly string[];
  readonly running?: boolean;
  readonly hairline?: HairlineState | null;
  readonly stuck?: boolean;
  readonly published?: boolean;
}) => {
  const [current, setCurrent] = useState<PointId | null>(start);
  const [narrowed, setNarrowed] = useState<PointKind | null>(narrowedAt);
  const stateOf = (id: PointId): PointState => (dismissed.includes(id) ? "dismissed" : "open");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      {/* The page's root gives the bar its height. */}
      <div className="relative rounded-lg border px-3 [--review-bar-h:2.75rem]">
        <ReviewBar
          title={PULL_REQUEST.title}
          stuck={stuck}
          hairline={hairline}
          publication={
            published
              ? {
                  url: `${PULL_REQUEST.url}#pullrequestreview-1`,
                  publishedAt: "2026-10-21T10:00:00Z",
                  postedCommentIds: {},
                }
              : null
          }
          claude={
            <ClaudeElement
              analysis={run}
              via="Claude Code, on your Pro plan"
              running={running}
              startedAt={running ? Date.now() - 42_000 : null}
              starting={false}
              error={null}
              points={points}
              narrowed={narrowed}
              onNarrow={(kind) => {
                setNarrowed(kind);
                const to = narrowTo(points, kind, current);
                if (to !== null) setCurrent(to);
              }}
              onRun={() => {}}
            >
              <PointStepper
                points={points}
                current={current}
                stateOf={stateOf}
                kind={narrowed}
                onGo={setCurrent}
                onOpenList={() => {}}
              />
            </ClaudeElement>
          }
          tools={null}
          publish={
            <Button size="sm" className="shrink-0">
              Publish review…
              <span className="tabular rounded-full bg-primary-foreground px-1.5 text-caption text-primary">
                2<span className="sr-only"> to post</span>
              </span>
            </Button>
          }
        />
      </div>
    </div>
  );
};

/** The bar under the header in each state a reviewer sees it in, and the stepper's. */
export const ReviewBarStates = (): ReactNode => (
  <div className="flex flex-col gap-4">
    <BarDemo label="Before Claude runs" run={DESIGN_RUN} points={[]} />
    <BarDemo
      label="While Claude reads, the hairline on the bar's edge"
      run={DESIGN_RUN}
      points={[]}
      running
      hairline="running"
    />
    <BarDemo label="Before the first step: the count" />
    <BarDemo label="Mid-list" start={PointId.parse("r:h_0123456789abcdef")} />
    <BarDemo
      label="Narrowed to findings by their chip"
      narrowedAt="finding"
      start={PointId.parse("f2")}
    />
    <BarDemo label="On a dismissed point" start={PointId.parse("d1")} dismissed={["d1"]} />
    <BarDemo label="One point" points={POINTS.slice(0, 1)} start={PointId.parse("f1")} />
    <BarDemo
      label="What's missing, and why"
      run={{
        ...RAN,
        stages: { ...RAN.stages, risk: "failed", decisions: "skipped" },
        modelError: {
          stage: "risk",
          code: "model-error",
          message: "Your Claude plan's usage limit is reached. It resets at 18:00.",
        },
      }}
      points={POINTS.slice(0, 1)}
    />
    <BarDemo label="Nothing to raise" points={[]} />
    <BarDemo label="Stuck to the top: the title first" stuck start={PointId.parse("f1")} />
    <BarDemo label="Published" published start={PointId.parse("f1")} />
  </div>
);
