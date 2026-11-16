// The changed files as a directory tree, for the rail beside the code. Pure, and it imports nothing,
// so the overview can share its order.

/**
 * Paths as a directory tree lists them: at each level, directories before files, then by name,
 * ignoring case first.
 */
export const byTreePath = (a: string, b: string): number => {
  const left = a.split("/");
  const right = b.split("/");
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
  /**
   * The directories between the heading it's under and the file, with a trailing slash, for a
   * directory that holds only this file: its row stands for it rather than a heading of its own.
   */
  readonly directory?: string;
}

export interface TreeDirectory {
  readonly kind: "directory";
  /** The full path, without a trailing slash. */
  readonly path: string;
  /** Its path below its parent heading, with a trailing slash: `web/src/` for a chain. */
  readonly label: string;
  readonly children: readonly TreeEntry[];
}

export type TreeEntry = TreeFile | TreeDirectory;

interface Building {
  readonly directories: Map<string, Building>;
  readonly files: string[];
}

/**
 * The files as a tree, in `byTreePath` order: directories before files at each level. A directory
 * with no files and one directory in it is one heading with that directory, so a chain like
 * `web/src/` takes one row, and a directory that holds only one file is no heading at all: the
 * file's row names it, as `routes/setup.tsx`. Top-level files sit at the root, after its
 * directories.
 */
export const fileTree = (paths: readonly string[]): readonly TreeEntry[] => {
  const root: Building = { directories: new Map(), files: [] };
  for (const path of paths) {
    let at = root;
    for (const segment of path.split("/").slice(0, -1)) {
      const next = at.directories.get(segment) ?? { directories: new Map(), files: [] };
      at.directories.set(segment, next);
      at = next;
    }
    at.files.push(path);
  }
  const entries = (node: Building, parent: string): TreeEntry[] => {
    const directories = [...node.directories].map(([segment, child]): TreeEntry => {
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
      const [lone] = inner.files;
      if (lone !== undefined && inner.files.length === 1 && inner.directories.size === 0) {
        return { kind: "file", path: lone, name: nameOf(lone), directory: `${label}/` };
      }
      return { kind: "directory", path, label: `${label}/`, children: entries(inner, path) };
    });
    const files = node.files.map((path): TreeFile => ({ kind: "file", path, name: nameOf(path) }));
    // A file that stands for its directory keeps the directory's place.
    const place = (entry: TreeEntry) => (entry.kind === "file" ? entry.path : `${entry.path}/x`);
    return [
      ...directories.sort((a, b) => byTreePath(place(a), place(b))),
      ...files.sort((a, b) => byTreePath(a.path, b.path)),
    ];
  };
  return entries(root, "");
};

/**
 * The directory every file is in, when there's one, and the tree below it: shown once above the
 * tree rather than as a heading every row is indented under.
 */
export const treeRoot = (
  tree: readonly TreeEntry[],
): { readonly root: string | null; readonly entries: readonly TreeEntry[] } => {
  const [only] = tree;
  return tree.length === 1 && only?.kind === "directory"
    ? { root: only.label, entries: only.children }
    : { root: null, entries: tree };
};

/** The tree's files in its order, which is the order the page shows them. */
export const treeOrder = (tree: readonly TreeEntry[]): string[] =>
  tree.flatMap((entry) => (entry.kind === "file" ? [entry.path] : treeOrder(entry.children)));
