import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { PullRequestFixture } from "../src/application/testing/index.ts";
import { PullRequest } from "../src/domain/review/index.ts";

/** A case's PR without its diff, which lives in diff.patch next to the case. */
export type CaseMeta = Omit<PullRequestFixture, "pullRequest" | "baseFiles" | "headFiles"> & {
  readonly pullRequest: Omit<PullRequest, "diff">;
};

const readTree = (root: string): Record<string, string> => {
  const files: Record<string, string> = {};
  // Git keeps no empty directories: a PR that only adds files has no files/base.
  if (!existsSync(root)) return files;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path).split("\\").join("/")] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return files;
};

/** A case import-pr.ts wrote: the PR in pull-request.json, the rest as fixtureFromFiles reads. */
export const fixtureFromImport = (caseDir: URL, name: string): PullRequestFixture => {
  const json: unknown = JSON.parse(readFileSync(new URL("pull-request.json", caseDir), "utf8"));
  const { diff: _, ...pullRequest } = PullRequest.parse({ ...Object(json), diff: "" });
  return fixtureFromFiles(caseDir, { name, pullRequest, tickets: [] });
};

/**
 * The files of a case's repository its PR doesn't change, from files/outside/. With them the run
 * has a checkout, which the PR's unchanged callers are read from.
 */
export const outsideFiles = (caseDir: URL): Readonly<Record<string, string>> =>
  readTree(join(fileURLToPath(caseDir), "files", "outside"));

/**
 * A case kept as files: files/base/ and files/head/ hold the changed files before and after,
 * diff.patch the PR's diff (git's, made by make-diff.ts, or the host's, for imported PRs).
 */
export const fixtureFromFiles = (caseDir: URL, meta: CaseMeta): PullRequestFixture => {
  const dir = fileURLToPath(caseDir);
  const patch = join(dir, "diff.patch");
  return {
    ...meta,
    // Missing only before make-diff.ts first runs; the cases test fails until it does.
    pullRequest: {
      ...meta.pullRequest,
      diff: existsSync(patch) ? readFileSync(patch, "utf8") : "",
    },
    baseFiles: readTree(join(dir, "files", "base")),
    headFiles: readTree(join(dir, "files", "head")),
  };
};
