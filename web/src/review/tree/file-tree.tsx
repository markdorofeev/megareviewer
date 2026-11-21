import { ChevronRightIcon, MessageSquare, SearchIcon } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShortcuts } from "../../lib/keymap.ts";
import { cn, cssVars } from "../../lib/utils.ts";
import { Input } from "../../ui/input.tsx";
import { ScrollArea } from "../../ui/scroll-area.tsx";
import { FileIcon, FolderIcon } from "./file-icon.tsx";
import { fileKind } from "./file-kind.ts";
import { type FileEntry, filterFiles } from "./files.ts";
import { shortenName, shortenPath, splitName } from "./names.ts";
import { directoryOf, fileTree, nameOf, type TreeTop, treeOrder, treePath } from "./paths.ts";

export interface FileTreeProps {
  readonly files: readonly FileEntry[];
  readonly activePath: string | null;
  readonly onSelect: (path: string) => void;
  /** n and p select the next and previous file, in the order shown. One tree per page has it. */
  readonly navigate?: boolean;
  readonly className?: string;
}

type Show = "all" | "finding" | "risk";

type Row = (
  | {
      readonly kind: "directory";
      readonly key: string;
      readonly label: string;
      readonly entry: Extract<TreeTop, { kind: "directory" }>;
      readonly open: boolean;
      readonly count: number;
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly file: FileEntry;
    }
) & {
  readonly depth: number;
  /** The caption of the group it's in, which indents it a level, or null. */
  readonly group: string | null;
};

