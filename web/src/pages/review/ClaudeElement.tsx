import { SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Analysis,
  modelRunnable,
  type Point,
  type PointKind,
} from "../../../../src/domain/review/index.ts";

/** What Claude's element reads of an analysis: how far its run got, and how it ended. */
export type ClaudeRun = Pick<Analysis, "status" | "stages" | "modelError">;

import { POINT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { KeyHint } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";

/** How long a count takes to roll up from zero, and how often it steps. */
const ROLL_MS = 400;
const ROLL_STEP_MS = 40;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up from zero when `to` first arrives; an instant change with reduced motion. */
const useCountUp = (to: number): number => {
  const [shown, setShown] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    if (to === from.current) return;
    from.current = to;
    if (reducedMotion()) return setShown(to);
    setShown(0);
    const steps = Math.max(1, Math.round(ROLL_MS / ROLL_STEP_MS));
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setShown(step >= steps ? to : Math.round((to * step) / steps));
      if (step >= steps) clearInterval(timer);
    }, ROLL_STEP_MS);
    return () => clearInterval(timer);
  }, [to]);
  return shown;
};

/** Seconds since `since`, ticking while it runs. */
const useElapsed = (since: number | null): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
};

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const KIND_WORDS: Readonly<Record<PointKind, [string, string]>> = {
  finding: ["finding", "findings"],
  risk: ["risk", "risks"],
  decision: ["decision", "decisions"],
};

const Chip = ({ kind, count }: { readonly kind: PointKind; readonly count: number }) => {
  const shown = useCountUp(count);
  const [one, many] = KIND_WORDS[kind];
  return (
    <span
      data-slot="point-chip"
      data-kind={kind}
      className={cn(
        "flex min-h-6 items-center gap-1.5 rounded-full border px-2 text-caption font-medium",
        POINT_STATUS[kind].className,
      )}
    >
      <span aria-hidden="true">{POINT_STATUS[kind].glyph}</span>
      <span className="tabular">{shown}</span> {count === 1 ? one : many}
    </span>
  );
};

/** The passes whose results aren't in, and why, when a run ended early. */
const missingNote = (analysis: ClaudeRun): string | null => {
  const missing = (["findings", "risk", "decisions"] as const).filter(
    (stage) => analysis.stages[stage] !== "done",
  );
  if (missing.length === 0 || analysis.modelError === null) return null;
  return `${missing.join(", ")} missing: ${analysis.modelError.message}`;
};

/**
 * Where the button was: Claude's run and what it found. Before it runs, the button; while it
 * does, a line of words and the time since; once it's done, a chip per kind of point with its
 * count, the whole list, and Next through them.
 */
export const ClaudeElement = ({
  analysis,
  via,
  running,
  startedAt,
  starting,
  error,
  points,
  onRun,
  onOpenList,
  onNext,
}: {
  readonly analysis: ClaudeRun;
  /** What runs the passes and who pays, from the status; null when it isn't known yet. */
  readonly via: string | null;
  readonly running: boolean;
  /** When this page saw the run start, for the time since. */
  readonly startedAt: number | null;
  readonly starting: boolean;
  /** Why the last request to start it was refused. */
  readonly error: string | null;
  readonly points: readonly Point[];
  readonly onRun: () => void;
  readonly onOpenList: () => void;
  readonly onNext: () => void;
}) => {
  const elapsed = useElapsed(running ? startedAt : null);
  if (running) {
    return (
      <span
        data-slot="claude-running"
        role="status"
        className="flex items-center gap-2 text-muted-foreground"
      >
        <SparklesIcon aria-hidden="true" className="size-3.5" />
        Claude is reading this PR
        <span className="tabular text-caption">{clock(elapsed)}</span>
      </span>
    );
  }

  const counts = (["finding", "risk", "decision"] as const).map(
    (kind) => [kind, points.filter((point) => point.kind === kind).length] as const,
  );
  const note = missingNote(analysis);
  if (points.length > 0) {
    return (
      <span data-slot="claude-receipt" className="flex flex-wrap items-center gap-1.5">
        {counts.map(([kind, count]) => count > 0 && <Chip key={kind} kind={kind} count={count} />)}
        <Button variant="ghost" size="xs" onClick={onOpenList}>
          All {points.length}
        </Button>
        <Button variant="ghost" size="xs" onClick={onNext}>
          Next
          <KeyHint id="nextPoint" />
        </Button>
        {(error ?? note) !== null && (
          <span role="alert" className="text-caption text-destructive">
            {error ?? note}
          </span>
        )}
        {modelRunnable(analysis) && (
          <Button variant="ghost" size="xs" disabled={starting} onClick={onRun}>
            {starting ? "Starting…" : "Try again"}
          </Button>
        )}
      </span>
    );
  }

  if (!modelRunnable(analysis)) {
    // Claude ran and found nothing to raise.
    return analysis.stages.findings === "done" ? (
      <span data-slot="claude-receipt" className="text-muted-foreground">
        <span aria-hidden="true">✓ </span>Claude found nothing to raise
      </span>
    ) : null;
  }
  const failed = analysis.modelError;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="xs"
        disabled={starting}
        title={via === null ? undefined : `Runs on ${via}`}
        onClick={onRun}
      >
        <SparklesIcon aria-hidden="true" />
        {starting ? "Starting…" : failed === null ? "Analyze with Claude" : "Try again"}
      </Button>
      {(error ?? failed) !== null && (
        <span role="alert" className="text-caption text-destructive">
          {error ?? `Claude couldn't finish: ${failed?.message}`}
        </span>
      )}
    </span>
  );
};
