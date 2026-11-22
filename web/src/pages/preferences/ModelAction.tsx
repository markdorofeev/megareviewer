import { InfoIcon, LoaderCircleIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import type { ModelOptionId } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { SPIN } from "../picker/PullRequestList.tsx";
import { ModelMenu } from "../review/ModelMenu.tsx";
import type { ModelChoice } from "../review/model-choice.ts";

/** What a run came to: what to say of it, or why it failed. */
export type ModelActionResult =
  | { readonly ok: true; readonly said: string }
  | { readonly ok: false; readonly message: string };

/** Where a run is. The page keeps it, so it outlives the panel the button was pressed on. */
export type RunPhase =
  | { readonly is: "idle" }
  | { readonly is: "running"; readonly since: number }
  | { readonly is: "done"; readonly said: string }
  | { readonly is: "failed"; readonly message: string };

export const IDLE: RunPhase = { is: "idle" };

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Seconds since `since`, ticking while it runs. */
const useElapsed = (since: number | null, now: () => number): number => {
  const [at, setAt] = useState(now);
  useEffect(() => {
    if (since === null) return;
    setAt(now());
    const timer = setInterval(() => setAt(now()), 1000);
    return () => clearInterval(timer);
  }, [since, now]);
  return since === null ? 0 : Math.max(0, Math.round((at - since) / 1000));
};

export interface ModelActionProps {
  readonly label: string;
  /** What it says while it runs: "Reading your reviews…". */
  readonly running: string;
  readonly icon: ReactNode;
  /** The reviewer's choice of model, the same as the review page's. */
  readonly choice: ModelChoice;
  /** How the tooltip starts, before the model's name: what it reads, then "runs". */
  readonly what?: string;
  readonly run: (optionId: ModelOptionId | undefined) => Promise<ModelActionResult>;
  readonly now?: () => number;
  readonly phase: RunPhase;
  readonly onPhase: (phase: RunPhase) => void;
}

const start = async ({ choice, run, now = Date.now, onPhase }: ModelActionProps) => {
  onPhase({ is: "running", since: now() });
  const result = await run(choice.chosen?.id);
  onPhase(result.ok ? { is: "done", said: result.said } : { is: "failed", ...result });
};

/** What the button's tooltip and description say: why no model can run, or what runs it. */
const noteOf = ({ choice, what = "Runs" }: ModelActionProps): string | null =>
  choice.locked ??
  (choice.chosen === null
    ? null
    : `${what} ${choice.chosen.modelName} through ${choice.chosen.via}`);

/**
 * A button that makes one model call on the option chosen for Request AI review, with the same
 * arrow beside it to change that choice. Its tooltip says what it reads, which model and who
 * pays, as that button's does. It can't run twice at once; when no model can run it stays
 * focusable and says why. What came of it is `ModelActionStatus`, which the panel places apart.
 */
export const ModelActionButton = (props: ModelActionProps) => {
  const id = useId();
  const { label, icon, choice, phase } = props;
  const busy = phase.is === "running";
  const note = noteOf(props);
  return (
    <span data-slot="model-action" className="flex shrink-0 items-center">
      <Tooltip disabled={note === null}>
        <TooltipTrigger
          render={
            <Button
              variant="ai-quiet"
              disabled={busy || choice.locked !== null || choice.chosen === null}
              focusableWhenDisabled
              aria-busy={busy}
              aria-describedby={note === null ? undefined : `${id}-note`}
              onClick={() => void start(props)}
              className="rounded-r-none"
            />
          }
        >
          {busy ? (
            <LoaderCircleIcon aria-hidden="true" className={SPIN} />
          ) : choice.locked !== null ? (
            <LockIcon aria-hidden="true" />
          ) : (
            icon
          )}
          {label}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {choice.locked !== null && <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />}
          {note}
        </TooltipContent>
      </Tooltip>
      <ModelMenu
        choice={choice}
        disabled={busy || choice.options.length === 0}
        variant="ai-quiet"
        size="default"
      />
      {/* The tooltip is for the eye; a screen reader reads the same words as the description. */}
      {note !== null && (
        <span id={`${id}-note`} hidden>
          {note}
        </span>
      )}
    </span>
  );
};

/** What a run is doing or came to, with Try again after a failure; nothing before a run. */
export const ModelActionStatus = (props: ModelActionProps & { readonly className?: string }) => {
  const { running, now = Date.now, phase, className } = props;
  const elapsed = useElapsed(phase.is === "running" ? phase.since : null, now);
  if (phase.is === "idle") return null;
  return (
    <p
      role={phase.is === "failed" ? "alert" : "status"}
      data-slot="model-action-status"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 text-caption",
        phase.is === "failed" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {phase.is === "running" ? (
        <>
          {running} <span className="tabular">{clock(elapsed)}</span>
        </>
      ) : phase.is === "done" ? (
        phase.said
      ) : (
        <>
          <span>
            <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
            {phase.message}
          </span>
          <Button
            variant="link"
            className="h-6 min-w-6 px-1 text-caption"
            onClick={() => void start(props)}
          >
            Try again
          </Button>
        </>
      )}
    </p>
  );
};

/** The button and its status together, with a run of its own, for the design system's examples. */
export const ModelAction = ({
  initial = IDLE,
  ...props
}: Omit<ModelActionProps, "phase" | "onPhase"> & { readonly initial?: RunPhase }) => {
  const [phase, setPhase] = useState(initial);
  const all = { ...props, phase, onPhase: setPhase };
  return (
    <div className="flex flex-col items-start gap-1.5">
      <ModelActionButton {...all} />
      <ModelActionStatus {...all} />
    </div>
  );
};
