import { useId, useMemo } from "react";
import { fullSize, type MiniOverview as Mini, miniLabels, miniLists } from "./mini-overview.ts";
import type { OverviewNode } from "./overview.ts";
import { anchors, edgePath, edgeStyle, files, NODE_HEIGHT } from "./overview-layout.ts";
import { FileRow, type Neighbors, relationOf } from "./TreeRail.tsx";
import { directoryOf, nameOf } from "./tree.ts";

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

/** A box's name for a screen reader: what the full overview's box says, shortened. */
const boxName = (node: OverviewNode, label: string, current: boolean): string =>
  [
    label,
    node.kind === "outside" ? "outside the pull request" : files(node.paths.length),
    node.contract > 0 ? `${node.contract} contract` : null,
    current ? "in view in the code" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

/**
 * The overview as a miniature in the rail: the full overview's boxes in their rows and places,
 * scaled to the rail's width, the box holding the file in view outlined. Under it, the directories
 * outside the diagram as chips, then the files of the current directory and the files in other
 * directories that call the file in view or that it calls.
 */
export const MiniOverview = ({
  mini,
  paths,
  current,
  neighbors,
  contractOf,
  onOpen,
  onGo,
}: {
  readonly mini: Mini;
  /** The page's files, in its order. */
  readonly paths: readonly string[];
  /** The path of the file in view, if any. */
  readonly current: string | null;
  readonly neighbors: Neighbors;
  readonly contractOf: (path: string) => number;
  /** Scrolls the code to a box's first file, or to the code a box outside the PR uses. */
  readonly onOpen: (node: OverviewNode) => void;
  readonly onGo: (path: string) => void;
}) => {
  const id = useId();
  const { overview, depth } = mini;
  const { boxes, width, height } = useMemo(() => fullSize(overview), [overview]);
  const ends = useMemo(() => anchors(overview.edges, boxes), [overview.edges, boxes]);
  const labels = useMemo(
    () => miniLabels([...overview.rows.flat(), ...overview.strip]),
    [overview],
  );
  const currentKey = current === null ? null : (overview.placeOf.get(current) ?? null);
  const lists = current === null ? null : miniLists(current, paths, neighbors, depth);

  const row = (path: string, inDirectory: boolean) => (
    <li key={path}>
      <FileRow
        path={path}
        name={nameOf(path)}
        directory={inDirectory ? undefined : directoryOf(path) || "."}
        contract={contractOf(path)}
        relation={relationOf(path, current, neighbors)}
        onGo={onGo}
      />
    </li>
  );
  const section = (title: string, list: readonly string[]) =>
    list.length === 0 ? null : (
      <section className="mini-list" aria-label={title}>
        <h3 className="tree-heading">{title}</h3>
        <ul className="tree-list">{list.map((path) => row(path, false))}</ul>
      </section>
    );

  return (
    <div className="mini-overview">
      <div className="mini-figure">
        {overview.rows.length > 0 ? (
          <section
            className="mini-diagram"
            aria-label="Overview of the changed directories"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            <svg
              className="mini-edges"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={`${id}-arrow`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerUnits="userSpaceOnUse"
                  markerWidth="22"
                  markerHeight="22"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" className="overview-arrow" />
                </marker>
              </defs>
              {overview.edges.map((edge) => {
                const from = boxes.get(edge.from);
                const to = boxes.get(edge.to);
                if (from === undefined || to === undefined) return null;
                return (
                  <path
                    key={`${edge.from}>${edge.to}`}
                    className={`mini-edge ${edgeStyle(edge)}`}
                    d={edgePath(
                      from,
                      to,
                      edge.back,
                      width,
                      ends.out.get(edge),
                      ends.into.get(edge),
                    )}
                    vectorEffect="non-scaling-stroke"
                    markerEnd={`url(#${id}-arrow)`}
                  />
                );
              })}
            </svg>
            {overview.rows.flat().map((node) => {
              const box = boxes.get(node.key);
              if (box === undefined) return null;
              const label = labels.get(node.key) ?? node.label;
              const isCurrent = node.key === currentKey;
              return (
                <button
                  key={node.key}
                  type="button"
                  className={`mini-node ${node.kind === "outside" ? "outside" : `risk-${node.risk}`}${isCurrent ? " current" : ""}`}
                  data-key={node.key}
                  aria-label={boxName(node, label, isCurrent)}
                  aria-current={isCurrent ? "location" : undefined}
                  title={node.label}
                  style={{
                    left: percent(box.x, width),
                    top: percent(box.y, height),
                    width: percent(box.width, width),
                    height: percent(NODE_HEIGHT, height),
                  }}
                  onClick={() => onOpen(node)}
                >
                  {label}
                </button>
              );
            })}
          </section>
        ) : (
          <p className="muted mini-note">No changed directory calls another.</p>
        )}
        {depth !== null && (
          <p className="muted mini-note">
            Directories grouped to {depth} {depth === 1 ? "level" : "levels"} to fit.
          </p>
        )}
        {overview.strip.length > 0 && (
          <ul className="mini-chips" aria-label="Not linked">
            {overview.strip.map((node) => {
              const label = labels.get(node.key) ?? node.label;
              const isCurrent = node.key === currentKey;
              return (
                <li key={node.key}>
                  <button
                    type="button"
                    className={`mini-chip${isCurrent ? " current" : ""}`}
                    data-key={node.key}
                    aria-current={isCurrent ? "location" : undefined}
                    title={node.label}
                    onClick={() => onOpen(node)}
                  >
                    {label} <span className="mini-chip-count">{files(node.paths.length)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {lists !== null && (
        <div className="mini-lists">
          <section className="mini-list" aria-label="This directory">
            <h3 className="tree-heading" title={`${lists.directory || "."}/`}>
              {lists.directory || "."}/
            </h3>
            <ul className="tree-list">{lists.here.map((path) => row(path, true))}</ul>
          </section>
          {section("Called by", lists.calledBy)}
          {section("Calls", lists.calls)}
        </div>
      )}
    </div>
  );
};
