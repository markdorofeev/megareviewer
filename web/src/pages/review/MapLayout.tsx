import { Fragment, memo, type ReactNode, useEffect, useRef, useState } from "react";
import type { MechanicalProof, PartId } from "../../../../src/domain/diff/index.ts";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import {
  FileNotices,
  FilePath,
  FileStatusBadge,
  hunkLocation,
  type LineMark,
  lineCounts,
  MechanicalGroup,
} from "../../diff/index.ts";
import type { Call, CallMark } from "./chips.ts";
import { CallLabel, type HunkDeps, HunkView, hunkAnchor } from "./HunkView.tsx";
import {
  type FileGroup,
  fileGroups,
  gapBetween,
  type MapSection,
  mergedReasons,
  ownReasons,
  sectionKey,
} from "./model.ts";
import { Mention } from "./Peek.tsx";

export const stepAnchor = (key: string): string => `step-${key}`;
export const MECHANICAL_ANCHOR = "mechanical-changes";

/** Where the map scrolls to. `n` changes on every request, so asking twice scrolls twice. */
export interface ScrollRequest {
  readonly id: string;
  readonly n: number;
}

/** An inline call, by the chain of hunks opened to reach it and the call itself. */
export const callKey = (chain: readonly PartId[], call: Call): string =>
  `${chain.join(">")}@${call.line}:${call.symbol}>${call.toPartId}`;

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

/** One call's chip: opens the called hunk in place, unless it's already open higher up. */
const CallChip = ({
  call,
  chain,
  deps,
  openCalls,
  onToggleCall,
}: {
  readonly call: Call;
  readonly chain: readonly PartId[];
  readonly deps: HunkDeps;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
}) => {
  const key = callKey(chain, call);
  if (chain.includes(call.toPartId)) {
    return (
      <li className="call">
        <span className="call-chip above">
          <CallLabel call={call} index={deps.index} />
          <span className="call-note">open above</span>
        </span>
      </li>
    );
  }
  const open = openCalls.has(key);
  return (
    <li className="call">
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
            id={call.toPartId}
            chain={[...chain, call.toPartId]}
            deps={deps}
            openCalls={openCalls}
            onToggleCall={onToggleCall}
          />
        </div>
      )}
    </li>
  );
};

/**
 * One symbol that reaches several hunks: one chip, listing them. Picking one opens it in place,
 * as a chip does; the ones open show under the chip.
 */
