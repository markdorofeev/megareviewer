import { useEffect, useMemo, useRef, useState } from "react";
import { useShortcuts } from "../../lib/keymap.ts";
import { FILE_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Input } from "../../ui/input.tsx";
import { ScrollArea } from "../../ui/scroll-area.tsx";
import { EmptyState } from "../shell/empty-state.tsx";
import { KeyHint } from "../shell/key-hint.tsx";
import { type FileEntry, type FileOrder, filterFiles, sortFiles } from "./files.ts";
import { fileTree, nameOf, type TreeEntry, treeOrder } from "./paths.ts";
import { ARROWS, type Neighbors, type Relation, relationOf } from "./relations.ts";

export interface FileTreeProps {
  readonly files: readonly FileEntry[];
  readonly activePath: string | null;
  readonly onSelect: (path: string) => void;
  /** Directories as headings, or one flat list. */
  readonly mode?: "tree" | "flat";
  /** For the flat list: by path, or the most changed first. */
  readonly order?: FileOrder;
  /** n and p select the next and previous file, in the order shown. One tree per page has it. */
  readonly navigate?: boolean;
  /**
   * The links between files. With them, the active file's callers and callees carry arrows and
   * the other files are muted, as in the rail beside the code.
   */
  readonly neighbors?: Neighbors;
  readonly className?: string;
}

