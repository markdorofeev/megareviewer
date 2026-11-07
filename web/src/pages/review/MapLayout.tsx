import { memo, type ReactNode, useEffect } from "react";
import type { HunkId, MechanicalProof } from "../../../../src/domain/diff/index.ts";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { FileNotices, hunkLocation, MechanicalGroup } from "../../diff/index.ts";
import { CallLabel, type HunkDeps, HunkView, hunkAnchor } from "./HunkView.tsx";
import { type Call, type MapSection, sectionKey } from "./model.ts";

export const stepAnchor = (key: string): string => `step-${key}`;
export const MECHANICAL_ANCHOR = "mechanical-changes";

/** Where the map scrolls to. `n` changes on every request, so asking twice scrolls twice. */
export interface ScrollRequest {
  readonly id: string;
  readonly n: number;
}

/** An inline call, by the chain of hunks opened to reach it and the call itself. */
export const callKey = (chain: readonly HunkId[], call: Call): string =>
  `${chain.join(">")}@${call.line}:${call.symbol}>${call.toHunkId}`;

/**
 * Renders again only when `signature` changes, so a long PR's cards don't all redraw on every key.
 * The signature has to cover everything the card shows, and its handlers have to stay current.
 */
const Stable = memo(
  function Stable({ render }: { readonly signature: string; readonly render: () => ReactNode }) {
    return render();
  },
  (previous, next) => previous.signature === next.signature,
);

/** A nesting level's calls, under the lines that make them. */
const InlineCalls = ({
  calls,
  chain,
  deps,
  openCalls,
  onToggleCall,
}: {
  readonly calls: readonly Call[];
  /** The hunks open from the top, ending with the one making these calls. */
  readonly chain: readonly HunkId[];
  readonly deps: HunkDeps;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
}) => (
  <ul className="calls">
    {calls.map((call) => {
      const key = callKey(chain, call);
      if (chain.includes(call.toHunkId)) {
        return (
          <li key={key} className="call">
            <span className="call-chip above">
              <CallLabel call={call} index={deps.index} />
              <span className="call-note">open above</span>
            </span>
          </li>
        );
      }
      const open = openCalls.has(key);
      return (
        <li key={key} className="call">
          <button
            type="button"
            className="call-chip"
            aria-expanded={open}
            onClick={() => onToggleCall(key)}
          >
            <span className="call-arrow" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            <CallLabel call={call} index={deps.index} />
          </button>
          {open && (
            <div className="inline-call">
              <NestedHunk
                id={call.toHunkId}
                chain={[...chain, call.toHunkId]}
                deps={deps}
                openCalls={openCalls}
                onToggleCall={onToggleCall}
              />
            </div>
          )}
        </li>
      );
    })}
  </ul>
);

const belowLines = (
  chain: readonly HunkId[],
  deps: HunkDeps,
  openCalls: ReadonlySet<string>,
  onToggleCall: (key: string) => void,
): ReadonlyMap<number, ReactNode> | undefined => {
  const id = chain.at(-1);
  const lines = id === undefined ? undefined : deps.calls.get(id);
  if (lines === undefined) return undefined;
  return new Map(
    [...lines].map(([line, calls]) => [
      line,
      <InlineCalls
        key={line}
        calls={calls}
        chain={chain}
        deps={deps}
        openCalls={openCalls}
        onToggleCall={onToggleCall}
      />,
    ]),
  );
};

const NestedHunk = ({
  id,
  chain,
  deps,
  openCalls,
  onToggleCall,
}: {
  readonly id: HunkId;
  readonly chain: readonly HunkId[];
  readonly deps: HunkDeps;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
}) => (
  <HunkView
    id={id}
    deps={deps}
    nested
    belowLine={belowLines(chain, deps, openCalls, onToggleCall)}
  />
);