const AmbiguousChip = ({
  mark,
  chain,
  deps,
  openCalls,
  onToggleCall,
}: {
  readonly mark: CallMark;
  readonly chain: readonly PartId[];
  readonly deps: HunkDeps;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
}) => {
  const [listing, setListing] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const opened = mark.calls.filter(
    (call) => !chain.includes(call.toPartId) && openCalls.has(callKey(chain, call)),
  );
  const moveFocus = (from: HTMLElement, step: 1 | -1) => {
    const choices = [...(from.closest("ul")?.querySelectorAll<HTMLElement>(".call-choice") ?? [])];
    choices[(choices.indexOf(from) + step + choices.length) % choices.length]?.focus();
  };
  return (
    <li className="call">
      <button
        ref={toggle}
        type="button"
        className="call-chip ambiguous"
        aria-expanded={listing}
        onClick={() => setListing((previous) => !previous)}
      >
        <span className="call-arrow" aria-hidden="true">
          {listing ? "▾" : "▸"}
        </span>
        <code className="call-symbol">{mark.symbol}</code>{" "}
        <span className="call-file">→ {mark.calls.length} places</span>
      </button>
      {listing && (
        <ul className="call-choices" aria-label={`Where ${mark.symbol} goes`}>
          {mark.calls.map((call) => {
            const above = chain.includes(call.toPartId);
            const found = deps.index.parts.get(call.toPartId);
            return (
              <li key={call.toPartId}>
                <button
                  type="button"
                  className="call-choice"
                  disabled={above}
                  aria-pressed={openCalls.has(callKey(chain, call))}
                  onClick={() => {
                    onToggleCall(callKey(chain, call));
                    setListing(false);
                    toggle.current?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      event.stopPropagation();
                      moveFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
                    } else if (event.key === "Escape") {
                      event.stopPropagation();
                      setListing(false);
                      toggle.current?.focus();
                    }
                  }}
                >
                  <CallLabel call={call} index={deps.index} />
                  {found !== undefined && (
                    <span className="call-note"> {hunkLocation(found.hunk)}</span>
                  )}
                  {above && <span className="call-note"> open above</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {opened.map((call) => (
        <div key={call.toPartId} className="inline-call">
          <NestedHunk
            id={call.toPartId}
            chain={[...chain, call.toPartId]}
            deps={deps}
            openCalls={openCalls}
            onToggleCall={onToggleCall}
          />
        </div>
      ))}
    </li>
  );
};

/** A line's chips, under it. */
const InlineCalls = ({
  marks,
  chain,
  deps,
  openCalls,
  onToggleCall,
}: {
  readonly marks: readonly CallMark[];
  /** The hunks open from the top, ending with the one making these calls. */
  readonly chain: readonly PartId[];
  readonly deps: HunkDeps;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
}) => (
  <ul className="calls">
    {marks.map((mark) => {
      const [only, ...more] = mark.calls;
      if (only === undefined) return null;
      const props = { chain, deps, openCalls, onToggleCall };
      return more.length > 0 ? (
        <AmbiguousChip key={`${mark.symbol}*`} mark={mark} {...props} />
      ) : (
        <CallChip key={`${mark.symbol}>${only.toPartId}`} call={only} {...props} />
      );
    })}
  </ul>
);

/** Every call on a line as a chip, one per symbol: how an opened card shows its calls. */
const everyCallAChip = (calls: readonly Call[]): CallMark[] => {
  const bySymbol = new Map<string, Call[]>();
  for (const call of calls) bySymbol.set(call.symbol, [...(bySymbol.get(call.symbol) ?? []), call]);
  return [...bySymbol].map(([symbol, symbolCalls]) => ({
    kind: "chip",
    symbol,
    calls: symbolCalls,
  }));
};

/** A hunk's marks by line: from the chip plan at its own place, every call a chip when opened. */
const marksOf = (chain: readonly PartId[], deps: HunkDeps) => {
  const id = chain.at(-1);
  if (id === undefined) return undefined;
  if (chain.length === 1) return deps.plan.get(id);
  const lines = deps.calls.get(id);
  return lines === undefined
    ? undefined
    : new Map([...lines].map(([line, calls]) => [line, everyCallAChip(calls)]));
};

const belowLines = (
  chain: readonly PartId[],
  deps: HunkDeps,
  openCalls: ReadonlySet<string>,
  onToggleCall: (key: string) => void,
): ReadonlyMap<number, ReactNode> | undefined => {
  const lines = marksOf(chain, deps);
  if (lines === undefined) return undefined;
  return new Map(
    [...lines].flatMap(([line, marks]) => {
      const chips = marks.filter((mark) => mark.kind === "chip");
      return chips.length === 0
        ? []
        : [
            [
              line,
              <InlineCalls
                key={line}
                marks={chips}
                chain={chain}
                deps={deps}
                openCalls={openCalls}
                onToggleCall={onToggleCall}
              />,
            ] as const,
          ];
    }),
  );
};

/** Mentions underlined where their symbol stands. */
const mentionsIn = (id: PartId, deps: HunkDeps): ReadonlyMap<number, readonly LineMark[]> =>
  new Map(
    [...(deps.plan.get(id) ?? [])].flatMap(([line, marks]) => {
      const inLine = marks.flatMap((mark): LineMark[] =>
        mark.kind === "mention"
          ? [
              {
                start: mark.at.start,
                end: mark.at.end,
                render: (code) => (
                  <Mention mark={mark} deps={deps}>
                    {code}
                  </Mention>
                ),
              },
            ]
          : [],
      );
      return inLine.length === 0 ? [] : [[line, inLine] as const];
    }),
  );

const NestedHunk = ({
  id,
  chain,
  deps,
  openCalls,
  onToggleCall,
}: {
  readonly id: PartId;
  readonly chain: readonly PartId[];
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
  readonly via: readonly PartId[];
  readonly deps: HunkDeps;
}) => {
  const known = via.flatMap((id) => {
    const found = deps.index.parts.get(id);
    return found === undefined ? [] : [{ id, ...found }];
  });
  if (known.length === 0) return null;
  const destinations = new Map<string, typeof known>();
  for (const part of known) {
    const step = deps.stepOf(part.id) ?? "Other changes";
    destinations.set(step, [...(destinations.get(step) ?? []), part]);
  }
  return (
    <div className="step-via">
      <span className="step-via-label">Passes through</span>
      {[...destinations].map(([step, parts]) => (
        <details key={step}>
          <summary>
            {step} · {parts.length} {parts.length === 1 ? "part" : "parts"}
          </summary>
          <ul className="hunk-links" aria-label={`Passes through ${step}`}>
            {parts.map(({ id, file, hunk }) => (
              <li key={id}>
                <button type="button" className="hunk-link" onClick={() => deps.onFollow(id)}>
                  {file.path.slice(file.path.lastIndexOf("/") + 1)} {hunkLocation(hunk)} ↑
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
};

/** A part's place on the map: its anchor, and its card, drawn again only when it changes. */
const MapPart = ({
  id,
  deps,
  openCalls,
  onToggleCall,
  signatureOf,
  inFile,
}: {
  readonly id: PartId;
  readonly deps: HunkDeps;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
  readonly signatureOf: (id: PartId) => string;
  readonly inFile: boolean;
}) => (
  <div id={hunkAnchor(id)} className="map-hunk" data-hunk-id={id}>
    <Stable
      signature={signatureOf(id)}
      render={() => (
        <HunkView
          id={id}
          deps={deps}
          belowLine={belowLines([id], deps, openCalls, onToggleCall)}
          inLine={mentionsIn(id, deps)}
          inFile={inFile}
        />
      )}
    />
  </div>
);

/** "⋯ 18 unchanged lines", or the lines between and the file's parts other steps read there. */
const GapRow = ({
  previous,
  next,
  deps,
}: {
  readonly previous: PartId;
  readonly next: PartId;
  readonly deps: HunkDeps;
}) => {
  const gap = gapBetween(previous, next, deps.index);
  if (gap === null || (gap.lines === 0 && gap.parts.length === 0)) return null;
  const lines = `${gap.lines} ${gap.lines === 1 ? "line" : "lines"}`;
  return (
    <div className="file-gap">
      <span aria-hidden="true">⋯</span>{" "}
      {gap.parts.length === 0 ? (
        `${lines} unchanged`
      ) : (
        <>
          {lines}, with changes read elsewhere:{" "}
          {gap.parts.map((id) => {
            const found = deps.index.parts.get(id);
            return (
              <button
                key={id}
                type="button"
                className="hunk-link"
                title={deps.stepOf(id) ?? undefined}
                onClick={() => deps.onFollow(id)}
              >
                {found === undefined ? id : hunkLocation(found.hunk)} ↑
              </button>
            );
          })}
        </>
      )}
    </div>
  );
};

/**
 * A step's parts from one file, on one card: the file once in its header, with one Reviewed mark
 * for them all, and each part under a divider of its own, the lines between them counted.
 */
const FileCard = ({
  group,
  deps,
  part,
}: {
  readonly group: FileGroup;
  readonly deps: HunkDeps;
  readonly part: (id: PartId) => ReactNode;
}) => {
  const items = deps.index.items(group.partIds);
  const toReview = items.filter((item) => !deps.index.mechanical.has(item.id));
  const done = toReview.filter((item) => deps.reviewed.has(item.id)).length;
  const added = items.reduce((sum, item) => sum + lineCounts(item.hunk).added, 0);
  const deleted = items.reduce((sum, item) => sum + lineCounts(item.hunk).deleted, 0);
  const contract = toReview.filter((item) => item.risk.riskClass === "contract").length;
  // Each contract reason once, from the parts' own lines.
  const reasons = mergedReasons(toReview.flatMap((item) => ownReasons(item)));
  const mark = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mark.current !== null) mark.current.indeterminate = done > 0 && done < toReview.length;
  });
  return (
    <section
      className={contract > 0 ? "file-card risk-contract" : "file-card"}
      aria-label={group.file.path}
    >
      <header className="file-card-header">
        <FilePath file={group.file} />
        <FileStatusBadge status={group.file.status} />
        <span className="hunk-counts">
          {toReview.length} {toReview.length === 1 ? "part" : "parts"}
          {contract > 0 && <span className="count-contract"> · {contract} contract</span>} ·{" "}
          <span className="count-added">+{added}</span>{" "}
          <span className="count-deleted">−{deleted}</span>
        </span>
        {reasons.length > 0 && (
          <span className="hunk-contract-reason model-text">{reasons.join("; ")}</span>
        )}
        {toReview.length > 0 && (
          <label className="hunk-reviewed">
            <input
              ref={mark}
              type="checkbox"
              checked={done === toReview.length}
              onChange={(event) => {
                for (const item of toReview) deps.onReviewed(item.id, event.target.checked);
              }}
            />
            Reviewed
          </label>
        )}
      </header>
      {group.partIds.map((id, at) => {
        const previous = group.partIds[at - 1];
        return (
          <Fragment key={id}>
            {previous !== undefined && <GapRow previous={previous} next={id} deps={deps} />}
            {part(id)}
          </Fragment>
        );
      })}
    </section>
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
  isContract,
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
  readonly isContract: (id: PartId) => boolean;
  readonly openCalls: ReadonlySet<string>;
  readonly onToggleCall: (key: string) => void;
  /** Shown before the first step, e.g. decisions on no hunk. */
  readonly before: ReactNode;
  readonly trailingProofs: readonly MechanicalProof[];
  readonly mechanicalCount: number;
  readonly scrollRequest: ScrollRequest | null;
  /** What a hunk's place shows, as a string that changes whenever that does. */
  readonly signatureOf: (id: PartId) => string;
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

  const shown = (ids: readonly PartId[]) => (contractOnly ? ids.filter(isContract) : ids);
  const anyShown = sections.some((section) => shown(section.partIds).length > 0);

  return (
    <section className="main-area map" aria-label="Changes">
      {analysis.tour?.builtBy === "code" && analysis.stages.tour === "done" && (
        <p className="banner">
          The model couldn't title the tour, so its steps keep the code's titles.
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
        const ids = shown(section.partIds);
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
                {section.step.codeTitle !== null && (
                  <p className="step-code-title">{section.step.codeTitle}</p>
                )}
                <p className="model-text">{section.step.explanation}</p>
                {section.step.merged.map((merged) => (
                  <p key={merged.title} className="step-merged">
                    Also reads {merged.title}: <span className="model-text">{merged.reason}</span>
                  </p>
                ))}
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
            {fileGroups(ids, deps.index).map((group) => {
              const part = (id: PartId, inFile: boolean) => (
                <MapPart
                  key={id}
                  id={id}
                  deps={deps}
                  openCalls={openCalls}
                  onToggleCall={onToggleCall}
                  signatureOf={signatureOf}
                  inFile={inFile}
                />
              );
              const [only, ...more] = group.partIds;
              // A file with one part is that part's card, which names the file already.
              return only !== undefined && more.length === 0 ? (
                part(only, false)
              ) : (
                <FileCard
                  key={`${group.file.path}@${only}`}
                  group={group}
                  deps={deps}
                  part={(id) => part(id, true)}
                />
              );
            })}
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
