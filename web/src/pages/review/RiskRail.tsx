import { useEffect, useId, useRef, useState } from "react";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import type { Decision } from "../../../../src/domain/review/index.ts";
import { hunkLocation } from "../../diff/index.ts";
import { hunkAnchor } from "./HunkView.tsx";
import { barHeight, type MapSection, type PartIndex, type RiskMix, sectionKey } from "./model.ts";

/** Where a click on the rail goes. */
export type RailTarget =
  | { readonly kind: "hunk"; readonly partId: PartId }
  | { readonly kind: "section"; readonly key: string }
  | { readonly kind: "mechanical" };

/**
 * Hunks of these IDs whose place on the page is in the viewport, in the order given. Without
 * IntersectionObserver (tests), none is.
 */
const useInView = (ids: readonly PartId[]): ReadonlySet<PartId> => {
  const [inView, setInView] = useState<ReadonlySet<PartId>>(new Set());
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    setInView(new Set());
    const visible = new Set<PartId>();
    const idOf = new Map<Element, PartId>();
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
 * The map beside the code: each step with a row per hunk, its file and lines beside a bar as tall
 * as the hunk is long within bounds, colored by risk, and marked for each decision on it and for a
 * contract rule's reason. Reviewed hunks are dimmed and ticked, and the hunks in view are
 * outlined. Clicking scrolls there.
 */
export const RiskRail = ({
  sections,
  index,
  decisionsOn,
  totals,
  reviewed,
  contractOnly,
  onContractOnly,
  mechanicalCount,
  onGo,
  onInView,
}: {
  readonly sections: readonly MapSection[];
  readonly index: PartIndex;
  /** Every decision resting on the hunk. */
  readonly decisionsOn: (id: PartId) => readonly Decision[];
  readonly totals: RiskMix;
  readonly reviewed: ReadonlySet<PartId>;
  readonly contractOnly: boolean;
  readonly onContractOnly: (contractOnly: boolean) => void;
  readonly mechanicalCount: number;
  readonly onGo: (target: RailTarget) => void;
  /** The hunks in view, in page order, whenever they change. */
  readonly onInView: (ids: readonly PartId[]) => void;
}) => {
  const id = useId();
  const rail = useRef<HTMLElement>(null);
  const [ids, setIds] = useState<readonly PartId[]>([]);
  // The hunks the page shows; their places change when the filter does.
  const shown = sections
    .flatMap((section) => section.partIds)
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
          const toReview = section.partIds.filter((hunkId) => !index.mechanical.has(hunkId));
          const done = toReview.length > 0 && toReview.every((id) => reviewed.has(id));
          return (
            <li key={key}>
              <button
                type="button"
                className={
                  section.kind === "step" && section.step.kind === "supporting"
                    ? "rail-step supporting"
                    : "rail-step"
                }
                onClick={() => onGo({ kind: "section", key })}
              >
                {section.kind === "step" && (
                  <span className="rail-step-number">{section.number}</span>
                )}{" "}
                <span
                  className="rail-step-title model-text"
                  title={section.kind === "step" ? section.step.title : undefined}
                >
                  {section.kind === "step" ? section.step.title : "Changes by file"}
                </span>
                {done && (
                  <span className="rail-tick" role="img" aria-label="reviewed">
                    ✓
                  </span>
                )}
              </button>
              <ul className="rail-bars">
                {index.items(section.partIds).map(({ id: partId, hunk, file, risk }) => {
                  const mechanical = index.mechanical.has(partId);
                  const riskClass = mechanical ? "mechanical" : risk.riskClass;
                  const isReviewed = !mechanical && reviewed.has(partId);
                  const decisions = decisionsOn(partId);
                  const rule = riskClass === "contract" && risk.source === "rule";
                  const meta = [
                    riskClass,
                    decisions.length > 0 &&
                      `${decisions.length} ${decisions.length === 1 ? "decision" : "decisions"}`,
                  ];
                  const classes = [
                    "rail-hunk",
                    inView.has(partId) && "in-view",
                    contractOnly && riskClass !== "contract" && "dimmed",
                  ];
                  return (
                    <li key={partId}>
                      <button
                        type="button"
                        className={classes.filter(Boolean).join(" ")}
                        aria-label={`${file.path}, ${hunkLocation(hunk)}, ${riskClass}${isReviewed ? ", reviewed" : ""}`}
                        aria-current={inView.has(partId) ? "location" : undefined}
                        onClick={() => onGo({ kind: "hunk", partId })}
                      >
                        <span
                          className={`rail-bar risk-${riskClass}${isReviewed ? " reviewed" : ""}`}
                          style={{ height: barHeight(hunk) }}
                        >
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
                        <span className="rail-hunk-text">
                          <span className="rail-hunk-file">
                            {file.path.split("/").at(-1)}{" "}
                            {hunkLocation(hunk).replace(/^lines /, "")}
                          </span>
                          <span className="rail-hunk-meta">{meta.filter(Boolean).join(" · ")}</span>
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
