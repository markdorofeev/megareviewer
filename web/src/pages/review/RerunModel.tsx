import { useState } from "react";
import type { AnalysisView, RemovedModelRun } from "../../../../contracts/index.ts";
import type { AnalysisId, ModelOption } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage, useApi } from "../../api/index.ts";
import { DANGER } from "../../review/shell/banners.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog } from "./Dialog.tsx";

/**
 * Re-run, after asking: takes the run off the analysis, as Remove AI review does, and runs the
 * chosen model again on it. The page starts afresh from the analysis running, so it follows the new
 * run and lands it. A run that can't start once the old one is gone says why, and closing shows the
 * analysis without a run, where Request AI review can try again.
 */
export const RerunModel = ({
  analysisId,
  view,
  family,
  chosen,
  tour,
  onClose,
  onRestart,
}: {
  readonly analysisId: AnalysisId;
  readonly view: AnalysisView;
  /** Who made the run's points: "Claude". */
  readonly family: string;
  /** The model the new run uses. */
  readonly chosen: ModelOption;
  /** The Tour switch is on: the new run writes the tour too. */
  readonly tour: boolean;
  readonly onClose: () => void;
  /** The page starts afresh from this view. */
  readonly onRestart: (view: AnalysisView) => void;
}) => {
  const { client } = useApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{
    readonly error: ApiError;
    readonly removed: boolean;
  } | null>(null);
  const [removed, setRemoved] = useState<RemovedModelRun | null>(null);

  const rerun = async () => {
    setPending(true);
    setError(null);
    let without = removed;
    if (without === null) {
      const gone = await client.removeModelRun(analysisId);
      if (!gone.ok) {
        setPending(false);
        return setError({ error: gone.error, removed: false });
      }
      without = gone.value;
      setRemoved(without);
    }
    const started = await client.runModel(analysisId, {
      optionId: chosen.id,
      ...(tour ? { tour: true } : {}),
    });
    if (!started.ok) {
      setPending(false);
      return setError({ error: started.error, removed: true });
    }
    const running = await client.getAnalysis(analysisId);
    onRestart(running.ok ? running.value : { ...view, ...without });
  };

  const close = () => {
    if (removed !== null) onRestart({ ...view, ...removed });
    else onClose();
  };

  return (
    <Dialog title="Re-run AI review" onClose={close}>
      <p className="text-ui">
        {family}'s intent, findings, risks and decisions go, with what you did with them, and{" "}
        {chosen.modelName} through {chosen.via} reads the PR again. Your comments stay.
      </p>
      {error !== null && (
        <p className={DANGER} role="alert">
          {error.removed
            ? "The old run is gone, but the new one couldn't start."
            : "Couldn't remove the old run."}{" "}
          {errorMessage(error.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" data-autofocus onClick={close}>
          {removed === null ? "Cancel" : "Close"}
        </Button>
        <Button variant="ai" disabled={pending} onClick={() => void rerun()}>
          {pending ? "Starting…" : error?.removed ? "Try again" : "Re-run"}
        </Button>
      </div>
    </Dialog>
  );
};
