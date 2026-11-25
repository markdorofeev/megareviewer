import {
  checkConfigPathsFor,
  checkConfigsOf,
  type FoundCheckConfigs,
  fitInPrompt,
  GUIDELINE_PATHS,
  type Guidance,
  type GuidelinePath,
  guidanceOf,
  guidelineEnabled,
  type HarnessSkipReason,
  harnessLinks,
  harnessPlan,
  MAX_INLINE_BYTES,
  type PullRequest,
  preferencesFor,
  type RepoRef,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { InputGuidance } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { fromHostError, type UseCaseError } from "./errors.ts";
import { type LoadedHarness, loadHarness } from "./harness.ts";
import { hostFor } from "./hosts.ts";

/** As Collect does, a file over 1 MB isn't kept. */
const MAX_CACHED_BYTES = 1024 * 1024;

const utf8 = new TextEncoder();

/**
 * Files at a repository's root at a commit, guideline files and check configs, by path, null for
 * one that isn't there: from the file cache, and the rest from the host in one request, which then
 * go into the cache.
 */
export const readRootFiles = async <P extends string>(
  deps: Pick<AppDeps, "fileCache" | "hosts">,
  repo: RepoRef,
  sha: string,
  paths: readonly P[],
): Promise<Result<ReadonlyMap<P, string | null>, UseCaseError>> => {
  const contents = new Map<P, string | null>();
  const missing: P[] = [];
  for (const path of paths) {
    const cached = await deps.fileCache.get(repo, { sha, path });
    if (cached === null) missing.push(path);
    else contents.set(path, cached.content);
  }
  if (missing.length === 0) return ok(contents);
  const host = hostFor(deps, repo.host);
  if (!host.ok) return host;
  const fetched = await host.value.getFiles(
    repo,
    missing.map((path) => ({ sha, path })),
  );
  if (!fetched.ok) return err(fromHostError(fetched.error));
  for (const [index, path] of missing.entries()) {
    const content = fetched.value[index] ?? null;
    contents.set(path, content);
    if (content === null || utf8.encode(content).byteLength <= MAX_CACHED_BYTES) {
      await deps.fileCache.put(repo, { sha, path }, content);
    }
  }
  return ok(contents);
};

/** The linter and type-checker configs at a repository's root, for the tools of the changed files. */
export const readCheckConfigs = async (
  deps: Pick<AppDeps, "fileCache" | "hosts">,
  repo: RepoRef,
  sha: string,
  changedPaths: readonly string[],
): Promise<Result<FoundCheckConfigs, UseCaseError>> => {
  const read = await readRootFiles(deps, repo, sha, checkConfigPathsFor(changedPaths));
  return read.ok ? ok(checkConfigsOf(read.value)) : read;
};

interface GuidelineToSend {
  readonly path: string;
  readonly bytes: number;
  readonly content: string;
  readonly linkedFrom: string | null;
}

interface Guidelines {
  readonly sent: readonly GuidelineToSend[];
  readonly warnings: readonly string[];
}

const kilobytes = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB`;

const doesntFit = ({ path, bytes }: { readonly path: string; readonly bytes: number }): string =>
  `${path} is ${kilobytes(bytes)} and didn't fit in the ${kilobytes(MAX_INLINE_BYTES)} they can add up to`;

const SKIPPED: Readonly<Record<HarnessSkipReason, string>> = {
  "too-large": "is over 1 MB",
  unreadable: "couldn't be read as text",
};

const leftOutWarning = (reasons: readonly string[]): string[] =>
  reasons.length === 0
    ? []
    : [`The AI review ran without some guideline files: ${reasons.join("; ")}`];

/** The enabled roots and the files they import, as many as fit. */
const harnessGuidelines = (
  { harness, contents }: LoadedHarness,
  switches: ReadonlyMap<string, boolean>,
): Guidelines => {
  const { inPrompt, passedOver } = harnessPlan(harness, switches);
  const loading = [...inPrompt, ...passedOver];
  const importerOf = (path: string): string | null =>
    loading.find((file) => file.links.some((link) => link.path === path && link.kind === "import"))
      ?.path ?? null;
  const asked = new Set([
    ...GUIDELINE_PATHS.filter((path) => guidelineEnabled(path, switches)),
    ...loading.flatMap(({ path }) =>
      harnessLinks(path, contents.get(path) ?? "").flatMap((link) =>
        link.kind === "import" ? link.paths.filter((one) => switches.get(one) !== false) : [],
      ),
    ),
  ]);
  return {
    sent: inPrompt.map(({ path, bytes, via }) => ({
      path,
      bytes,
      content: contents.get(path) ?? "",
      linkedFrom: via === "root" ? null : importerOf(path),
    })),
    warnings: leftOutWarning([
      ...passedOver.map(doesntFit),
      ...harness.skipped
        .filter(({ path }) => asked.has(path))
        .map(({ path, reason }) => `${path} ${SKIPPED[reason]}`),
    ]),
  };
};

/** The enabled roots alone, through the file cache, for a repository whose harness isn't loaded. */
const rootGuidelines = async (
  deps: Pick<AppDeps, "fileCache" | "hosts">,
  repo: RepoRef,
  sha: string,
  paths: readonly GuidelinePath[],
): Promise<Result<Guidelines, UseCaseError>> => {
  const read = await readRootFiles(deps, repo, sha, paths);
  if (!read.ok) return read;
  const { fitting, passedOver } = fitInPrompt(
    paths.flatMap((path) => {
      const content = read.value.get(path) ?? null;
      return content === null
        ? []
        : [{ path, content, bytes: utf8.encode(content).byteLength, linkedFrom: null }];
    }),
  );
  return ok({ sent: fitting, warnings: leftOutWarning(passedOver.map(doesntFit)) });
};

const guidelinesOf = async (
  deps: Pick<AppDeps, "fileCache" | "hosts" | "harnessSource" | "harnessStore" | "logger">,
  { ref: { repo }, baseSha }: PullRequest,
  switches: ReadonlyMap<string, boolean>,
): Promise<Guidelines> => {
  const paths = GUIDELINE_PATHS.filter((path) => guidelineEnabled(path, switches));
  if (paths.length === 0) return { sent: [], warnings: [] };
  const loaded = await loadHarness(deps, repo, baseSha);
  if (loaded.ok && loaded.value !== null) return harnessGuidelines(loaded.value, switches);
  const roots = await rootGuidelines(deps, repo, baseSha, paths);
  if (!roots.ok) {
    return {
      sent: [],
      warnings: [
        `Couldn't read the repository's guideline files, so the AI review ran without them: ${roots.error.message}`,
      ],
    };
  }
  const { sent, warnings } = roots.value;
  return loaded.ok || sent.length + warnings.length === 0
    ? roots.value
    : {
        sent,
        warnings: [
          ...warnings,
          `Couldn't load the files the repository's guideline files import, so the AI review ran without them: ${loaded.error.message}`,
        ],
      };
};

export interface RunGuidance {
  /** What the run was given, to keep on the analysis. */
  readonly guidance: Guidance;
  /** The same, as the passes read it. */
  readonly input: InputGuidance;
  readonly warnings: readonly string[];
}

/**
 * What a model run on a pull request reads beside the code: the reviewer's enabled preferences for
 * its repository, and the repository's guideline files they switched on with the files those
 * import, at the PR's base commit, so a PR can't rewrite the rules it's reviewed by. It joins the
 * harness's load, running since the PR was opened. A file that can't be read or doesn't fit is a
 * warning, and the run goes on without it.
 */
export const runGuidance = async (
  deps: Pick<
    AppDeps,
    "preferences" | "fileCache" | "hosts" | "harnessSource" | "harnessStore" | "logger"
  >,
  pullRequest: PullRequest,
): Promise<RunGuidance> => {
  const { repo } = pullRequest.ref;
  const [all, switches] = await Promise.all([
    deps.preferences.listPreferences(),
    deps.preferences.getGuidelineSwitches(repo),
  ]);
  const { sent, warnings } = await guidelinesOf(deps, pullRequest, switches);
  const guidance = guidanceOf(preferencesFor(all, repo), sent);
  return {
    guidance,
    input: {
      preferences: guidance.preferences.map(({ ref, kind, text, scope }) => ({
        ref,
        kind,
        text,
        scope: scope.kind,
      })),
      guidelines: guidance.guidelines.flatMap(({ ref, path, linkedFrom }, index) => {
        const content = sent[index]?.content;
        return content === undefined ? [] : [{ ref, path, linkedFrom, content }];
      }),
    },
    warnings,
  };
};