const STATUS_WORD = {
  added: "new file",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const renamedFrom = (file: FileEntry): string | null =>
  file.status === "renamed" ? (file.oldPath ?? null) : null;

/** What a row says to a screen reader: everything its marks show, in words. */
const spoken = (file: FileEntry): string => {
  const { finding = 0, risk = 0 } = file.points ?? {};
  const old = renamedFrom(file);
  const from = old === null ? "" : ` from ${old}`;
  return [
    nameOf(file.path),
    `${fileKind(file.path, file.status).label}, ${STATUS_WORD[file.status]}${from}`,
    file.additions > 0 ? `${plural(file.additions, "line")} added` : "",
    file.deletions > 0 ? `${plural(file.deletions, "line")} removed` : "",
    (file.threads ?? 0) > 0 ? plural(file.threads ?? 0, "open thread") : "",
    finding > 0 ? plural(finding, "finding") : "",
    risk > 0 ? plural(risk, "risk") : "",
    directoryOf(file.path) === "" ? "" : `in ${directoryOf(file.path)}`,
  ]
    .filter(Boolean)
    .join(", ");
};

const tooltip = (file: FileEntry): string => {
  const word = STATUS_WORD[file.status];
  const old = renamedFrom(file);
  const was = old === null ? "" : ` · was ${nameOf(old)}`;
  return `${file.path}\n${word[0]?.toUpperCase()}${word.slice(1)}${was}`;
};

/** The changed files: filtered with `/` or by Claude's points, each with its status and counts. */
export const FileTree = ({
  files,
  activePath,
  onSelect,
  navigate = false,
  className,
}: FileTreeProps) => {
  const nav = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  // When the file in view changes, open the directories down to it, so its row is drawn and
  // highlighted. Done while rendering rather than in an effect, so the row exists by the time
  // the effect below scrolls to it. Only on a change: the reviewer can still close the
  // directory they're reading in, and it stays closed until another file comes into view.
  const [openedFor, setOpenedFor] = useState(activePath);
  if (openedFor !== activePath) {
    setOpenedFor(activePath);
    const at = activePath === null ? null : treePath(activePath);
    const shut = [...closed].filter((dir) => at?.startsWith(`${dir}/`));
    if (shut.length > 0) setClosed(new Set([...closed].filter((dir) => !shut.includes(dir))));
  }
  useShortcuts({ filterTree: () => filter.current?.focus() });

  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const tree = useMemo(() => fileTree(files.map((file) => file.path)), [files]);
  const withFindings = files.filter((file) => (file.points?.finding ?? 0) > 0).length;
  const withRisks = files.filter((file) => (file.points?.risk ?? 0) > 0).length;
  const visible = useMemo(() => {
    const matched = new Set(filterFiles(files, query).map((file) => file.path));
    return new Set(
      files
        .filter((file) => matched.has(file.path))
        .filter((file) => show === "all" || (file.points?.[show] ?? 0) > 0)
        .map((file) => file.path),
    );
  }, [files, query, show]);
  const filtering = query.trim() !== "";

  const rows = useMemo(() => {
    const out: Row[] = [];
    const shownIn = (entry: TreeTop): number =>
      entry.kind === "file"
        ? Number(visible.has(entry.path))
        : entry.children.reduce((sum, child) => sum + shownIn(child), 0);
    const walk = (entries: readonly TreeTop[], depth: number, group: string | null) => {
      for (const entry of entries) {
        if (entry.kind === "group") {
          walk(entry.children, depth, entry.path);
          continue;
        }
        if (entry.kind === "file") {
          const file = byPath.get(entry.path);
          if (file !== undefined && visible.has(file.path))
            out.push({ kind: "file", key: file.path, file, depth, group });
          continue;
        }
        const count = shownIn(entry);
        if (count === 0) continue;
        // A filter opens every directory, so a match is never hidden.
        const open = filtering || !closed.has(entry.path);
        out.push({
          kind: "directory",
          key: `${entry.path}/`,
          label: entry.label,
          entry,
          depth,
          group,
          open,
          count,
        });
        if (open) walk(entry.children, depth + 1, group);
      }
    };
    walk(tree, 0, null);
    return out;
  }, [tree, byPath, visible, closed, filtering]);
  // Runs of rows in one group, or in none, for the groups' captions.
  const runs = useMemo(
    () =>
      rows.reduce<{ readonly group: string | null; readonly rows: Row[] }[]>((all, row) => {
        const last = all.at(-1);
        if (last !== undefined && last.group === row.group) last.rows.push(row);
        else all.push({ group: row.group, rows: [row] });
        return all;
      }, []),
    [rows],
  );

  const order = useMemo(() => treeOrder(tree).filter((path) => visible.has(path)), [tree, visible]);
  // Landing, the marks drop in row by row from the top: each marked row's place among them.
  const marked = useMemo(() => {
    const paths = order.filter((path) => {
      const { finding = 0, risk = 0 } = byPath.get(path)?.points ?? {};
      return finding + risk > 0;
    });
    return new Map(paths.map((path, at) => [path, at]));
  }, [order, byPath]);
  const step = (by: 1 | -1) => {
    const at = activePath === null ? -1 : order.indexOf(activePath);
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next !== undefined) onSelect(next);
  };
  useShortcuts({ nextFile: () => step(1), previousFile: () => step(-1) }, navigate);

  // Keep the active file in sight when the list is longer than its box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the active file changes.
  useEffect(() => {
    const box = nav.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    const row = list.current?.querySelector<HTMLElement>("[aria-selected=true]");
    if (box === null || box === undefined || row === null || row === undefined) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [activePath]);

  // One row is a Tab stop: the one last moved to, else the file in view, else the first.
  const tabbable =
    rows.find((row) => row.key === focused)?.key ??
    rows.find((row) => row.kind === "file" && row.file.path === activePath)?.key ??
    rows[0]?.key;

  const focusRow = (key: string | undefined) => {
    if (key === undefined) return;
    setFocused(key);
    list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };
  const toggle = (path: string) => {
    const next = new Set(closed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setClosed(next);
  };
  const act = (row: Row) => {
    setFocused(row.key);
    if (row.kind === "file") onSelect(row.file.path);
    else if (!filtering) toggle(row.entry.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = rows.findIndex((row) => row.key === (event.target as HTMLElement).dataset.key);
    const row = rows[at];
    if (row === undefined) return;
    const go = (index: number) => {
      event.preventDefault();
      focusRow(rows[Math.min(rows.length - 1, Math.max(0, index))]?.key);
    };
    switch (event.key) {
      case "ArrowDown":
        return go(at + 1);
      case "ArrowUp":
        if (at === 0) {
          event.preventDefault();
          filter.current?.focus();
          return;
        }
        return go(at - 1);
      case "Home":
        return go(0);
      case "End":
        return go(rows.length - 1);
      case "Enter":
      case " ":
        event.preventDefault();
        return act(row);
      case "ArrowRight":
        if (row.kind === "directory" && !row.open) {
          event.preventDefault();
          toggle(row.entry.path);
        }
        return;
      case "ArrowLeft": {
        if (row.kind === "directory" && row.open && !filtering) {
          event.preventDefault();
          toggle(row.entry.path);
          return;
        }
        const parent = rows.slice(0, at).findLastIndex((one) => one.depth < row.depth);
        if (parent >= 0) go(parent);
        return;
      }
    }
  };

  const clear = () => {
    setQuery("");
    setShow("all");
  };

  return (
    <nav ref={nav} aria-label="Changed files" className={cn("flex min-h-0 flex-col", className)}>
      <div className="px-2.5 pt-2.5 pb-1">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={filter}
            type="text"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setQuery("");
                event.currentTarget.blur();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                focusRow(tabbable);
              }
            }}
            placeholder="Filter files"
            aria-label="Filter files by name or path"
            className="h-7.5 pl-7"
          />
        </div>
        <div className="mt-1 flex h-7 items-center justify-between text-caption text-muted-foreground">
          <span className="tabular" aria-live="polite">
            {visible.size === files.length
              ? `${files.length} files`
              : `${visible.size} of ${files.length} files`}
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: a toggle group, as the design has it. */}
          <div role="group" aria-label="Show" className="flex gap-px">
            {(
              [
                ["all", "All"],
                ["finding", `Findings ${withFindings}`],
                ["risk", `Risks ${withRisks}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={show === value}
                onClick={() => setShow(value)}
                className={cn(
                  "tabular rounded-sm px-1.5 py-0.5 text-caption hover:text-foreground",
                  show === value && "bg-secondary font-medium text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="border-t px-3 py-4 text-caption text-muted-foreground">
          No files match.{" "}
          <button type="button" onClick={clear} className="text-primary underline">
            Clear filter
          </button>
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1 border-t">
          <div
            ref={list}
            role="tree"
            aria-label="Changed files"
            onKeyDown={onKeyDown}
            className="pt-1 pb-4"
          >
            {runs.map((run) => {
              const drawn = run.rows.map((row) =>
                row.kind === "directory" ? (
                  <DirectoryRow
                    key={row.key}
                    row={row}
                    tabbable={row.key === tabbable}
                    onActivate={() => act(row)}
                  />
                ) : (
                  <FileRow
                    key={row.key}
                    file={row.file}
                    depth={row.depth}
                    inset={row.group !== null}
                    active={row.file.path === activePath}
                    tabbable={row.key === tabbable}
                    onActivate={() => act(row)}
                    {...(marked.has(row.file.path)
                      ? { landing: { at: marked.get(row.file.path) ?? 0, of: marked.size } }
                      : {})}
                  />
                ),
              );
              const key = run.rows[0]?.key ?? "";
              return run.group === null ? (
                <Fragment key={key}>{drawn}</Fragment>
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: a group of a tree's items, as ARIA has it.
                <div key={key} role="group" aria-label={`${run.group}/`}>
                  <GroupCaption path={run.group} />
                  {drawn}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </nav>
  );
};

const ROW =
  "relative flex h-7 cursor-default items-center whitespace-nowrap pr-[7px] select-none hover:bg-surface-row focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/** Each level's indent, and one more in a group. */
const indent = (depth: number, inset = false) => ({
  paddingLeft: `${6 + (depth + Number(inset)) * 9}px`,
});

/** The directories a group's headings are in, said once above them. */
const GroupCaption = ({ path }: { readonly path: string }) => (
  <div
    aria-hidden="true"
    title={path}
    className="flex h-6 items-end pr-[7px] pb-0.5 whitespace-nowrap select-none"
    style={indent(0)}
  >
    <PathLabel path={path} caption />
  </div>
);

const DirectoryRow = ({
  row,
  tabbable,
  onActivate,
}: {
  readonly row: Extract<Row, { kind: "directory" }>;
  readonly tabbable: boolean;
  readonly onActivate: () => void;
}) => (
  // biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles the keys of all its rows.
  <div
    role="treeitem"
    aria-level={row.depth + 1}
    aria-expanded={row.open}
    aria-label={`${row.entry.path}, folder, ${plural(row.count, "file")}`}
    title={row.entry.path}
    data-key={row.key}
    tabIndex={tabbable ? 0 : -1}
    onClick={onActivate}
    className={cn(ROW, "gap-[5px]")}
    style={indent(row.depth, row.group !== null)}
  >
    <ChevronRightIcon
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-standard",
        row.open && "rotate-90",
      )}
    />
    <span className="mr-px">
      <FolderIcon kind={row.entry.folder} />
    </span>
    <PathLabel path={row.label} />
    {!row.open && (
      <span className="tabular font-mono text-kbd leading-none text-muted-foreground">
        {row.count}
      </span>
    )}
  </div>
);

/** The name's color by status, the extension's a muted mix of it. */
const NAME_TONE = {
  added: ["text-diff-add-fg", "text-file-ext-add"],
  deleted: [
    "text-diff-del-fg line-through decoration-1",
    "text-file-ext-del line-through decoration-1",
  ],
  modified: ["", "text-muted-foreground"],
  renamed: ["", "text-muted-foreground"],
} as const;

let measuring: CanvasRenderingContext2D | null | undefined;

const widthOf = (element: Element, text: string): number | null => {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (measuring === null) return null;
  const style = getComputedStyle(element);
  measuring.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  measuring.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  return measuring.measureText(text).width;
};

/** Measures now, once the fonts are in, and whenever the element's width changes. */
const observeWidth = (element: HTMLElement, measure: () => void) => {
  measure();
  void document.fonts?.ready.then(measure);
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => observer.disconnect();
};

/**
 * A directory path, muted but its last directory, shortened in the middle to fit the row. A
 * caption is muted throughout and ends with a slash, since what it names goes on under it.
 */
const PathLabel = ({
  path,
  caption = false,
}: {
  readonly path: string;
  readonly caption?: boolean;
}) => {
  const box = useRef<HTMLSpanElement>(null);
  const suffix = caption ? "/" : "";
  const [shown, setShown] = useState(path);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    return observeWidth(element, () => {
      const width = element.clientWidth;
      const head = element.firstElementChild;
      const tail = element.lastElementChild;
      if (width === 0 || head === null || tail === null) return;
      setShown(
        shortenPath(path, (text) => {
          const cut = text.lastIndexOf("/") + 1;
          const parts = [
            widthOf(head, text.slice(0, cut)),
            widthOf(tail, text.slice(cut) + suffix),
          ];
          return (parts[0] ?? 0) + (parts[1] ?? 0) <= width + 0.5;
        }),
      );
    });
  }, [path, suffix]);
  const cut = shown.lastIndexOf("/") + 1;
  return (
    <span ref={box} className="min-w-0 flex-1 basis-0 truncate text-caption text-muted-foreground">
      <span>{shown.slice(0, cut)}</span>
      <span className={caption ? undefined : "font-medium text-foreground"}>
        {shown.slice(cut)}
        {suffix}
      </span>
    </span>
  );
};

/** A file's name, its stem shortened in the middle to fit the row, and its extension. */
const FileName = ({ file }: { readonly file: FileEntry }) => {
  const box = useRef<HTMLSpanElement>(null);
  const [stem, extension] = splitName(nameOf(file.path));
  const [shown, setShown] = useState(stem);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    return observeWidth(element, () => {
      const width = element.clientWidth;
      const stemPart = element.firstElementChild;
      const extensionPart = element.lastElementChild;
      if (width === 0 || stemPart === null || extensionPart === null) return;
      const extensionWidth = widthOf(extensionPart, extension);
      if (extensionWidth === null) return;
      setShown(
        shortenName(stem, (text) => (widthOf(stemPart, text) ?? 0) + extensionWidth <= width + 0.5),
      );
    });
  }, [stem, extension]);
  const [stemTone, extensionTone] = NAME_TONE[file.status];
  return (
    <span
      ref={box}
      data-slot="file-name"
      className="min-w-0 flex-1 basis-0 truncate text-ui font-[450] tracking-[-0.012em]"
    >
      <span data-slot="file-stem" className={stemTone}>
        {shown}
      </span>
      <span data-slot="file-extension" className={cn("font-normal", extensionTone)}>
        {extension}
      </span>
    </span>
  );
};

/**
 * A file's row: its type's icon, its name colored by its status, and its marks: open threads,
 * Claude's findings and risks, and its changed lines. A click selects it.
 */
const FileRow = ({
  file,
  depth,
  inset,
  active,
  tabbable,
  landing,
  onActivate,
}: {
  readonly file: FileEntry;
  readonly depth: number;
  readonly inset: boolean;
  readonly active: boolean;
  readonly tabbable: boolean;
  /** The row's place among the rows with points, for their landing. */
  readonly landing?: { readonly at: number; readonly of: number };
  readonly onActivate: () => void;
}) => {
  const { finding = 0, risk = 0 } = file.points ?? {};
  const threads = file.threads ?? 0;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles the keys of all its rows.
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={active}
      aria-label={spoken(file)}
      title={tooltip(file)}
      data-key={file.path}
      data-status={file.status}
      tabIndex={tabbable ? 0 : -1}
      onClick={onActivate}
      className={cn(
        ROW,
        "gap-1.5",
        active &&
          "bg-diff-hunk-bg before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary hover:bg-diff-hunk-bg",
      )}
      style={indent(depth, inset)}
    >
      <FileIcon path={file.path} status={file.status} />
      <FileName file={file} />
      <span
        aria-hidden="true"
        className="tabular flex flex-none items-center gap-1.5 font-mono text-kbd leading-none tracking-[-0.02em] text-muted-foreground"
      >
        {threads > 0 && (
          <span data-slot="thread-count" className="inline-flex items-center gap-[2.5px]">
            <MessageSquare className="size-3" strokeWidth={1.75} />
            {threads}
          </span>
        )}
        {finding + risk > 0 && (
          <span
            data-land="drop"
            style={cssVars({ "--landing-i": landing?.at ?? 0, "--landing-n": landing?.of ?? 1 })}
            className="inline-flex items-center gap-1.5"
          >
            {finding > 0 && (
              <span
                data-slot="point-count"
                data-kind="finding"
                className="inline-flex items-center gap-[2.5px]"
              >
                <i className="size-1.5 rounded-full bg-severity-minor" />
                {finding > 1 && finding}
              </span>
            )}
            {risk > 0 && (
              <span data-slot="point-count" data-kind="risk" className="inline-flex items-center">
                <i className="size-[7px] rounded-full ring-[1.5px] ring-risk-logic ring-inset" />
              </span>
            )}
          </span>
        )}
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="inline-flex items-center gap-[5px]">
            {file.additions > 0 && <span className="text-stat-add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-stat-del">−{file.deletions}</span>}
          </span>
        )}
      </span>
    </div>
  );
};

/** A file's unresolved review threads: a speech bubble and a count, said in words to readers. */
export const ThreadCount = ({ count }: { readonly count: number }) => (
  <span data-slot="thread-count" className="tabular inline-flex items-center gap-0.5 text-caption">
    <MessageSquare aria-hidden="true" className="size-3" />
    {count}
    <span className="sr-only"> open {count === 1 ? "thread" : "threads"}</span>
  </span>
);
