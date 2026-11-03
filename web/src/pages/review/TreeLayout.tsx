import { type ReactNode, useEffect, useId, useMemo, useRef } from "react";
import type { HunkId, MechanicalProof } from "../../../../src/domain/diff/index.ts";
import { hunkLocation } from "../../diff/index.ts";
import type { CallTree, CallTreeRow } from "./call-tree.ts";
import { CallLabel, type HunkDeps, HunkView } from "./HunkView.tsx";

const NO_LINKS = () => [];

/** Deeper rows indent no further, so a long chain stays readable. */
const MAX_INDENT = 12;

/**
 * The changed hunks as a tree from the entry points, one hunk at a time: the tree on the left, the
 * selected hunk on the right with the path that leads to it, its callers and its calls as links.
 */
export const TreeLayout = ({
  tree,
  order,
  deps,
  selected,
  focus,
  onSelect,
  proofs,
}: {
  readonly tree: CallTree;
  /** The tree's hunks in order, for the next one. */
  readonly order: readonly HunkId[];
  readonly deps: HunkDeps;
  readonly selected: HunkId | null;
  /** Whether the selected hunk takes the focus: not when the page opens, only once one is picked. */
  readonly focus: boolean;
  /** `from` is the hunk whose call was followed, for ← to go back to. */
  readonly onSelect: (id: HunkId, from?: HunkId) => void;
  readonly proofs: readonly MechanicalProof[];
}) => {
  const id = useId();
  const nav = useRef<HTMLElement>(null);
  const { index } = deps;
  // Keeps the selected row in sight when the tree is longer than the window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the selection changes.
  useEffect(() => {
    const box = nav.current;
    const row = box?.querySelector<HTMLElement>(".tree-row.selected");
    if (box === null || box === undefined || row === null || row === undefined) return;
    if (row.offsetTop < box.scrollTop || row.offsetTop > box.scrollTop + box.clientHeight - 40) {
      box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
    }
  }, [selected]);
  const placedRow = useMemo(
    () =>
      new Map(
        tree.rows.flatMap((row) => (row.kind === "hunk" ? [[row.hunkId, row] as const] : [])),
      ),
    [tree],
  );
  const whereIs = (hunkId: HunkId): string => {
    const found = index.hunks.get(hunkId);
    return found === undefined ? "" : `${found.file.path}:${found.hunk.newStart}`;
  };
  const labelOf = (hunkId: HunkId): string => placedRow.get(hunkId)?.symbol ?? whereIs(hunkId);

  const crumbs: HunkId[] = [];
  for (
    let at = selected === null ? undefined : placedRow.get(selected);
    at !== undefined;
    at = at.parent === null ? undefined : placedRow.get(at.parent)
  ) {
    crumbs.unshift(at.hunkId);
  }
  if (selected !== null && crumbs.length === 0) crumbs.push(selected);
  const callers =
    selected === null
      ? []
      : deps.linksOf(selected).filter((link) => link.direction === "called-by");
  const next = selected === null ? order[0] : order[order.indexOf(selected) + 1];
  const treeDeps = useMemo(() => ({ ...deps, linksOf: NO_LINKS }), [deps]);

  const calls = selected === null ? undefined : deps.calls.get(selected);
  const belowLine =
    selected === null || calls === undefined
      ? undefined
      : new Map<number, ReactNode>(
          [...calls].map(([line, lineCalls]) => [
            line,
            <ul key={line} className="calls">
              {lineCalls.map((call) => (
                <li key={`${call.symbol}>${call.toHunkId}`} className="call">
                  <button
                    type="button"
                    className="call-chip"
                    onClick={() => onSelect(call.toHunkId, selected)}
                  >
                    <span className="call-arrow" aria-hidden="true">
                      →
                    </span>
                    <CallLabel call={call} index={index} />
                  </button>
                </li>
              ))}
            </ul>,
          ]),
        );

  const row = (treeRow: CallTreeRow, key: string) => {
    const hunkId = treeRow.hunkId;
    const mechanical = index.mechanical.has(hunkId);
    const riskClass = mechanical
      ? "mechanical"
      : (index.items([hunkId])[0]?.risk.riskClass ?? "logic");
    const reviewed = deps.reviewedHunks.has(hunkId);
    const reference = treeRow.kind === "reference";
    return (
      <li key={key}>
        <button
          type="button"
          className={`tree-row${hunkId === selected && !reference ? " selected" : ""}${reference ? " reference" : ""}`}
          style={{
            paddingLeft: `calc(${Math.min(treeRow.depth, MAX_INDENT)} * var(--space-4) + var(--space-2))`,
          }}
          aria-current={hunkId === selected && !reference ? "true" : undefined}
          title={reference ? "Placed above in the tree" : undefined}
          onClick={() => onSelect(hunkId)}
        >
          <span className={`risk-dot risk-${riskClass}`} aria-hidden="true" />
          <span className="tree-label">
            {treeRow.symbol === null ? whereIs(hunkId) : treeRow.symbol}
          </span>{" "}
          <span className="visually-hidden">({riskClass})</span>
          {reference && <span className="tree-note">above</span>}
          {reviewed && !reference && (
            <span className="tree-tick" role="img" aria-label="reviewed">
              ✓
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="tree-layout">
      <nav ref={nav} className="call-tree" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Call tree</h2>
        {tree.rows.length === 0 ? (
          <p className="muted">No changed hunk calls another.</p>
        ) : (
          <ol className="tree-rows">
            {tree.rows.map((treeRow, at) => row(treeRow, `${at}:${treeRow.hunkId}`))}
          </ol>
        )}
        {tree.offPath.length > 0 && (
          <>
            <h3>Not on a call path</h3>
            {tree.offPath.map((group) => (
              <div key={group.path} className="tree-file">
                <p className="tree-path">{group.path}</p>
                <ol className="tree-rows">
                  {group.hunkIds.map((hunkId) => {
                    const found = index.hunks.get(hunkId);
                    return row(
                      {
                        kind: "hunk",
                        hunkId,
                        depth: 0,
                        symbol: found === undefined ? "" : hunkLocation(found.hunk),
                        parent: null,
                      },
                      hunkId,
                    );
                  })}
                </ol>
              </div>
            ))}
          </>
        )}
        {proofs.length > 0 && (
          <>
            <h3>Proved mechanical</h3>
            <ul className="tree-proofs">
              {proofs.map((proof) => (
                <li key={`${proof.path}:${proof.hunkId ?? ""}:${proof.kind}`}>
                  {proof.hunkId === null ? (
                    <span>
                      <code>{proof.path}</code> · {proof.detail}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => proof.hunkId !== null && onSelect(proof.hunkId)}
                    >
                      <code>{proof.path}</code> · {proof.detail}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>

      <section className="main-area tree-main" aria-label="Selected hunk">
        {selected === null ? (
          <p className="muted">There are no changes to review here.</p>
        ) : (
          <>
            <nav className="breadcrumb" aria-label="Call path">
              <ol>
                {crumbs.map((hunkId) => (
                  <li key={hunkId}>
                    {hunkId === selected ? (
                      <code aria-current="location">{labelOf(hunkId)}</code>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onSelect(hunkId)}
                      >
                        <code>{labelOf(hunkId)}</code>
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            {callers.length > 0 && (
              <p className="called-from">
                Called from{" "}
                {callers.map((link, at) => (
                  <span key={`${link.symbol}:${link.hunkId}`}>
                    {at > 0 && ", "}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onSelect(link.hunkId)}
                    >
                      <code>{labelOf(link.hunkId)}</code>
                    </button>
                  </span>
                ))}
              </p>
            )}
            <HunkView
              key={selected}
              id={selected}
              deps={treeDeps}
              belowLine={belowLine}
              focused={focus}
            />
            {next !== undefined && (
              <div className="step-buttons">
                <button type="button" className="button" onClick={() => onSelect(next)}>
                  Next hunk in the tree →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
