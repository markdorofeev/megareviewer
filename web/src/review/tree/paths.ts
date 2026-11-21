import { type FolderKind, folderKind } from "./file-kind.ts";

// The changed files as a directory tree, for the rail beside the code. Pure, so the overview can
// share its order.

/**
 * A path as the tree shows it. A Java module's sources repeat its name, as in
 * `com.oracle.svm.core/src/com/oracle/svm/core/pgo/`, so the repeat after `src/` is left out:
 * `com.oracle.svm.core/pgo/`.
 */
export const treePath = (path: string): string => {
  const segments = path.split("/");
  for (let at = 0; at < segments.length - 2; at++) {
    const module = segments[at] ?? "";
    if (!module.includes(".") || segments[at + 1] !== "src") continue;
    const parts = module.split(".");
    if (segments.slice(at + 2, at + 2 + parts.length).join(".") !== module) continue;
    if (at + 2 + parts.length >= segments.length) continue;
    segments.splice(at + 1, 1 + parts.length);
    break;
  }
  return segments.join("/");
};

/**
 * Paths as the tree lists them: at each level, directories before files, then by name, ignoring
 * case first. The page shows its file cards in this order too.
 */
export const byTreePath = (a: string, b: string): number => {
  const left = treePath(a).split("/");
  const right = treePath(b).split("/");
  for (let at = 0; at < Math.min(left.length, right.length); at++) {
    const x = left[at] ?? "";
    const y = right[at] ?? "";
    if (x === y) continue;
    const xIsDirectory = at < left.length - 1;
    const yIsDirectory = at < right.length - 1;
    if (xIsDirectory !== yIsDirectory) return xIsDirectory ? -1 : 1;
    const folded = x.toLowerCase().localeCompare(y.toLowerCase(), "en");
    return folded !== 0 ? folded : x < y ? -1 : 1;
  }
  return left.length - right.length;
};

/** A path's directory, "" at the top level. Repository paths are always "/"-separated. */
export const directoryOf = (path: string): string =>
  path.slice(0, Math.max(path.lastIndexOf("/"), 0));

export const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export interface TreeFile {
  readonly kind: "file";
  readonly path: string;
  readonly name: string;
}

export interface TreeDirectory {
  readonly kind: "directory";
  /** Its path as the tree shows it (`treePath`), without a trailing slash. */
  readonly path: string;
  /** Its path below its parent heading: `web/src` for a chain. */
  readonly label: string;
  readonly folder: FolderKind;
  readonly children: readonly TreeEntry[];
}

export type TreeEntry = TreeFile | TreeDirectory;

/** Top-level headings that share the directories they're in, said once in a caption above them. */
export interface TreeGroup {
  readonly kind: "group";
  /** The directories, as the tree shows them, without a trailing slash. */
  readonly path: string;
  /** Each labeled by its path below the group's. */
  readonly children: readonly TreeDirectory[];
}

export type TreeTop = TreeEntry | TreeGroup;

interface Building {
  readonly directories: Map<string, Building>;
  readonly files: string[];
}

/**
 * The files as a tree, in `byTreePath` order: directories before files at each level. A directory
 * with no files and one directory in it is one heading with that directory, so a chain like
 * `web/src` takes one row. At the top, a directory with no files and more than one directory in
 * it is no heading, so it costs no indent on every row under it: two or more headings in a row
 * that start with it are a group with it as their caption, and one alone is labeled by its whole
 * path, as `substratevm/src/com.oracle.svm.core`.
 */
export const fileTree = (paths: readonly string[]): readonly TreeTop[] => {
  const root: Building = { directories: new Map(), files: [] };
  for (const path of paths) {
    let at = root;
    for (const segment of treePath(path).split("/").slice(0, -1)) {
      const next = at.directories.get(segment) ?? { directories: new Map(), files: [] };
      at.directories.set(segment, next);
      at = next;
    }
    at.files.push(path);
  }
  const directory = (segment: string, child: Building, parent: string, prefix: string) => {
    let label = segment;
    let inner = child;
    let path = parent === "" ? segment : `${parent}/${segment}`;
    for (
      let [only] = inner.directories;
      inner.files.length === 0 && inner.directories.size === 1 && only !== undefined;
      [only] = inner.directories
    ) {
      label = `${label}/${only[0]}`;
      path = `${path}/${only[0]}`;
      inner = only[1];
    }
    return { label: `${prefix}${label}`, path, inner };
  };
  const heading = (label: string, path: string, inner: Building): TreeDirectory => ({
    kind: "directory",
    path,
    label,
    folder: folderKind(path, paths),
    children: entries(inner, path),
  });
  const sorted = (list: TreeEntry[]): TreeEntry[] =>
    list.sort((a, b) =>
      byTreePath(
        a.kind === "file" ? a.path : `${a.path}/x`,
        b.kind === "file" ? b.path : `${b.path}/x`,
      ),
    );
  const entries = (node: Building, parent: string): TreeEntry[] =>
    sorted([
      ...[...node.directories].map(([segment, child]) => {
        const { label, path, inner } = directory(segment, child, parent, "");
        return heading(label, path, inner);
      }),
      ...node.files.map((path): TreeFile => ({ kind: "file", path, name: nameOf(path) })),
    ]);
  // Each top-level heading with the directories before it that are no heading, as `a/b/`.
  const hoisted = (
    node: Building,
    parent: string,
    prefix: string,
  ): { readonly prefix: string; readonly heading: TreeDirectory }[] =>
    [...node.directories].flatMap(([segment, child]) => {
      const { label, path, inner } = directory(segment, child, parent, prefix);
      // A dotted directory is a module, which keeps its heading.
      const own = label.slice(prefix.length);
      return inner.files.length === 0 && inner.directories.size > 1 && !own.includes(".")
        ? hoisted(inner, path, `${label}/`)
        : [{ prefix, heading: heading(label, path, inner) }];
    });
  const headings = hoisted(root, "", "").sort((a, b) =>
    byTreePath(`${a.heading.path}/x`, `${b.heading.path}/x`),
  );
  const top: TreeTop[] = [];
  for (let at = 0; at < headings.length; ) {
    const prefix = headings[at]?.prefix ?? "";
    let end = at + 1;
    while (prefix !== "" && headings[end]?.heading.path.startsWith(prefix)) end++;
    const run = headings.slice(at, end).map(({ heading }) => heading);
    top.push(
      ...(run.length < 2
        ? run
        : [
            {
              kind: "group" as const,
              path: prefix.slice(0, -1),
              children: run.map((one) => ({ ...one, label: one.path.slice(prefix.length) })),
            },
          ]),
    );
    at = end;
  }
  return [
    ...top,
    ...sorted(root.files.map((path): TreeFile => ({ kind: "file", path, name: nameOf(path) }))),
  ];
};

/** The tree's files in its order, which is the order the page shows them. */
export const treeOrder = (tree: readonly TreeTop[]): string[] =>
  tree.flatMap((entry) => (entry.kind === "file" ? [entry.path] : treeOrder(entry.children)));
