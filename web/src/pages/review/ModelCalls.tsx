import { FileTextIcon } from "lucide-react";
import { useState } from "react";
import {
  type Guidance,
  type HarnessRead,
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
  steps: "Tour",
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

/** "harness/docs/rules.md, lines 3–40" */
const readLabel = ({ path, fromLine, toLine }: HarnessRead): string =>
  fromLine === null || toLine === null ? path : `${path}, lines ${fromLine}–${toLine}`;

/** One use of the reader: a search that showed several files is one entry. */
interface ReadEntry {
  readonly first: HarnessRead;
  readonly shown: readonly string[];
}

const sameSearch = (a: HarnessRead, b: HarnessRead): boolean =>
  a.tool === "search" &&
  b.tool === "search" &&
  a.round === b.round &&
  a.outcome === b.outcome &&
  a.search?.pattern === b.search?.pattern &&
  a.search?.path === b.search?.path;

const entriesOf = (reads: readonly HarnessRead[]): ReadEntry[] => {
  const entries: { first: HarnessRead; shown: string[] }[] = [];
  for (const read of reads) {
    const last = entries.at(-1);
    if (last !== undefined && sameSearch(last.first, read)) last.shown.push(read.path);
    else entries.push({ first: read, shown: [read.path] });
  }
  return entries;
};

const VERBS: Readonly<Record<NonNullable<HarnessRead["tool"]>, string>> = {
  read: "Read",
  search: "Searched",
  loaded: "Loaded by itself",
};

const verbOf = ({ outcome, tool }: HarnessRead): string => {
  if (outcome === "refused") return tool === "search" ? "Search refused" : "Refused";
  return tool === undefined ? "Read" : VERBS[tool];
};

/** What the entry asked for: a file and its lines, or what a search looked for and where. */
const askedOf = ({ first, shown }: ReadEntry): string => {
  if (first.search === undefined) return readLabel(first);
  const where = `“${first.search.pattern}” in ${first.search.path}`;
  const files = shown.filter((path) => path !== first.search?.path);
  return files.length === 0 ? where : `${where}: ${files.join(", ")}`;
};

/** The reader's log of one call: whether it had the tool, then each use in order, by round. */
const ReadLog = ({ call }: { readonly call: ModelCall }) => {
  const entries = entriesOf(call.reads);
  const header =
    call.reader === "on"
      ? `Read tool on ${call.readable ?? 0} ${call.readable === 1 ? "file" : "files"}${entries.length === 0 ? ", nothing read" : ""}`
      : call.reader === "off"
        ? "Without the read tool"
        : null;
  if (header === null && entries.length === 0) return null;
  return (
    <div className="mt-1 text-muted-foreground">
      {header}
      {entries.length > 0 && (
        <ol aria-label="What it read" className="flex flex-col gap-0.5">
          {entries.map((entry, index) => {
            const { first } = entry;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: the log is fixed and can repeat a read.
              <li key={index} className="flex gap-2">
                <span className="tabular w-6 shrink-0 text-caption">
                  {first.round === undefined ? "" : `R${first.round}`}
                </span>
                <span className="min-w-0">
                  <span className={first.outcome === "refused" ? "text-destructive" : undefined}>
                    {verbOf(first)}
                  </span>{" "}
                  <span className="font-mono text-code-compact break-all text-foreground">
                    {askedOf(entry)}
                  </span>
                  {first.chars !== undefined && (
                    <span className="tabular">
                      {" "}
                      · {first.chars.toLocaleString("en-US")} characters
                    </span>
                  )}
                  {first.reason !== undefined && (
                    <span className="break-words">: {first.reason}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
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
  preferences,
}: {
  readonly guidance: Guidance;
  readonly leftOut: number;
  readonly preferences: string;
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
        <Link to={preferences} className="underline">
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
        {guidance.guidelines
          .filter((file) => file.given === "prompt")
          .map((file) => (
            <li key={file.ref} className="flex items-center gap-2">
              <FileTextIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
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
  preferences = PREFERENCES_PATH,
}: {
  readonly calls: readonly ModelCall[];
  /** The option of the latest run. */
  readonly option: ModelRunOption | null;
  /** The preferences and guideline files the latest run read. */
  readonly guidance?: Guidance | null;
  /** How many of its points a preference or a guideline file left out. */
  readonly leftOut?: number;
  /** The preferences page on the PR's repository. */
  readonly preferences?: string;
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
            answer has problems only it can fix runs once more, told what they are, and one whose
            reading failed runs once more without it.
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
                      <ReadLog call={call} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {guidance !== null && (
            <GuidanceRead guidance={guidance} leftOut={leftOut} preferences={preferences} />
          )}
        </Dialog>
      )}
    </>
  );
};
