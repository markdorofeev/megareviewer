import { useState } from "react";
import {
  type ModelCall,
  type ModelPass,
  type ModelRunOption,
  modelFamily,
} from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog } from "./Dialog.tsx";
import { formatDuration, runName } from "./UsageFooter.tsx";

const PASS_NAMES: Readonly<Record<ModelPass, string>> = {
  intent: "Intent",
  findings: "Findings",
  risk: "Risk",
  decisions: "Decisions",
  tour: "Tour",
};

/** "+1:05" from the run's first call, so parallel passes and waits read at a glance. */
export const formatOffset = (ms: number): string => {
  const seconds = Math.round(ms / 1_000);
  return `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const outcomeLabel = (call: ModelCall): string => {
  if (call.outcome === "ok") return "✓ Answered";
  if (call.outcome === "failed") return `✕ Failed: ${call.error?.kind ?? "unknown"}`;
  const count = call.problems.length;
  return `⚠ ${count} ${count === 1 ? "problem" : "problems"}`;
};

/** Calls in the order they started; a retry after the call it retries. */
export const chronological = (calls: readonly ModelCall[]): ModelCall[] =>
  [...calls].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.attempt - b.attempt,
  );

/** Every call of the model's runs on this analysis: when it ran, how long, and what came of it. */
export const ModelCalls = ({
  calls,
  option,
}: {
  readonly calls: readonly ModelCall[];
  /** The option of the latest run. */
  readonly option: ModelRunOption | null;
}) => {
  const [open, setOpen] = useState(false);
  const ordered = chronological(calls);
  const first = ordered[0];
  if (first === undefined) return null;
  const start = Date.parse(first.startedAt);
  const end = Math.max(...ordered.map((call) => Date.parse(call.startedAt) + call.durationMs));

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        Run details…
      </Button>
      {open && (
        <Dialog
          title={`${modelFamily(option)}'s calls`}
          onClose={() => setOpen(false)}
          className="sm:max-w-3xl"
        >
          <p className="text-ui text-muted-foreground">
            {runName(option) === null ? "" : `On ${runName(option)}. `}
            {formatDuration(end - start)} from the first call to the end of the last. A call whose
            answer has problems runs once more, told what they are.
          </p>
          <table className="tabular w-full text-ui [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:align-top [&_th]:font-normal [&_thead_th]:font-medium [&_thead_th]:text-muted-foreground">
            <thead>
              <tr>
                <th scope="col">Pass</th>
                <th scope="col">Started</th>
                <th scope="col">Time</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((call) => {
                const reasons = call.error === null ? call.problems : [call.error.message];
                return (
                  <tr key={`${call.pass}/${call.attempt}/${call.startedAt}`}>
                    <th scope="row">
                      {PASS_NAMES[call.pass]}
                      {call.attempt > 1 && <span className="text-muted-foreground"> · again</span>}
                    </th>
                    <td>{formatOffset(Date.parse(call.startedAt) - start)}</td>
                    <td>{formatDuration(call.durationMs)}</td>
                    <td>
                      <span className={call.outcome === "failed" ? "text-destructive" : undefined}>
                        {outcomeLabel(call)}
                      </span>
                      {reasons.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                          {reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Dialog>
      )}
    </>
  );
};
