import {
  fitInPrompt,
  GUIDELINE_PATHS,
  type GuidelineFile,
  GuidelinePath,
  guidelineDuplicates,
  guidelineFile,
  type Harness,
  type HarnessFile,
  type HarnessLinkKind,
  harnessEnabled,
  harnessPlan,
  harnessReach,
  MAX_INLINE_BYTES,
} from "../../domain/review/index.ts";

/** Put in every pass's prompt, or left for a pass to read. */
export type GuidelineUse = "prompt" | "on-request";

/** A file a guideline file reaches. */
export interface LinkedGuidelineFile {
  readonly path: string;
  readonly bytes: number;
  /** The file nearest the guideline file that links it, and how. */
  readonly linkedFrom: string;
  readonly via: HarnessLinkKind;
  /** Its own switch; a guideline file's, whether a run uses it. */
  readonly enabled: boolean;
  /** How a run uses it when the guideline file it's listed under is on; null when it doesn't. */
  readonly use: GuidelineUse | null;
  /** How a run uses it with the switches as they are, which another guideline file can make it. */
  readonly currentUse: GuidelineUse | null;
  /** With the guideline file on, the file a run is given instead, which has the same content. */
  readonly sameAs: string | null;
}

export interface RepositoryGuidelineFile extends GuidelineFile {
  /** Null when it's off, or when it's on and no run can be given it. */
  readonly use: GuidelineUse | null;
  /** The file with the same content a run is given instead. */
  readonly sameAs: string | null;
  /**
   * The files it reaches that no guideline file before it does, and the guideline files it links,
   * nearest first; none while the harness isn't loaded.
   */
  readonly linked: readonly LinkedGuidelineFile[];
  /** How many of the files it reaches each other guideline file lists, in GUIDELINE_PATHS order. */
  readonly listedElsewhere: readonly { readonly path: GuidelinePath; readonly files: number }[];
}

type Switches = ReadonlyMap<string, boolean>;

interface Uses {
  readonly uses: ReadonlyMap<string, GuidelineUse>;
  readonly duplicates: ReadonlyMap<string, string>;
}

const usesOf = (harness: Harness, switches: Switches): Uses => {
  const { inPrompt, onRequest, duplicates } = harnessPlan(harness, switches);
  return {
    uses: new Map([
      ...inPrompt.map(({ path }) => [path, "prompt"] as const),
      ...onRequest.map(({ path }) => [path, "on-request"] as const),
    ]),
    duplicates,
  };
};

const isRoot = (file: HarnessFile): boolean => file.via === "root";

/** What a guideline file reaches without going on through another one, which has its own list. */
const ownReach = (harness: Harness, root: HarnessFile): HarnessFile[] =>
  harnessReach(harness, root.path, (file) => !isRoot(file));

const linkedFilesOf = (
  root: HarnessFile,
  listed: readonly HarnessFile[],
  harness: Harness,
  switches: Switches,
  current: Uses,
): LinkedGuidelineFile[] => {
  const withRootOn = usesOf(harness, new Map(switches).set(root.path, true));
  const linking = new Map<string, Pick<LinkedGuidelineFile, "linkedFrom" | "via">>();
  for (const { path, links } of [root, ...listed.filter((file) => !isRoot(file))]) {
    for (const link of links) {
      if (!linking.has(link.path)) linking.set(link.path, { linkedFrom: path, via: link.kind });
    }
  }
  return listed.flatMap(({ path, bytes, via }) => {
    const link = linking.get(path);
    if (link === undefined) return [];
    const enabled =
      via === "root" ? harnessEnabled(path, harness, switches) : switches.get(path) !== false;
    return [
      {
        path,
        bytes,
        ...link,
        enabled,
        use: withRootOn.uses.get(path) ?? null,
        currentUse: current.uses.get(path) ?? null,
        sameAs: withRootOn.duplicates.get(path) ?? null,
      },
    ];
  });
};

interface Root {
  readonly path: GuidelinePath;
  readonly file: HarnessFile;
}

