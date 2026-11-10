/**
 * How the map groups its files: one list in the call graph's order, or by folder. An experiment to
 * compare against call order; every grouping keeps each file whole, once.
 */
export type Grouping = "calls" | "folders";

export const GROUPINGS: readonly Grouping[] = ["calls", "folders"];

/** Layers, a grouping that was tried and dropped, read as call order. */
export const parseGrouping = (stored: unknown): Grouping | undefined =>
  GROUPINGS.find((grouping) => grouping === stored);

/** A file on the map, in the order the grouping starts from, with its contract parts counted. */
export interface GroupFile {
  readonly path: string;
  readonly contract: number;
}

/** Files grouped under a header: what the map shows as one section. */
export interface FileSection {
  readonly key: string;
  /** Null for the one list of call order, which needs no header. */
  readonly title: string | null;
  readonly detail: string | null;
  readonly paths: readonly string[];
}

/** "3 files · 2 contract", leaving the contract count out when there's none. */
const filesDetail = (files: readonly GroupFile[]): string => {
  const contract = files.reduce((sum, file) => sum + file.contract, 0);
  const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  return contract > 0 ? `${count} · ${contract} contract` : count;
};

/** Call order: one section, no header. */
export const byCalls = (files: readonly GroupFile[]): FileSection[] => [
  { key: "calls", title: null, detail: null, paths: files.map((file) => file.path) },
];

interface Folder {
  readonly path: string;
  readonly files: GroupFile[];
  readonly folders: Map<string, Folder>;
}

const hasContract = (folder: Folder): boolean =>
  folder.files.some((file) => file.contract > 0) || [...folder.folders.values()].some(hasContract);

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The root directory's title. */
export const TOP_LEVEL = "Top level";

/**
 * One section per directory that holds changed files, walking the directory tree depth first.
 * Under each directory, what holds a contract part comes first, then the rest by name: its own
 * files as one item before its folders, and in its section, files with contract parts first.
 */
export const byFolders = (files: readonly GroupFile[]): FileSection[] => {
  const root: Folder = { path: "", files: [], folders: new Map() };
  for (const file of files) {
    const directories = file.path.split("/").slice(0, -1);
    let folder = root;
    for (const name of directories) {
      const path = folder.path === "" ? name : `${folder.path}/${name}`;
      const next = folder.folders.get(name) ?? { path, files: [], folders: new Map() };
      folder.folders.set(name, next);
      folder = next;
    }
    folder.files.push(file);
  }
  const sections: FileSection[] = [];
  const walk = (folder: Folder) => {
    const own = [...folder.files].sort(
      (a, b) => Number(b.contract > 0) - Number(a.contract > 0) || byName(a.path, b.path),
    );
    const ownContract = own.some((file) => file.contract > 0);
    const children = [...folder.folders.entries()]
      .sort(
        ([a, one], [b, other]) =>
          Number(hasContract(other)) - Number(hasContract(one)) || byName(a, b),
      )
      .map(([, child]) => child);
    const section = () => {
      if (own.length === 0) return;
      sections.push({
        key: `folder:${folder.path}`,
        title: folder.path === "" ? TOP_LEVEL : folder.path,
        detail: filesDetail(own),
        paths: own.map((file) => file.path),
      });
    };
    // The directory's own files go before its folders of the same kind: contract, or not.
    if (ownContract) section();
    for (const child of children.filter(hasContract)) walk(child);
    if (!ownContract) section();
    for (const child of children.filter((child) => !hasContract(child))) walk(child);
  };
  walk(root);
  return sections;
};

/** The sections for a grouping. */
export const groupFiles = (grouping: Grouping, files: readonly GroupFile[]): FileSection[] =>
  grouping === "folders" ? byFolders(files) : byCalls(files);