/** The changed files, filtered with `/`, each with its status, its counts and its contract parts. */
export const FileTree = ({
  files,
  activePath,
  onSelect,
  mode = "tree",
  order = "path",
  navigate = false,
  neighbors,
  className,
}: FileTreeProps) => {
  const nav = useRef<HTMLElement>(null);
  // Keep the active file in sight when the list is longer than its box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the active file changes.
  useEffect(() => {
    const box = nav.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    const row = nav.current?.querySelector<HTMLElement>("[aria-current]");
    if (box === null || box === undefined || row === null || row === undefined) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [activePath]);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const filter = useRef<HTMLInputElement>(null);
  useShortcuts({ filterTree: () => filter.current?.focus() });

  const shown = useMemo(() => filterFiles(files, query), [files, query]);
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const tree = useMemo(
    () =>
      fileTree(
        shown.map((file) => file.path),
        (path) => byPath.get(path)?.contract ?? 0,
      ),
    [shown, byPath],
  );

  const shownOrder = useMemo(
    () => (mode === "tree" ? treeOrder(tree) : sortFiles(shown, order).map((file) => file.path)),
    [mode, tree, shown, order],
  );
  const step = (by: 1 | -1) => {
    const at = activePath === null ? -1 : shownOrder.indexOf(activePath);
    const next = shownOrder[Math.min(shownOrder.length - 1, Math.max(0, at + by))];
    if (next !== undefined) onSelect(next);
  };
  useShortcuts({ nextFile: () => step(1), previousFile: () => step(-1) }, navigate);

  const toggle = (path: string) => {
    const next = new Set(closed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setClosed(next);
  };

  const fileRow = (entry: FileEntry, label: string, depth: number) => (
    <li key={entry.path}>
      <FileRow
        entry={entry}
        label={label}
        depth={depth}
        relation={
          neighbors === undefined
            ? entry.path === activePath
              ? "current"
              : "none"
            : relationOf(entry.path, activePath, neighbors)
        }
        onSelect={onSelect}
      />
    </li>
  );

  const entries = (list: readonly TreeEntry[], depth: number) =>
    list.map((entry) => {
      if (entry.kind === "file") {
        const file = byPath.get(entry.path);
        return file === undefined ? null : fileRow(file, entry.name, depth);
      }
      // A filter opens every directory, so a match is never hidden.
      const open = query.trim() !== "" || !closed.has(entry.path);
      return (
        <li key={entry.path}>
          <button
            type="button"
            title={`${entry.path}/`}
            aria-expanded={open}
            onClick={() => toggle(entry.path)}
            className="flex min-h-6 w-full items-center gap-1 rounded-md pr-2 text-left font-mono text-code-compact text-muted-foreground hover:bg-accent"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            <span
              aria-hidden="true"
              className={cn(
                "w-3 transition-transform duration-(--duration-fast) ease-standard",
                !open && "-rotate-90",
              )}
            >
              ▾
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.contract > 0 && <ContractCount count={entry.contract} />}
          </button>
          {open && <ul>{entries(entry.children, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <nav
      ref={nav}
      aria-label="Changed files"
      className={cn("flex min-h-0 flex-col gap-2", className)}
    >
      <div className="relative px-1">
        <Input
          ref={filter}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          className="h-7 pr-8"
        />
        <KeyHint id="filterTree" className="absolute top-1/2 right-3 -translate-y-1/2" />
      </div>
      <p className="px-2 text-caption text-muted-foreground" aria-live="polite">
        {query.trim() === "" ? `${files.length} files` : `${shown.length} of ${files.length} files`}
      </p>
      {shown.length === 0 ? (
        <EmptyState
          inline
          tone="muted"
          glyph="∅"
          title="No files match"
          body={`Nothing in this PR has “${query.trim()}” in its path.`}
          actions={[{ label: "Clear filter", onClick: () => setQuery("") }]}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-px px-1 pb-2">
            {mode === "tree"
              ? entries(tree, 0)
              : sortFiles(shown, order).map((file) => fileRow(file, file.path, 0))}
          </ul>
        </ScrollArea>
      )}
    </nav>
  );
};

export const ContractCount = ({ count }: { readonly count: number }) => (
  <span className="tabular flex items-center gap-1 text-caption font-medium text-risk-contract">
    <span aria-hidden="true">▲</span>
    {count}
    <span className="sr-only"> contract</span>
  </span>
);

/**
 * A file's row: an arrow saying how it relates to the active file, its name (its directory muted
 * when the row isn't under it), its contract parts, its counts and its status. A click selects it.
 */
export const FileRow = ({
  entry,
  label,
  depth = 0,
  relation = "none",
  directory,
  onSelect,
}: {
  readonly entry: Pick<FileEntry, "path" | "contract"> & Partial<FileEntry>;
  readonly label: string;
  readonly depth?: number;
  readonly relation?: Relation;
  /** Shown muted after the name, for a row outside its directory's heading. */
  readonly directory?: string;
  readonly onSelect: (path: string) => void;
}) => {
  const status = entry.status === undefined ? null : FILE_STATUS[entry.status];
  const arrow = ARROWS[relation];
  const active = relation === "current";
  return (
    <button
      type="button"
      data-relation={relation}
      aria-current={active ? "location" : undefined}
      title={entry.path}
      onClick={() => onSelect(entry.path)}
      className={cn(
        // surface-subtle rather than accent: the modified letter is under 4.5:1 on accent.
        "flex min-h-6 w-full items-center gap-1.5 rounded-md pr-2 text-left hover:bg-surface-subtle",
        active && "bg-surface-subtle font-medium shadow-[inset_3px_0_0_var(--primary)]",
        relation === "other" && "text-muted-foreground",
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <span className="w-3 shrink-0 text-center text-primary">
        {arrow !== null && (
          <>
            <span aria-hidden="true">{arrow.mark}</span>
            <span className="sr-only">{arrow.text}, </span>
          </>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          entry.status === "deleted" && "text-muted-foreground line-through",
        )}
      >
        {label === entry.path ? label : nameOf(entry.path)}
        {directory !== undefined && (
          <span className="ml-1.5 font-mono text-code-compact text-muted-foreground">
            {directory}/
          </span>
        )}
      </span>
      {entry.contract > 0 && <ContractCount count={entry.contract} />}
      {entry.additions !== undefined && entry.deletions !== undefined && (
        <span className="tabular font-mono text-code-compact">
          <span className="text-diff-add-fg">+{entry.additions}</span>{" "}
          <span className="text-diff-del-fg">−{entry.deletions}</span>
        </span>
      )}
      {status !== null && (
        <span
          className={cn("w-3 text-center font-mono text-caption font-semibold", status.className)}
        >
          <span aria-hidden="true">{status.glyph}</span>
          <span className="sr-only">{status.label}</span>
        </span>
      )}
    </button>
  );
};