/** Links to the code of earlier steps a flow runs, which the page shows there, not again here. */
const PassesThrough = ({
  via,
  deps,
}: {
  readonly via: readonly HunkId[];
  readonly deps: HunkDeps;
}) => {
  const known = via.flatMap((id) => {
    const found = deps.index.hunks.get(id);
    return found === undefined ? [] : [{ id, ...found }];
  });
  if (known.length === 0) return null;
  return (
    <div className="step-via">
      <span className="step-via-label">Passes through</span>
      <ul className="hunk-links" aria-label="Passes through">
        {known.map(({ id, file, hunk }) => (
          <li key={id}>
            <button type="button" className="hunk-link" onClick={() => deps.onFollow(id)}>
              {file.path.slice(file.path.lastIndexOf("/") + 1)} {hunkLocation(hunk)} ↑
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Every hunk in one scroll, step after step in tour order, then the mechanical changes. A call in
 * the code opens the hunk it calls in place; the hunk also stays at its own place.
 */
export const MapLayout = ({
  analysis,
  sections,
  deps,
  contractOnly,
  contractHunks,
  openCalls,
  onToggleCall,
  before,
  trailingProofs,
  mechanicalCount,
  scrollRequest,
  signatureOf,
}: {
  readonly analysis: Analysis;
  readonly sections: readonly MapSection[];
  readonly deps: HunkDeps;
  readonly contractOnly: boolean;
  readonly contractHunks: ReadonlySet<HunkId>;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
  /** Shown before the first step, e.g. decisions on no hunk. */
  readonly before: ReactNode;
  readonly trailingProofs: readonly MechanicalProof[];
  readonly mechanicalCount: number;
  readonly scrollRequest: ScrollRequest | null;
  /** What a hunk's place shows, as a string that changes whenever that does. */
  readonly signatureOf: (id: HunkId) => string;
}) => {
  useEffect(() => {
    if (scrollRequest === null) return;
    const target = document.getElementById(scrollRequest.id);
    if (target === null) return;
    // A hunk's card or collapsed row takes the focus, so j and k go on from it.
    const focusable =
      target.querySelector<HTMLElement>(":scope > .hunk-card, :scope > div > .mechanical-toggle") ??
      target;
    const decision = target.classList.contains("decision");
    target.scrollIntoView({ block: decision ? "center" : "start" });
    focusable.focus({ preventScroll: true });
  }, [scrollRequest]);

  const shown = (ids: readonly HunkId[]) =>
    contractOnly ? ids.filter((id) => contractHunks.has(id)) : ids;
  const anyShown = sections.some((section) => shown(section.hunkIds).length > 0);

  return (
    <section className="main-area map" aria-label="Changes">
      {analysis.tour?.builtBy === "code" && analysis.stages.tour === "done" && (
        <p className="banner">
          The model's tour wasn't usable, so this one follows the call graph.
        </p>
      )}
      {before}
      {contractOnly && !anyShown && (
        <p className="muted">
          No contract changes in this pull request. Turn off “Contract changes only” to see the
          rest.
        </p>
      )}
      {sections.map((section) => {
        const ids = shown(section.hunkIds);
        if (contractOnly && ids.length === 0) return null;
        const key = sectionKey(section);
        return (
          <section
            key={key}
            id={stepAnchor(key)}
            className="map-step"
            aria-labelledby={`${stepAnchor(key)}-title`}
            tabIndex={-1}
          >
            {section.kind === "step" ? (
              <header
                className={
                  section.step.kind === "supporting" ? "step-heading supporting" : "step-heading"
                }
              >
                <h2 id={`${stepAnchor(key)}-title`} className="model-text">
                  <span className="step-number">{section.number}</span> {section.step.title}
                </h2>
                <p className="model-text">{section.step.explanation}</p>
                <PassesThrough via={section.step.via} deps={deps} />
              </header>
            ) : (
              <header className="step-heading">
                <h2 id={`${stepAnchor(key)}-title`}>Changes by file</h2>
                <p className="muted">
                  {analysis.status === "running"
                    ? "The guided tour appears when the analysis finishes."
                    : "There's no guided tour, so the changes are shown by file."}
                </p>
              </header>
            )}
            {ids.map((id) => (
              <div key={id} id={hunkAnchor(id)} className="map-hunk" data-hunk-id={id}>
                <Stable
                  signature={signatureOf(id)}
                  render={() => (
                    <HunkView
                      id={id}
                      deps={deps}
                      belowLine={belowLines([id], deps, openCalls, onToggleCall)}
                    />
                  )}
                />
              </div>
            ))}
          </section>
        );
      })}
      {!contractOnly && (
        <div id={MECHANICAL_ANCHOR} className="map-mechanical" tabIndex={-1}>
          {mechanicalCount === 0 && analysis.stages.prep === "done" && (
            <p className="muted">No mechanical changes in this pull request.</p>
          )}
          <MechanicalGroup files={analysis.files} proofs={trailingProofs} risk={analysis.risk} />
          <FileNotices files={analysis.files} />
        </div>
      )}
    </section>
  );
};
