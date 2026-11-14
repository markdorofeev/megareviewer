import { useId } from "react";
import {
  type ModelPass,
  type ModelRunOption,
  type ModelUsage,
  planOf,
} from "../../../../src/domain/review/index.ts";

const PASS_NAMES: Readonly<Record<ModelPass, string>> = {
  intent: "Intent",
  findings: "Findings",
  risk: "Risk",
  decisions: "Decisions",
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
}: {
  readonly usage: readonly ModelUsage[];
  /** The option of the latest run. */
  readonly option?: ModelRunOption | null;
}) => {
  const id = useId();
  if (usage.length === 0) return null;
  const sum = (pick: (entry: ModelUsage) => number) =>
    usage.reduce((total, entry) => total + pick(entry), 0);
  const onPlan = usage.some((entry) => entry.billing === "plan");
  const timed = usage.some((entry) => entry.durationMs !== undefined);

  return (
    <div className="group relative flex justify-end">
      <button
        type="button"
        className="peer tabular min-h-6 rounded-sm text-caption text-muted-foreground hover:text-foreground"
        aria-describedby={`${id}-breakdown`}
      >
        {runName(option) === null ? "" : `${runName(option)} · `}
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
