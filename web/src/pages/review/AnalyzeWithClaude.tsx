import { SparklesIcon } from "lucide-react";
import { type Analysis, modelRunnable } from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";

/**
 * Asks Claude for intent, decisions and the tour's titles on this analysis, which they're added
 * to. Shown while the model can run: before it has, or after it failed, with why. While it runs,
 * the progress strip and the intent line say so instead.
 */
export const AnalyzeWithClaude = ({
  analysis,
  via,
  starting,
  error,
  onRun,
}: {
  readonly analysis: Analysis;
  /** What runs the passes and who pays, from the status; null when it isn't known yet. */
  readonly via: string | null;
  readonly starting: boolean;
  /** Why the last request to start it was refused. */
  readonly error: string | null;
  readonly onRun: () => void;
}) => {
  if (!modelRunnable(analysis)) return null;
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
