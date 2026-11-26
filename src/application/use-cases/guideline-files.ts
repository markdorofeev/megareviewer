import {
  fitInPrompt,
  GUIDELINE_PATHS,
  type GuidelineFile,
  GuidelinePath,
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
  /** How a run uses it when the guideline file is on; null when it doesn't. */
  readonly use: GuidelineUse | null;
}

export interface RepositoryGuidelineFile extends GuidelineFile {
  /** Null when it's off, or when it's on and no run can be given it. */
  readonly use: GuidelineUse | null;
  /** Nearest first; none while the harness isn't loaded. */
  readonly linked: readonly LinkedGuidelineFile[];
}

type Switches = ReadonlyMap<string, boolean>;

const usesOf = (harness: Harness, switches: Switches): ReadonlyMap<string, GuidelineUse> => {
  const { inPrompt, onRequest } = harnessPlan(harness, switches);
  return new Map([
    ...inPrompt.map(({ path }) => [path, "prompt"] as const),
    ...onRequest.map(({ path }) => [path, "on-request"] as const),
  ]);
};

const linkedFilesOf = (
  root: HarnessFile,
  harness: Harness,
  switches: Switches,
): LinkedGuidelineFile[] => {
  const uses = usesOf(harness, new Map(switches).set(root.path, true));
  const reached = harnessReach(harness, root.path);
  const linking = new Map<string, Pick<LinkedGuidelineFile, "linkedFrom" | "via">>();
  for (const { path, links } of [root, ...reached]) {
    for (const link of links) {
      if (!linking.has(link.path)) linking.set(link.path, { linkedFrom: path, via: link.kind });
    }
  }
  return reached.flatMap(({ path, bytes, via }) => {
    const link = linking.get(path);
    if (link === undefined) return [];
    const enabled =
      via === "root" ? harnessEnabled(path, harness, switches) : switches.get(path) !== false;
    return [{ path, bytes, ...link, enabled, use: uses.get(path) ?? null }];
  });
};

/** A harness's guideline files, with what each reaches and how a run uses it. */
export const guidelineFilesOf = (
  harness: Harness,
  switches: Switches,
): RepositoryGuidelineFile[] => {
  const uses = usesOf(harness, switches);
  return harness.files.flatMap((file) => {
    const path = GuidelinePath.safeParse(file.path);
    if (!path.success) return [];
    return [
      {
        path: path.data,
        bytes: file.bytes,
        enabled: harnessEnabled(file.path, harness, switches),
        tooLarge: file.bytes > MAX_INLINE_BYTES,
        use: uses.get(file.path) ?? null,
        linked: linkedFilesOf(file, harness, switches),
      },
    ];
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
  const fitting = new Set(
    fitInPrompt(files.filter((file) => file.enabled)).fitting.map(({ path }) => path),
  );
  return files.map((file) => ({
    ...file,
    use: fitting.has(file.path) ? "prompt" : null,
    linked: [],
  }));
};
