import { useId } from "react";
import {
  type Guidance,
  type ModelCall,
  type ModelCallName,
  type ModelRunOption,
  type ModelUsage,
  planOf,
} from "../../../../src/domain/review/index.ts";

const PASS_NAMES: Readonly<Record<ModelCallName, string>> = {
  intent: "Intent",
  findings: "Findings",
  risk: "Risk",
  decisions: "Decisions",
  guardrails: "Guardrails",
  steps: "Tour",
};

/** "182k" for counts in the thousands, so the totals read at a glance. */
export const formatTokens = (count: number): string =>
  count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(1)}M`
    : count >= 1_000
      ? `${Math.round(count / 1_000)}k`
      : `${count}`;

export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`;

/** "41.2 s", or a dash for a pass stored before passes were timed. */
export const formatDuration = (ms: number | undefined): string =>
  ms === undefined ? "—" : `${(ms / 1_000).toFixed(1)} s`;

/** "Sonnet 5.5 through Claude Code"; null for a run stored before the choice, all Haiku 5.5. */
export const runName = (option: ModelRunOption | null): string | null =>
  option === null ? null : `${option.modelName} through ${option.providerName}`;

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/** "3 files it imports", for the files a run's roots import; null for none. */
export const importedRead = (roots: number, imported: number): string | null => {
  if (imported === 0) return null;
  const files = imported === 1 ? "1 file" : `${imported} files`;
  // No root: the one that imports them didn't fit.
  return roots === 0
    ? `${files} imported`
    : `${files} ${roots === 1 ? "it imports" : "they import"}`;
};

/**
 * "6 preferences, CLAUDE.md and 3 files it imports": what a run read beside the code, as the
 * analysis recorded it. Null for a run that read nothing, or stored before runs read any.
 */
export const guidanceRead = (guidance: Guidance | null): string | null => {
  if (guidance === null) return null;
  const count = guidance.preferences.length;
  // The files left for a pass to read count only once one did, which its calls say.
  const given = guidance.guidelines.filter((file) => file.given === "prompt");
  const roots = given.filter((file) => file.linkedFrom === null);
  const imported = importedRead(roots.length, given.length - roots.length);
  const read = [
    ...(count === 0 ? [] : [`${count} ${count === 1 ? "preference" : "preferences"}`]),
    ...roots.map((file) => file.path),
    ...(imported === null ? [] : [imported]),
  ];
  return read.length === 0 ? null : AND.format(read);
};

/** "read 3 harness files", for the files the passes opened on request; null when none did. */
export const harnessRead = (calls: readonly ModelCall[]): string | null => {
  const read = new Set(
    calls.flatMap((call) =>
      call.reads.flatMap(({ outcome, path }) => (outcome === "read" ? [path] : [])),
    ),
  );
  return read.size === 0 ? null : `read ${read.size} harness ${read.size === 1 ? "file" : "files"}`;
};

/** "Sonnet 5.5 through Claude Code with 6 preferences and REVIEW.md": what ran, and on what. */
export const runLine = (
  option: ModelRunOption | null,
  guidance: Guidance | null,
  calls: readonly ModelCall[] = [],
): string | null => {
  const name = runName(option);
  const read = guidanceRead(guidance);
  const line = read === null ? name : name === null ? `With ${read}` : `${name} with ${read}`;
  const opened = harnessRead(calls);
  if (opened === null) return line;
  return line === null ? opened : `${line}, ${opened}`;
};

/** A call's cost, or a dash for a model with no known price. */
const formatCallCost = (usd: number | null): string => (usd === null ? "—" : formatCost(usd));

/**
 * On a plan nothing is charged per review: the cost is what the tokens would be at API prices.
 * Calls with no known price aren't summed around: the line says how many there are.
 */
export const formatTotalCost = (
  costs: readonly (number | null)[],
  onPlan: boolean,
  plan = "Claude",
): string => {
  const known = costs.filter((usd) => usd !== null);
  const unknown = costs.length - known.length;
  const where = onPlan ? `on your ${plan} plan` : null;
  if (known.length === 0) return where ?? "cost unknown";
  const total = formatCost(known.reduce((sum, usd) => sum + usd, 0));
  const unknownNote =
    unknown === 0 ? "" : `, cost unknown for ${unknown} ${unknown === 1 ? "call" : "calls"}`;
  return where === null
    ? `${total}${unknownNote}`
    : `≈ ${total} at API prices${unknownNote}, ${where}`;
};

/** Uncached input, which includes tokens written to the cache. */
const inputOf = (usage: ModelUsage): number => usage.inputTokens + usage.cacheWriteTokens;

/** What the analysis cost and on which model, with a breakdown by pass on hover or focus. */
export const UsageFooter = ({
  usage,
  option = null,
  guidance = null,
  calls = [],
}: {
  readonly usage: readonly ModelUsage[];
  /** The option of the latest run. */
  readonly option?: ModelRunOption | null;
  /** The preferences and guideline files the latest run read. */
  readonly guidance?: Guidance | null;
  /** The calls of its passes, for the harness files they opened. */
  readonly calls?: readonly ModelCall[];
}) => {
  const id = useId();
  if (usage.length === 0) return null;
  const sum = (pick: (entry: ModelUsage) => number) =>
    usage.reduce((total, entry) => total + pick(entry), 0);
  const onPlan = usage.some((entry) => entry.billing === "plan");
  const line = runLine(option, guidance, calls);
  const timed = usage.some((entry) => entry.durationMs !== undefined);

  return (
    <div className="group relative flex justify-end">
      <button
        type="button"
        className="peer tabular min-h-6 rounded-sm text-caption text-muted-foreground hover:text-foreground"
        aria-describedby={`${id}-breakdown`}
      >
        {line === null ? "" : `${line} · `}
        Usage: {formatTokens(sum(inputOf))} tokens in ·{" "}
        {formatTokens(sum((u) => u.cacheReadTokens))} cache read ·{" "}
        {formatTokens(sum((u) => u.outputTokens))} out ·{" "}
        {formatTotalCost(
          usage.map((entry) => entry.costUsd),
          onPlan,
          planOf(option),
        )}
      </button>
      <table
        id={`${id}-breakdown`}
        role="tooltip"
        className="tabular absolute right-0 bottom-full mb-2 hidden rounded-xl bg-popover p-3 text-caption text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover:table peer-focus-visible:table [&_td]:px-2 [&_td]:text-right [&_th]:px-2 [&_th]:text-left [&_thead_th]:font-medium [&_thead_th]:text-muted-foreground"
      >
        <thead>
          <tr>
            <th scope="col">Pass</th>
            <th scope="col">In</th>
            <th scope="col">Cache read</th>
            <th scope="col">Out</th>
            <th scope="col">{onPlan ? "At API prices" : "Cost"}</th>
            {timed && <th scope="col">Time</th>}
          </tr>
        </thead>
        <tbody>
          {usage.map((entry) => (
            <tr key={entry.pass}>
              <th scope="row">{PASS_NAMES[entry.pass]}</th>
              <td>{formatTokens(inputOf(entry))}</td>
              <td>{formatTokens(entry.cacheReadTokens)}</td>
              <td>{formatTokens(entry.outputTokens)}</td>
              <td>{formatCallCost(entry.costUsd)}</td>
              {timed && <td>{formatDuration(entry.durationMs)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
