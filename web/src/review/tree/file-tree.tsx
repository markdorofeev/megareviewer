import { useMemo, useRef, useState } from "react";
import { useShortcuts } from "../../lib/keymap.ts";
import { FILE_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { fileTree, nameOf, type TreeEntry, treeOrder } from "../../pages/review/tree.ts";
import { Input } from "../../ui/input.tsx";
import { ScrollArea } from "../../ui/scroll-area.tsx";
import { EmptyState } from "../shell/empty-state.tsx";
import { KeyHint } from "../shell/key-hint.tsx";
import { type FileEntry, type FileOrder, filterFiles, sortFiles } from "./files.ts";

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
  className,
}: FileTreeProps) => {
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
        active={entry.path === activePath}
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
    <nav aria-label="Changed files" className={cn("flex min-h-0 flex-col gap-2", className)}>
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

const ContractCount = ({ count }: { readonly count: number }) => (
  <span className="tabular flex items-center gap-1 text-caption font-medium text-risk-contract">
    <span aria-hidden="true">▲</span>
    {count}
    <span className="sr-only"> contract</span>
  </span>
);

const FileRow = ({
  entry,
  label,
  depth,
  active,
  onSelect,
}: {
  readonly entry: FileEntry;
  readonly label: string;
  readonly depth: number;
  readonly active: boolean;
  readonly onSelect: (path: string) => void;
}) => {
  const status = FILE_STATUS[entry.status];
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      title={entry.path}
      onClick={() => onSelect(entry.path)}
      className={cn(
        // surface-subtle rather than accent: the modified letter is under 4.5:1 on accent.
        "flex min-h-6 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-surface-subtle",
        active && "bg-surface-subtle shadow-[inset_3px_0_0_var(--primary)]",
      )}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          entry.status === "deleted" && "text-muted-foreground line-through",
        )}
      >
        {label === entry.path ? label : nameOf(entry.path)}
      </span>
      {entry.contract > 0 && <ContractCount count={entry.contract} />}
      <span className="tabular font-mono text-code-compact">
        <span className="text-diff-add-fg">+{entry.additions}</span>{" "}
        <span className="text-diff-del-fg">−{entry.deletions}</span>
      </span>
      <span
        className={cn("w-3 text-center font-mono text-caption font-semibold", status.className)}
      >
        <span aria-hidden="true">{status.glyph}</span>
        <span className="sr-only">{status.label}</span>
      </span>
    </button>
  );
};
