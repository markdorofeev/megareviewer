import { FileTextIcon } from "lucide-react";
import { useState } from "react";
import {
  type Guidance,
  type ModelCall,
  type ModelCallName,
  type ModelRunOption,
  modelFamily,
} from "../../../../src/domain/review/index.ts";
import { Link } from "../../app/Link.tsx";
import { PREFERENCES_PATH } from "../../app/router.ts";
import { Button } from "../../ui/button.tsx";
import { KindChip, repoName } from "../preferences/rule.tsx";
import { formatBytes } from "../preferences/view.ts";
import { Dialog } from "./Dialog.tsx";
import { formatDuration, guidanceRead, runName } from "./UsageFooter.tsx";

const PASS_NAMES: Readonly<Record<ModelCallName, string>> = {
  intent: "Intent",
  findings: "Findings",
  risk: "Risk",
  decisions: "Decisions",
  guardrails: "Guardrails",
  stops: "Tour",
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

/**
 * The preferences and guideline files the run read, as it had them, and how many points they left
 * out. The list is the run's own record: a preference edited or deleted since reads as it did then.
 */
const GuidanceRead = ({
  guidance,
  leftOut,
}: {
  readonly guidance: Guidance;
  readonly leftOut: number;
}) => {
  const read = guidanceRead(guidance);
  if (read === null) return null;
  return (
    <section aria-label="What the run read beside the code" className="flex flex-col gap-1.5">
      <h3 className="font-medium">Read beside the code</h3>
      <p className="text-ui text-muted-foreground">
        {read}, as they were when the run started.{" "}
        {leftOut === 0
          ? "No point was left out by them."
          : `${leftOut} ${leftOut === 1 ? "point was" : "points were"} left out by them, folded where ${leftOut === 1 ? "its card" : "their cards"} would be.`}{" "}
        <Link to={PREFERENCES_PATH} className="underline">
          Preferences
        </Link>
      </p>
      <ul className="flex flex-col gap-1 text-ui">
        {guidance.preferences.map((preference) => (
          <li key={preference.ref} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <KindChip kind={preference.kind} />
            <span className="min-w-0 flex-1 basis-56 break-words">{preference.text}</span>
            <span className="text-caption text-muted-foreground">
              {preference.scope.kind === "global" ? "Everywhere" : repoName(preference.scope.repo)}
            </span>
          </li>
        ))}
        {guidance.guidelines.map((file) => (
          <li key={file.ref} className="flex items-center gap-2">
            <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-code-compact break-all">{file.path}</span>
            <span className="tabular text-caption text-muted-foreground">
              {formatBytes(file.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

/**
 * Every call of the model's runs on this analysis: when it ran, how long, and what came of it;
 * then what the latest run read beside the code.
 */
export const ModelCalls = ({
  calls,
  option,
  guidance = null,
  leftOut = 0,
}: {
  readonly calls: readonly ModelCall[];
  /** The option of the latest run. */
  readonly option: ModelRunOption | null;
  /** The preferences and guideline files the latest run read. */
  readonly guidance?: Guidance | null;
  /** How many of its points a preference or a guideline file left out. */
  readonly leftOut?: number;
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
          {guidance !== null && <GuidanceRead guidance={guidance} leftOut={leftOut} />}
        </Dialog>
      )}
    </>
  );
};
