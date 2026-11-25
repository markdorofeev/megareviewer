import { CircleCheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  MODEL_STAGES,
  type ModelOptions,
  mapModelStages,
  type Point,
  PointId,
  type PointState,
  type ReviewThread,
  type ThreadId,
} from "../../../src/domain/review/index.ts";
import {
  fixtureModelOptions,
  lockedModelOptions,
  opencodeModelOptions,
} from "../../dev/fixtures/index.ts";
import { cn } from "../lib/utils.ts";
import { ClaudeElement, type ClaudeRun, type Narrowing } from "../pages/review/ClaudeElement.tsx";
import { barButtons } from "../pages/review/header-buttons.ts";
import { PointStepper } from "../pages/review/PointStepper.tsx";
import { type HairlineState, ReviewBar } from "../pages/review/ReviewBar.tsx";
import { ThreadStepper, threadChip } from "../pages/review/ThreadStepper.tsx";
import { type ThreadScope, threadScopeOf, threadSteps } from "../pages/review/thread-steps.ts";
import { Button } from "../ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import { DESIGN_RUN, POINTS, PULL_REQUEST, THREADS, useDemoChoice } from "./fixtures.ts";

/** The point card's points and a second finding, so the stepper has more than one to walk. */
const MORE_POINTS: readonly Point[] = [
  ...POINTS.slice(0, 1),
  {
    id: PointId.parse("f2"),
    kind: "finding",
    title: "Gives up after the fifth attempt without saying why",
    explanation: "",
    path: "src/http/retry.ts",
    lines: null,
    hunkIds: [],
    severity: "minor",
    suggestion: null,
    mismatch: null,
  },
  ...POINTS.slice(1),
];

/** The PR's threads in the page's order: two open, one resolved, across two files. */
const PR_THREADS: readonly ReviewThread[] = [
  { ...THREADS.open, id: "PRRT_open" },
  { ...THREADS.resolved, id: "PRRT_resolved", line: 24, originalLine: 24 },
  { ...THREADS.grouped, id: "PRRT_grouped", path: "src/http/client.ts", line: 8, originalLine: 8 },
];
const ALL_RESOLVED: readonly ReviewThread[] = PR_THREADS.map((one) => ({
  ...one,
  resolved: true,
}));

