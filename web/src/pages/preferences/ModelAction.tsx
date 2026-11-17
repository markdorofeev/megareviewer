import { InfoIcon, LoaderCircleIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import type { ModelOptionId } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { SPIN } from "../picker/PullRequestList.tsx";
import type { ModelChoice } from "../review/model-choice.ts";

/** What a run came to: what to say of it, or why it failed. */
export type ModelActionResult =
  | { readonly ok: true; readonly said: string }
  | { readonly ok: false; readonly message: string };

type Phase =
  | { readonly is: "idle" }
  | { readonly is: "running"; readonly since: number }
  | { readonly is: "done"; readonly said: string }
  | { readonly is: "failed"; readonly message: string };

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

/**
 * A button that makes one model call on the option chosen for Request AI review, and what came of
 * it beside it. Its tooltip says which model and who pays, as that button's does. It can't run
 * twice at once; when it can't run at all it stays focusable and says why.
 */
export const ModelAction = ({
  label,
  running,
  icon,
  variant = "outline",
  choice,
  what = "Runs",
  blocked = null,
  idle = null,
  run,
  now = Date.now,
}: {
  readonly label: string;
  /** What it says while it runs: "Reading your reviews…". */
  readonly running: string;
  readonly icon: ReactNode;
  readonly variant?: "default" | "outline";
  /** The reviewer's choice of model, the same as the review page's. */
  readonly choice: ModelChoice;
  /** How the tooltip starts, before the model's name. */
  readonly what?: string;
  /** Why there's nothing to run it on, whatever the model. */
  readonly blocked?: string | null;
  /** Beside the button before it has run. */
  readonly idle?: ReactNode;
  readonly run: (optionId: ModelOptionId | undefined) => Promise<ModelActionResult>;
  readonly now?: () => number;
}) => {
  const id = useId();
  const [phase, setPhase] = useState<Phase>({ is: "idle" });
  const elapsed = useElapsed(phase.is === "running" ? phase.since : null, now);
  const { chosen, locked } = choice;
  const busy = phase.is === "running";
  const cannot = blocked ?? locked;
  const note =
    cannot ?? (chosen === null ? null : `${what} ${chosen.modelName} through ${chosen.via}`);

  const start = async () => {
    setPhase({ is: "running", since: now() });
    const result = await run(chosen?.id);
    setPhase(result.ok ? { is: "done", said: result.said } : { is: "failed", ...result });
  };

  return (
    <div data-slot="model-action" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Tooltip disabled={note === null}>
        <TooltipTrigger
          render={
            <Button
              variant={variant}
              size="sm"
              disabled={busy || cannot !== null || chosen === null}
              focusableWhenDisabled
              aria-busy={busy}
              aria-describedby={note === null ? undefined : `${id}-note`}
              onClick={() => void start()}
            />
          }
        >
          {busy ? (
            <LoaderCircleIcon aria-hidden="true" className={SPIN} />
          ) : locked !== null && blocked === null ? (
            <LockIcon aria-hidden="true" />
          ) : (
            icon
          )}
          {label}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {cannot !== null && <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />}
          {note}
        </TooltipContent>
      </Tooltip>
      {/* The tooltip is for the eye; a screen reader reads the same words as the description. */}
      {note !== null && (
        <span id={`${id}-note`} hidden>
          {note}
        </span>
      )}
      <span
        role={phase.is === "failed" ? "alert" : "status"}
        className={cn(
          "flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-2 text-caption",
          phase.is === "failed" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {phase.is === "running" ? (
          <>
            {running} <span className="tabular">{clock(elapsed)}</span>
          </>
        ) : phase.is === "done" ? (
          phase.said
        ) : phase.is === "failed" ? (
          <>
            <span>
              <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
              {phase.message}
            </span>
            <Button
              variant="link"
              className="h-6 min-w-6 px-1 text-caption"
              onClick={() => void start()}
            >
              Try again
            </Button>
          </>
        ) : (
          idle
        )}
      </span>
    </div>
  );
};
