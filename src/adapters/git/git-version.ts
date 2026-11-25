import { tmpdir } from "node:os";
import type { RunDownload } from "./run-download.ts";
import { type RunGit, runGit } from "./run-git.ts";

/** The first git that reads its whole config from the environment, which a download relies on. */
export const GIT_NEEDED = "2.32";

const VERSION = /\d+(?:\.\d+)+/;

/** "2.50.1", or null when git isn't installed, for `doctor`. */
export const installedGit = async (run: RunGit = runGit): Promise<string | null> => {
  const { code, stdout } = await run(tmpdir(), ["--version"]);
  return code === 0 ? (VERSION.exec(stdout.toString("utf8"))?.[0] ?? null) : null;
};

/** The version of the git a download runs, or null when it can't be run. */
export const gitVersion = async (
  run: RunDownload,
  env: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<string | null> => {
  const { code, stdout } = await run({ args: ["--version"], env, signal });
  return code === 0 ? (VERSION.exec(stdout.toString("utf8"))?.[0] ?? null) : null;
};

export const isNewEnough = (version: string): boolean => {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [needsMajor = 0, needsMinor = 0] = GIT_NEEDED.split(".").map(Number);
  return major > needsMajor || (major === needsMajor && minor >= needsMinor);
};
