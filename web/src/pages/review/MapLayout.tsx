import { Fragment, memo, type ReactNode, useEffect, useRef, useState } from "react";
import type { MechanicalProof, PartId } from "../../../../src/domain/diff/index.ts";
import { type Analysis, pathReasons } from "../../../../src/domain/review/index.ts";
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
import { type FileGroup, fileGroups, gapBetween, type MapSection, sectionKey } from "./model.ts";
import { Mention } from "./Peek.tsx";

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
    at: null,
  }));
};

/** A chip that is the symbol in the code: one call, whose symbol is on its line. */
const inCode = (
  mark: CallMark,
): mark is Extract<CallMark, { kind: "chip" }> & {
  readonly at: NonNullable<Extract<CallMark, { kind: "chip" }>["at"]>;
} => mark.kind === "chip" && mark.at !== null && mark.calls.length === 1;

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
      // A call that's the symbol in the code has no row; what it opens shows under the line.
      const rows = marks.filter((mark) => mark.kind === "chip" && !inCode(mark));
      const opened = marks
        .filter(inCode)
        .flatMap((mark) => mark.calls)
        .filter((call) => !chain.includes(call.toPartId) && openCalls.has(callKey(chain, call)));
      return rows.length === 0 && opened.length === 0
        ? []
        : [
            [
              line,
              <Fragment key={line}>
                {rows.length > 0 && (
                  <InlineCalls
                    marks={rows}
                    chain={chain}
                    deps={deps}
                    openCalls={openCalls}
                    onToggleCall={onToggleCall}
                  />
                )}
                {opened.map((call) => (
                  <div key={callKey(chain, call)} className="inline-call">
                    <NestedHunk
                      id={call.toPartId}
                      chain={[...chain, call.toPartId]}
                      deps={deps}
                      openCalls={openCalls}
                      onToggleCall={onToggleCall}
                    />
                  </div>
                ))}
              </Fragment>,
            ] as const,
          ];
    }),
  );
};

/**
 * Calls underlined where their symbol stands: a mention goes to the code it calls, and the first
 * call to code on the map opens it under the line.
 */
const mentionsIn = (
  id: PartId,
  deps: HunkDeps,
  openCalls: ReadonlySet<string>,
  onToggleCall: (key: string) => void,
): ReadonlyMap<number, readonly LineMark[]> =>
  new Map(
    [...(deps.plan.get(id) ?? [])].flatMap(([line, marks]) => {
      const inLine = marks.flatMap((mark): LineMark[] => {
        if (mark.kind === "mention") {
          return [
            {
              start: mark.at.start,
              end: mark.at.end,
              render: (code) => (
                <Mention mark={mark} deps={deps}>
                  {code}
                </Mention>
              ),
            },
          ];
        }
        const [call] = mark.calls;
        if (!inCode(mark) || call === undefined || call.toPartId === id) return [];
        const key = callKey([id], call);
        return [
          {
            start: mark.at.start,
            end: mark.at.end,
            render: (code) => (
              <Mention
                mark={mark}
                deps={deps}
                expanded={openCalls.has(key)}
                onToggle={() => onToggleCall(key)}
              >
                {code}
              </Mention>
            ),
          },
        ];
      });
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
          inLine={mentionsIn(id, deps, openCalls, onToggleCall)}
          inFile={inFile}
        />
      )}
    />
  </div>
);

/** Arrows apart from a line: lines folded away here. */
const UnfoldIcon = () => (
  <svg
    className="unfold-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M8 1.5v4M5.5 3.5 8 1l2.5 2.5M8 14.5v-4M5.5 12.5 8 15l2.5-2.5M2 8h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The lines between two parts on a card, folded: how many, under an unfold icon. With the
 * contract filter on, they can hold changes it hides, so the row doesn't call them unchanged.
 */
const GapRow = ({ lines, hidden }: { readonly lines: number; readonly hidden: boolean }) => {
  if (lines === 0 && !hidden) return null;
  const count = `${lines} ${lines === 1 ? "line" : "lines"}`;
  return (
    <div className="file-gap folded">
      <UnfoldIcon />
      <span>{hidden ? `${count}, with changes the filter hides` : `${count} unchanged`}</span>
    </div>
  );
};

/**
 * A file's parts on one card: the file once in its header, and each part under a divider of its
 * own when it has something to say, the lines between them folded.
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
  const added = items.reduce((sum, item) => sum + lineCounts(item.hunk).added, 0);
  const deleted = items.reduce((sum, item) => sum + lineCounts(item.hunk).deleted, 0);
  const contract = items.filter(
    (item) => !deps.index.mechanical.has(item.id) && item.risk.riskClass === "contract",
  ).length;
  // A path rule holds for every part of the file, so its reason is said once, here.
  const fileReasons = contract > 0 ? pathReasons(group.file) : [];
  return (
    <section
      className={contract > 0 ? "file-card risk-contract" : "file-card"}
      aria-label={group.file.path}
    >
      <header className="file-card-header">
        <FilePath file={group.file} />
        {/* Nearly every file is modified, so only the other statuses are worth a badge. */}
        {group.file.status !== "modified" && <FileStatusBadge status={group.file.status} />}
        <span className="hunk-counts">
          {fileReasons.length > 0 && (
            <span className="file-card-reason">{fileReasons.join("; ")} · </span>
          )}
          {contract > 0 && <span className="count-contract">{contract} contract · </span>}
          <span className="count-added">+{added}</span>{" "}
          <span className="count-deleted">−{deleted}</span>
        </span>
      </header>
      {group.partIds.map((id, at) => {
        const previous = group.partIds[at - 1];
        const gap = previous === undefined ? null : gapBetween(previous, id, deps.index);
        return (
          <Fragment key={id}>
            {gap !== null && <GapRow lines={gap.lines} hidden={gap.parts.length > 0} />}
            {part(id)}
          </Fragment>
        );
      })}
    </section>
  );
};

/**
 * Every hunk in one scroll, file after file in the call graph's order, then the mechanical changes.
 * A call in the code opens the hunk it calls in place; the hunk also stays at its own place.
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
  /** Shown before the first file, e.g. decisions on no hunk. */
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
          <section key={key} className="map-step" aria-label="Files" tabIndex={-1}>
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
              return (
                <FileCard
                  key={`${group.file.path}@${group.partIds[0]}`}
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