/**
 * The guideline file each other file is listed under: the first that imports it, straight or
 * through files it imports, since an import is what puts it in every review; else the one whose
 * files reach it first, breadth-first from them all. Never through another guideline file, which
 * lists what it links itself.
 */
const listingOf = (
  harness: Harness,
  roots: readonly Root[],
): ReadonlyMap<string, GuidelinePath> => {
  const byPath = new Map(harness.files.map((file) => [file.path, file]));
  const under = new Map<string, GuidelinePath>();
  for (const { path, file } of roots) {
    const imports = [file];
    for (const importer of imports) {
      for (const link of importer.links) {
        const imported = byPath.get(link.path);
        if (link.kind !== "import" || imported === undefined || isRoot(imported)) continue;
        if (imports.includes(imported)) continue;
        imports.push(imported);
        if (!under.has(imported.path)) under.set(imported.path, path);
      }
    }
  }
  const queue = roots.map(({ path, file }) => ({ file, under: path }));
  const seen = new Set(queue.map(({ file }) => file.path));
  for (const { file, under: from } of queue) {
    for (const link of file.links) {
      const linked = byPath.get(link.path);
      if (linked === undefined || isRoot(linked) || seen.has(linked.path)) continue;
      seen.add(linked.path);
      const listed = under.get(linked.path) ?? from;
      under.set(linked.path, listed);
      queue.push({ file: linked, under: listed });
    }
  }
  return under;
};

/**
 * A harness's guideline files, with what each reaches and how a run uses it. A file two of them
 * reach is listed under one, so it has one row and one switch.
 */
export const guidelineFilesOf = (
  harness: Harness,
  switches: Switches,
): RepositoryGuidelineFile[] => {
  const current = usesOf(harness, switches);
  const roots = harness.files.flatMap((file) => {
    const path = GuidelinePath.safeParse(file.path);
    return path.success ? [{ path: path.data, file }] : [];
  });
  const listedUnder = listingOf(harness, roots);
  return roots.map(({ path, file }) => {
    const listed = ownReach(harness, file).filter(
      (reached) => isRoot(reached) || listedUnder.get(reached.path) === path,
    );
    const elsewhere = new Map<GuidelinePath, number>();
    for (const reached of harnessReach(harness, path)) {
      const under = listedUnder.get(reached.path);
      if (under !== undefined && under !== path) {
        elsewhere.set(under, (elsewhere.get(under) ?? 0) + 1);
      }
    }
    return {
      path,
      bytes: file.bytes,
      enabled: harnessEnabled(file.path, harness, switches),
      tooLarge: file.bytes > MAX_INLINE_BYTES,
      use: current.uses.get(file.path) ?? null,
      sameAs: current.duplicates.get(file.path) ?? null,
      linked: linkedFilesOf(file, listed, harness, switches, current),
      listedElsewhere: GUIDELINE_PATHS.flatMap((other) => {
        const files = elsewhere.get(other);
        return files === undefined ? [] : [{ path: other, files }];
      }),
    };
  });
};

/** The guideline files alone, as a run reads them without a harness: whole in the prompt or not at all. */
export const guidelineFilesAlone = (
  contents: ReadonlyMap<GuidelinePath, string | null>,
  switches: Switches,
): RepositoryGuidelineFile[] => {
  const files = GUIDELINE_PATHS.flatMap((path) => {
    const content = contents.get(path) ?? null;
    return content === null ? [] : [guidelineFile(path, content, switches)];
  });
  const duplicates = guidelineDuplicates(
    files.filter((file) => file.enabled).map(({ path }) => path),
    contents,
  );
  const fitting = new Set(
    fitInPrompt(files.filter((file) => file.enabled && !duplicates.has(file.path))).fitting.map(
      ({ path }) => path,
    ),
  );
  return files.map((file) => ({
    ...file,
    use: fitting.has(file.path) ? "prompt" : null,
    sameAs: duplicates.get(file.path) ?? null,
    linked: [],
    listedElsewhere: [],
  }));
};
