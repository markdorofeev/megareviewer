import { hunkIdOf, isTestFile, type UnchangedCallers } from "../../../../src/domain/diff/index.ts";
import type { Analysis } from "../../../../src/domain/review/index.ts";

/** The uses of a changed definition in code outside the pull request; a test's isn't one. */
export const codeUses = (callers: UnchangedCallers): number => {
  const uses = callers.uses.filter((use) => !isTestFile(use.path)).length;
  // Uses past the limit are counted, not listed; code is kept first, so they're tests when any is.
  return uses + (callers.uses.length > uses ? 0 : callers.more);
};

/** How many places outside the pull request use what each changed file changes. */
export const usesByFile = ({
  files,
  unchangedCallers,
}: Pick<Analysis, "files"> & Partial<Pick<Analysis, "unchangedCallers">>): ReadonlyMap<
  string,
  number
> => {
  const pathOf = new Map(
    files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path] as const)),
  );
  const uses = new Map<string, number>();
  for (const callers of unchangedCallers ?? []) {
    const path = pathOf.get(hunkIdOf(callers.partId));
    if (path !== undefined) uses.set(path, (uses.get(path) ?? 0) + codeUses(callers));
  }
  return uses;
};

/** "used in 4 places outside the PR". */
export const usedOutside = (uses: number): string =>
  `used in ${uses === 1 ? "1 place" : `${uses} places`} outside the PR`;
