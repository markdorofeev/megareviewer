import { useEffect, useRef } from "react";
import type { TreeEntry } from "./tree.ts";

/** "3 contract" after a red dot, when there are any. */
const ContractCount = ({ count }: { readonly count: number }) =>
  count === 0 ? null : (
    <span className="tree-contract">
      <span className="tree-contract-dot" aria-hidden="true" />
      {count}
      <span className="visually-hidden"> contract</span>
    </span>
  );

/** How a file relates to the file in view. */
export type Relation = "current" | "caller" | "callee" | "both" | "other" | "none";

const ARROWS: Readonly<Record<Relation, { readonly mark: string; readonly text: string } | null>> =
  {
    caller: { mark: "↑", text: "calls the file in view" },
    callee: { mark: "↓", text: "called by the file in view" },
    both: { mark: "↕", text: "calls and is called by the file in view" },
    current: null,
    other: null,
    none: null,
  };

/** For each file, the files it links to: the links the overview draws. */
export type Neighbors = ReadonlyMap<string, ReadonlySet<string>>;

export const relationOf = (
  path: string,
  current: string | null,
  neighbors: Neighbors,
): Relation => {
  if (current === null) return "none";
  if (path === current) return "current";
  const calls = neighbors.get(path)?.has(current) === true;
  const called = neighbors.get(current)?.has(path) === true;
  return calls && called ? "both" : calls ? "caller" : called ? "callee" : "other";
};

/**
 * A file's row: an arrow saying how it relates to the file in view, its name, its directory when
 * the row isn't under it, and its contract parts. A click scrolls to its card.
 */
export const FileRow = ({
  path,
  name,
  directory,
  contract,
  relation,
  onGo,
}: {
  readonly path: string;
  readonly name: string;
  /** Shown muted after the name, for a row outside its directory's heading. */
  readonly directory?: string;
  readonly contract: number;
  readonly relation: Relation;
  readonly onGo: (path: string) => void;
}) => {
  const arrow = ARROWS[relation];
  return (
    <button
      type="button"
      className={`tree-file ${relation}`}
      aria-current={relation === "current" ? "location" : undefined}
      title={path}
      onClick={() => onGo(path)}
    >
      <span className="tree-arrow">
        {arrow !== null && (
          <>
            <span aria-hidden="true">{arrow.mark}</span>
            <span className="visually-hidden">{arrow.text}, </span>
          </>
        )}
      </span>
      <span className="tree-file-name">{name}</span>
      {directory !== undefined && <span className="tree-file-directory">{directory}/</span>}
      <ContractCount count={contract} />
    </button>
  );
};

/**
 * The changed files as a directory tree beside the code: directories as headings with the contract
 * parts under them, a row per file with its own. The file in view is highlighted, the files it calls
 * and those that call it carry arrows, and the rest are muted. A click scrolls to the file's card.
 */
export const TreeRail = ({
  tree,
  current,
  neighbors,
  onGo,
}: {
  readonly tree: readonly TreeEntry[];
  /** The path of the file in view, if any. */
  readonly current: string | null;
  readonly neighbors: Neighbors;
  readonly onGo: (path: string) => void;
}) => {
  const nav = useRef<HTMLElement>(null);

  // Keep the file in view in sight when the tree is longer than the rail.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the file in view changes.
  useEffect(() => {
    const box = nav.current?.closest<HTMLElement>(".tree-rail");
    const row = nav.current?.querySelector<HTMLElement>(".tree-file.current");
    if (box === null || box === undefined || row === null || row === undefined) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [current]);

  const list = (entries: readonly TreeEntry[]) => (
    <ul className="tree-list">
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <li key={`${entry.path}/`} className="tree-directory">
            <div className="tree-heading" title={`${entry.path}/`}>
              <span className="tree-heading-label">{entry.label}</span>
              <ContractCount count={entry.contract} />
            </div>
            {list(entry.children)}
          </li>
        ) : (
          <li key={entry.path}>
            <FileRow
              path={entry.path}
              name={entry.name}
              contract={entry.contract}
              relation={relationOf(entry.path, current, neighbors)}
              onGo={onGo}
            />
          </li>
        ),
      )}
    </ul>
  );

  return (
    <nav ref={nav} className="tree-nav" aria-label="Changed files">
      {list(tree)}
    </nav>
  );
};
