import { useId } from "react";
import type { TourStep } from "../../../../src/domain/review/index.ts";
import { entryKey, type MainView, type RiskMix, type TourEntry } from "./model.ts";

const RISK_CLASSES = ["contract", "logic", "mechanical"] as const;

/** A step's changed lines by risk class, as a thin bar: contract, then logic, then mechanical. */
const MixBar = ({ mix }: { readonly mix: RiskMix }) => {
  const total = mix.contract + mix.logic + mix.mechanical;
  if (total === 0) return null;
  return (
    <span className="risk-mix" aria-hidden="true">
      {RISK_CLASSES.map((riskClass) =>
        mix[riskClass] === 0 ? null : (
          <span
            key={riskClass}
            className={`risk-mix-${riskClass}`}
            style={{ flexGrow: mix[riskClass] }}
          />
        ),
      )}
    </span>
  );
};

/**
 * The tour's steps in the sidebar, then the mechanical changes. Each step shows how many contract
 * hunks it holds and its mix of risk, so the reviewer sees where attention goes before reading.
 */
export const TourNav = ({
  steps,
  mechanicalCount,
  mixes,
  contractCounts,
  totals,
  current,
  visited,
  contractOnly,
  onContractOnly,
  onSelect,
}: {
  readonly steps: readonly TourStep[];
  readonly mechanicalCount: number;
  /** Each entry's risk mix, by entry key. */
  readonly mixes: ReadonlyMap<string, RiskMix>;
  /** Each step's contract hunks, by entry key. */
  readonly contractCounts: ReadonlyMap<string, number>;
  /** Hunks by risk class across the pull request. */
  readonly totals: RiskMix;
  /** null while a decision or a mismatch is in focus. */
  readonly current: MainView | null;
  readonly visited: ReadonlySet<string>;
  readonly contractOnly: boolean;
  readonly onContractOnly: (contractOnly: boolean) => void;
  readonly onSelect: (entry: TourEntry) => void;
}) => {
  const id = useId();
  const currentKey = current === null ? null : entryKey(current);
  const entries: readonly (TourEntry & { readonly label: string; readonly number: string })[] = [
    ...steps.map((step, index) => ({
      kind: "step" as const,
      stepId: step.id,
      label: step.title,
      number: `${index + 1}`,
    })),
    {
      kind: "mechanical" as const,
      label: `Generated and mechanical (${mechanicalCount})`,
      number: "",
    },
  ];

  return (
    <nav className="tour-nav" aria-labelledby={`${id}-title`}>
      <div className="tour-header">
        <h2 id={`${id}-title`}>Tour</h2>
        <p className="risk-totals">
          <span className={totals.contract > 0 ? "risk-total-contract" : undefined}>
            {totals.contract} contract
          </span>{" "}
          · {totals.logic} logic · {totals.mechanical} mechanical
        </p>
        <label className="contract-only">
          <input
            type="checkbox"
            checked={contractOnly}
            onChange={(event) => onContractOnly(event.target.checked)}
          />
          Contract changes only
        </label>
      </div>
      <ol>
        {entries.map((entry) => {
          const key = entryKey(entry);
          const isCurrent = key === currentKey;
          const seen = visited.has(key);
          const mix = mixes.get(key);
          const contract = contractCounts.get(key) ?? 0;
          const dimmed = contractOnly && contract === 0;
          return (
            <li key={key}>
              <button
                type="button"
                className={`tour-entry${isCurrent ? " current" : ""}${entry.kind === "mechanical" ? " mechanical" : ""}${dimmed ? " dimmed" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onSelect(entry)}
              >
                <span className="tour-mark" aria-hidden="true">
                  {seen ? "✓" : ""}
                </span>
                {entry.number !== "" && <span className="tour-number">{entry.number}</span>}
                <span className="tour-title model-text">{entry.label}</span>
                {contract > 0 && (
                  <span className="tour-contract">
                    {contract}
                    <span className="visually-hidden"> contract</span>
                  </span>
                )}
                {seen && <span className="visually-hidden">(visited)</span>}
              </button>
              {mix !== undefined && <MixBar mix={mix} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