const RESOLVED_HERE: readonly ReviewThread[] = PR_THREADS.filter(
  (one) => one.id !== "PRRT_resolved",
).map((one) => (one.id === "PRRT_grouped" ? { ...one, resolved: true } : one));

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
  models = fixtureModelOptions,
  hairline = null,
  stuck = false,
  published = false,
  threads = [],
  startThread = null,
  resolvedHere = [],
  scope = null,
  pending = 0,
  isAuthor = false,
  stale = false,
}: {
  readonly label: string;
  readonly run?: ClaudeRun;
  readonly points?: readonly Point[];
  readonly start?: PointId | null;
  readonly narrowedAt?: Narrowing | null;
  readonly dismissed?: readonly string[];
  readonly running?: boolean;
  /** What the reviewer can choose: Claude Code signed in unless given. */
  readonly models?: ModelOptions;
  readonly hairline?: HairlineState | null;
  readonly stuck?: boolean;
  readonly published?: boolean;
  /** The PR's threads, in the page's order. */
  readonly threads?: readonly ReviewThread[];
  readonly startThread?: ThreadId | null;
  /** Threads resolved on the page, which stay steps. */
  readonly resolvedHere?: readonly ThreadId[];
  readonly scope?: ThreadScope | null;
  /** Line comments waiting for the review. */
  readonly pending?: number;
  readonly isAuthor?: boolean;
  /** The PR has new commits since the analysis. */
  readonly stale?: boolean;
}) => {
  const [current, setCurrent] = useState<PointId | null>(start);
  const [thread, setThread] = useState<ThreadId | null>(startThread);
  const choice = useDemoChoice(models);
  const [narrowed, setNarrowed] = useState<Narrowing | null>(narrowedAt);
  const here = new Set(resolvedHere);
  const threadScope = threadScopeOf(scope, threads, here);
  const walkingThreads = narrowed === "thread" || points.length === 0;
  const stateOf = (id: PointId): PointState => (dismissed.includes(id) ? "dismissed" : "open");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      {/* The page's root gives the bar its height. */}
      <div className="relative rounded-lg border px-3 [--review-bar-h:3.25rem]">
        <ReviewBar
          title={PULL_REQUEST.title}
          stuck={stuck}
          hairline={hairline}
          verdict={
            published ? { kind: "published", url: `${PULL_REQUEST.url}#pullrequestreview-1` } : null
          }
          claude={
            <ClaudeElement
              analysis={run}
              choice={choice}
              running={running}
              starting={false}
              error={null}
              points={points}
              threads={threadChip(threads, threadScope, here)}
              narrowed={narrowed}
              onNarrow={(kind) => {
                setNarrowed(kind);
                if (kind === "thread") {
                  const [first] = threadSteps(threads, threadScope, here);
                  if (thread === null && first !== undefined) setThread(first.id);
                  return;
                }
                if (kind !== null && current === null) setCurrent(points[0]?.id ?? null);
              }}
              onRun={() => {}}
              onRerun={() => {}}
              reanalyze={stale ? { starting: false, onReanalyze: () => {} } : null}
              filesChanged={7}
            >
              {!walkingThreads ? (
                <PointStepper
                  points={points}
                  current={current}
                  stateOf={stateOf}
                  onGo={setCurrent}
                  onOpenList={() => {}}
                />
              ) : (
                threads.length > 0 && (
                  <ThreadStepper
                    ordered={threads}
                    scope={threadScope}
                    resolvedHere={here}
                    current={thread}
                    onGo={setThread}
                    onOpenList={() => {}}
                  />
                )
              )}
            </ClaudeElement>
          }
          tools={null}
          publish={
            <Verdicts
              run={run}
              running={running}
              pending={pending}
              isAuthor={isAuthor}
              stale={stale}
            />
          }
        />
      </div>
    </div>
  );
};

/** Approve and Publish, filled as the page fills them. */
const Verdicts = ({
  run,
  running,
  pending,
  isAuthor,
  stale,
}: {
  readonly run: ClaudeRun;
  readonly running: boolean;
  readonly pending: number;
  readonly isAuthor: boolean;
  readonly stale: boolean;
}) => {
  const bar = barButtons({
    aiDone: MODEL_STAGES.every((stage) => run.stages[stage] === "done"),
    running,
    pending,
    isAuthor,
    stale,
    verdict: null,
  });
  return bar.order.map((which) =>
    which === "approve" ? (
      <Tooltip key="approve" disabled={bar.approve.disabledReason === null}>
        <TooltipTrigger
          render={
            <Button
              variant={bar.approve.filled ? "approve" : "outline"}
              disabled={bar.approve.disabledReason !== null}
              focusableWhenDisabled
            />
          }
        >
          <CircleCheckIcon
            aria-hidden="true"
            className={cn(!bar.approve.filled && "text-review-approved")}
          />
          Approve
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {bar.approve.disabledReason}
        </TooltipContent>
      </Tooltip>
    ) : (
      <Button key="publish" variant={bar.publish.filled ? "default" : "outline"}>
        Publish review…
        {bar.publish.count > 0 && (
          <span className="tabular rounded-full bg-primary-foreground px-1.5 text-caption text-primary">
            {bar.publish.count}
            <span className="sr-only"> to post</span>
          </span>
        )}
      </Button>
    ),
  );
};

