import { useEffect, useId, useRef, useState } from "react";
import type { HunkId } from "../../../../src/domain/diff/index.ts";
import type { Decision } from "../../../../src/domain/review/index.ts";
import { hunkLocation } from "../../diff/index.ts";
import { hunkAnchor } from "./HunkView.tsx";
import { barHeight, type HunkIndex, type MapSection, type RiskMix, sectionKey } from "./model.ts";

/** Where a click on the rail goes. */
export type RailTarget =
  | { readonly kind: "hunk"; readonly hunkId: HunkId }
  | { readonly kind: "section"; readonly key: string }
  | { readonly kind: "mechanical" };

/**
 * Hunks of these IDs whose place on the page is in the viewport, in the order given. Without
 * IntersectionObserver (tests), none is.
 */
const useInView = (ids: readonly HunkId[]): ReadonlySet<HunkId> => {
  const [inView, setInView] = useState<ReadonlySet<HunkId>>(new Set());
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    setInView(new Set());
    const visible = new Set<HunkId>();
    const idOf = new Map<Element, HunkId>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = idOf.get(entry.target);
        if (id === undefined) continue;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      setInView(new Set(visible));
    });
    for (const id of ids) {
      const element = document.getElementById(hunkAnchor(id));
      if (element === null) continue;
      idOf.set(element, id);
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);
  return inView;
};

/**
 * The map beside the code: each step with one bar per hunk, as tall as the hunk is long within
 * bounds and colored by risk, marked for each decision on it and for a contract rule's reason.
 * Reviewed hunks are dimmed and ticked, and the hunks in view are outlined. Clicking scrolls there.
 */
export const RiskRail = ({
  sections,
  index,
  decisionsOn,
  totals,
  reviewedHunks,
  contractOnly,
  onContractOnly,
  mechanicalCount,
  onGo,
  onInView,
}: {
  readonly sections: readonly MapSection[];
  readonly index: HunkIndex;
  /** Every decision resting on the hunk. */
  readonly decisionsOn: (id: HunkId) => readonly Decision[];
  readonly totals: RiskMix;
  readonly reviewedHunks: ReadonlySet<string>;
  readonly contractOnly: boolean;
  readonly onContractOnly: (contractOnly: boolean) => void;
  readonly mechanicalCount: number;
  readonly onGo: (target: RailTarget) => void;
  /** The hunks in view, in page order, whenever they change. */
  readonly onInView: (ids: readonly HunkId[]) => void;
}) => {
  const id = useId();
  const rail = useRef<HTMLElement>(null);
  const [ids, setIds] = useState<readonly HunkId[]>([]);
  // The hunks the page shows; their places change when the filter does.
  const shown = sections
    .flatMap((section) => section.hunkIds)
    .filter((hunkId) => !contractOnly || index.items([hunkId])[0]?.risk.riskClass === "contract");
  const shownKey = shown.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the IDs change when their list does.
  useEffect(() => setIds(shown), [shownKey]);
  const inView = useInView(ids);

  const report = useRef(onInView);
  report.current = onInView;
  useEffect(() => {
    report.current(ids.filter((hunkId) => inView.has(hunkId)));
    // Keep the outlined bars in sight when the rail is longer than the window.
    const box = rail.current;
    const first = box?.querySelector<HTMLElement>(".rail-bar.in-view");
    if (box === null || box === undefined || first === null || first === undefined) return;
    const top = first.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [inView, ids]);

  return (
    <aside ref={rail} className="risk-rail" aria-labelledby={`${id}-title`}>
      <div className="rail-header">
        <h2 id={`${id}-title`}>Map</h2>
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
      <ol className="rail-steps">
        {sections.map((section) => {
          const key = sectionKey(section);
          const toReview = section.hunkIds.filter((hunkId) => !index.mechanical.has(hunkId));
          const done = toReview.length > 0 && toReview.every((hunkId) => reviewedHunks.has(hunkId));
          return (
            <li key={key}>
              <button
                type="button"
                className="rail-step"
                onClick={() => onGo({ kind: "section", key })}
              >
                {section.kind === "step" && (
                  <span className="rail-step-number">{section.number}</span>
                )}{" "}
                <span className="rail-step-title model-text">
                  {section.kind === "step" ? section.step.title : "Changes by file"}
                </span>
                {done && (
                  <span className="rail-tick" role="img" aria-label="reviewed">
                    ✓
                  </span>
                )}
              </button>
              <ul className="rail-bars">
                {index.items(section.hunkIds).map(({ hunk, file, risk }) => {
                  const mechanical = index.mechanical.has(hunk.id);
                  const riskClass = mechanical ? "mechanical" : risk.riskClass;
                  const isReviewed = !mechanical && reviewedHunks.has(hunk.id);
                  const decisions = decisionsOn(hunk.id);
                  const rule = riskClass === "contract" && risk.source === "rule";
                  const classes = [
                    "rail-bar",
                    `risk-${riskClass}`,
                    isReviewed && "reviewed",
                    inView.has(hunk.id) && "in-view",
                    contractOnly && riskClass !== "contract" && "dimmed",
                  ];
                  return (
                    <li key={hunk.id}>
                      <button
                        type="button"
                        className={classes.filter(Boolean).join(" ")}
                        style={{ height: barHeight(hunk) }}
                        aria-label={`${file.path}, ${hunkLocation(hunk)}, ${riskClass}${isReviewed ? ", reviewed" : ""}`}
                        aria-current={inView.has(hunk.id) ? "location" : undefined}
                        onClick={() => onGo({ kind: "hunk", hunkId: hunk.id })}
                      >
                        <span className="rail-marks">
                          {rule && (
                            <span className="rail-mark mark-rule" title={risk.reason}>
                              <span className="visually-hidden">Rule: {risk.reason}</span>
                            </span>
                          )}
                          {decisions.map((decision) => (
                            <span
                              key={decision.id}
                              className="rail-mark mark-decision"
                              title={decision.title}
                            >
                              <span className="visually-hidden">Decision: {decision.title}</span>
                            </span>
                          ))}
                        </span>
                        {isReviewed && (
                          <span className="rail-bar-tick" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="rail-step mechanical"
            onClick={() => onGo({ kind: "mechanical" })}
          >
            <span className="rail-step-title">Proved mechanical ({mechanicalCount})</span>
          </button>
        </li>
      </ol>
      <ul className="rail-legend" aria-label="Legend">
        <li>
          <span className="legend-swatch risk-contract" /> Contract
        </li>
        <li>
          <span className="legend-swatch risk-logic" /> Logic
        </li>
        <li>
          <span className="legend-swatch risk-mechanical" /> Mechanical
        </li>
        <li>
          <span className="rail-mark mark-decision" /> Decision
        </li>
        <li>
          <span className="rail-mark mark-rule" /> Contract rule
        </li>
      </ul>
    </aside>
  );
};
