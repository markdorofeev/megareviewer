import { execFile } from "node:child_process";

/** A Spotlight query's answer, its paths ended by NULs; null when it couldn't be asked. */
export type RunSpotlight = (args: readonly string[]) => Promise<string | null>;

const TIMEOUT_MS = 2000;

/** By its own path, not the PATH's: it's part of macOS. No shell. */
export const runSpotlight: RunSpotlight = (args) =>
  new Promise((resolve) => {
    execFile("/usr/bin/mdfind", [...args], { timeout: TIMEOUT_MS }, (error, stdout) =>
      resolve(error === null ? stdout : null),
    );
  });

/** The name goes into a query, so a quote or an operator in one is never asked about. */
const ASKABLE = /^[A-Za-z0-9._-]+$/;

/** The folders under `home` with a name, whatever its case, as Spotlight has them. */
export const foldersNamed = async (
  name: string,
  home: string,
  run: RunSpotlight,
): Promise<readonly string[]> => {
  if (!ASKABLE.test(name)) return [];
  const answer = await run([
    "-0",
    "-onlyin",
    home,
    `kMDItemContentType == "public.folder" && kMDItemFSName == "${name}"c`,
  ]);
  return answer === null ? [] : answer.split("\0").filter(Boolean).sort();
};
