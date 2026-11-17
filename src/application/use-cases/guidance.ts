import {
  GUIDELINE_PATHS,
  type Guidance,
  type GuidelinePath,
  guidanceOf,
  guidelineEnabled,
  guidelineFile,
  MAX_GUIDELINE_BYTES,
  type PullRequest,
  preferencesFor,
  type RepoRef,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { InputGuidance } from "../ports/index.ts";
import { hostFor } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { fromHostError, type UseCaseError } from "./errors.ts";

/** As Collect does, a file over 1 MB isn't kept. */
const MAX_CACHED_BYTES = 1024 * 1024;

const utf8 = new TextEncoder();

/**
 * A repository's guideline files at a commit, by path, null for one that isn't there: from the
 * file cache, and the rest from the host in one request, which then go into the cache.
 */
export const readGuidelines = async (
  deps: Pick<AppDeps, "fileCache" | "hosts">,
  repo: RepoRef,
  sha: string,
  paths: readonly GuidelinePath[],
): Promise<Result<ReadonlyMap<GuidelinePath, string | null>, UseCaseError>> => {
  const contents = new Map<GuidelinePath, string | null>();
  const missing: GuidelinePath[] = [];
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

const kilobytes = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB`;

export interface RunGuidance {
  /** What the run was given, to keep on the analysis. */
  readonly guidance: Guidance;
  /** The same, as the passes read it. */
  readonly input: InputGuidance;
  readonly warnings: readonly string[];
}

/**
 * What a model run on a pull request reads beside the code: the reviewer's enabled preferences for
 * its repository, and the repository's guideline files they switched on, at the PR's base commit,
 * so a PR can't rewrite the rules it's reviewed by. A file that can't be read or is too large is a
 * warning, and the run goes on without it.
 */
export const runGuidance = async (
  deps: Pick<AppDeps, "preferences" | "fileCache" | "hosts">,
  pullRequest: PullRequest,
): Promise<RunGuidance> => {
  const { repo } = pullRequest.ref;
  const [all, switches] = await Promise.all([
    deps.preferences.listPreferences(),
    deps.preferences.getGuidelineSwitches(repo),
  ]);
  const paths = GUIDELINE_PATHS.filter((path) => guidelineEnabled(path, switches));
  const read = await readGuidelines(deps, repo, pullRequest.baseSha, paths);
  const warnings: string[] = [];
  const sent: { path: GuidelinePath; bytes: number; content: string }[] = [];
  if (!read.ok) {
    warnings.push(
      `Couldn't read the repository's guideline files, so the AI review ran without them: ${read.error.message}`,
    );
  } else {
    for (const path of paths) {
      const content = read.value.get(path) ?? null;
      if (content === null) continue;
      const { bytes, tooLarge } = guidelineFile(path, content, switches);
      if (tooLarge) {
        warnings.push(
          `${path} is ${kilobytes(bytes)}, over the ${kilobytes(MAX_GUIDELINE_BYTES)} a guideline file can be, so the AI review ran without it`,
        );
      } else sent.push({ path, bytes, content });
    }
  }
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
      guidelines: guidance.guidelines.flatMap(({ ref, path }, index) => {
        const content = sent[index]?.content;
        return content === undefined ? [] : [{ ref, path, content }];
      }),
    },
    warnings,
  };
};