/** The bar under the header in each state a reviewer sees it in, and the stepper's. */
export const ReviewBarStates = (): ReactNode => (
  <div className="flex flex-col gap-4">
    <BarDemo
      label="Before Claude runs: hover or focus the button for the model and who pays; the arrow opens the choice"
      run={DESIGN_RUN}
      points={[]}
    />
    <BarDemo
      label="No model can run: the button is disabled, and says why on hover or focus; the arrow still lists every option"
      run={DESIGN_RUN}
      points={[]}
      models={lockedModelOptions}
    />
    <BarDemo
      label="With opencode: each provider behind it is a group, and a long one shows the chosen and default models, with a field to filter for the rest"
      run={DESIGN_RUN}
      points={[]}
      models={opencodeModelOptions}
    />
    <BarDemo
      label="Claude couldn't finish: Try again, in outline beside Publish"
      run={{
        ...DESIGN_RUN,
        stages: { ...DESIGN_RUN.stages, intent: "failed" },
        modelError: {
          stage: "intent",
          code: "model-error",
          message: "Your Claude plan's usage limit is reached. It resets at 18:00.",
        },
      }}
      points={[]}
    />
    <BarDemo
      label="While Claude reads, the hairline on the bar's edge"
      run={DESIGN_RUN}
      points={[]}
      running
      hairline="running"
    />
    <BarDemo label="Before the first step: the count" />
    <BarDemo label="Mid-list" start={PointId.parse("f2")} />
    <BarDemo label="The findings' chip pressed" narrowedAt="finding" start={PointId.parse("f2")} />
    <BarDemo label="On a dismissed point" start={PointId.parse("f2")} dismissed={["f2"]} />
    <BarDemo label="One point" points={POINTS.slice(0, 1)} start={PointId.parse("f1")} />
    <BarDemo
      label="What's missing, and why"
      run={{
        ...RAN,
        stages: { ...RAN.stages, findings: "failed" },
        modelError: {
          stage: "findings",
          code: "model-error",
          message: "Your Claude plan's usage limit is reached. It resets at 18:00.",
        },
      }}
      points={POINTS.slice(0, 1)}
    />
    <BarDemo label="Nothing to raise" points={[]} />
    <BarDemo
      label="Threads before Claude runs: the stepper goes round the unresolved ones, in the page's order"
      run={DESIGN_RUN}
      points={[]}
      threads={PR_THREADS}
    />
    <BarDemo
      label="On a thread: who started it and their first line, which goes back to it"
      run={DESIGN_RUN}
      points={[]}
      threads={PR_THREADS}
      startThread="PRRT_grouped"
    />
    <BarDemo
      label="While Claude reads, the threads are still a step away"
      run={DESIGN_RUN}
      points={[]}
      running
      hairline="running"
      threads={PR_THREADS}
      startThread="PRRT_open"
    />
    <BarDemo
      label="Beside Claude's points: the threads' chip narrows the stepper to them"
      threads={PR_THREADS}
      narrowedAt="thread"
      startThread="PRRT_open"
    />
    <BarDemo
      label="A thread resolved here stays a step, so the position doesn't jump"
      run={DESIGN_RUN}
      points={[]}
      threads={RESOLVED_HERE}
      resolvedHere={["PRRT_grouped"]}
      startThread="PRRT_grouped"
    />
    <BarDemo
      label="Every thread resolved: the stepper goes round all of them"
      run={DESIGN_RUN}
      points={[]}
      threads={ALL_RESOLVED}
    />
    <BarDemo
      label="Comments pending: Publish is the filled button, with their count"
      start={PointId.parse("f1")}
      pending={2}
    />
    <BarDemo
      label="New commits since the analysis: Re-analyze, and Approve in outline"
      start={PointId.parse("f1")}
      stale
    />
    <BarDemo
      label="The reviewer's own PR: Approve is disabled, and says why"
      start={PointId.parse("f1")}
      isAuthor
    />
    <BarDemo label="Stuck to the top: the title first" stuck start={PointId.parse("f1")} />
    <BarDemo label="Published" published start={PointId.parse("f1")} />
  </div>
);
