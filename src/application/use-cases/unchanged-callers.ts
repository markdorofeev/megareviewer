import {
  type ChangedDefinition,
  type FileChange,
  findUnchangedCallers,
  languageFamily,
  mentionsAny,
  resolvesImports,
  type UnchangedCallers,
  type UnchangedFile,
} from "../../domain/diff/index.ts";
import type { CheckoutStatus, RepoRef } from "../../domain/review/index.ts";
import type { CodeParser, LocalCheckout, LocalCheckouts } from "../ports/index.ts";

/** A checkout to read, at the PR's head commit. */
export interface CheckoutAt {
  readonly checkout: LocalCheckout;
  readonly sha: string;
}

/**
 * The checkout to read for a PR: one that has its head commit, whatever its remotes, since the
 * commit pins the content. Without the commit, "missing-commit" when a remote names the PR's
 * repository, so the reviewer knows a `git fetch` would help, and "none" otherwise.
 */
export const lookUpCheckout = async (
  checkouts: LocalCheckouts,
  repo: RepoRef,
  headSha: string,
): Promise<{ readonly status: CheckoutStatus; readonly at: CheckoutAt | null }> => {
  const found = await checkouts.find(repo);
  if (found === null) return { status: "none", at: null };
  if (await found.checkout.hasCommit(headSha)) {
    return { status: "read", at: { checkout: found.checkout, sha: headSha } };
  }
  return { status: found.namesRepo ? "missing-commit" : "none", at: null };
};

/** Files read per `git cat-file --batch`, so a large repository isn't held in memory at once. */
const FILES_PER_READ = 500;

/**
 * Reads the unchanged callers of `changed` from the checkout. Only files in a language whose
 * imports are read, in the family of a changed file, and whose text names a changed definition
 * are parsed. Reading never fails the analysis: a failure is a warning, and files over 1 MB are
 * counted in one.
 */
export const readUnchangedCallers = async (
  parser: CodeParser,
  at: CheckoutAt,
  files: readonly FileChange[],
  changed: readonly ChangedDefinition[],
  generated: ReadonlySet<string>,
): Promise<{ readonly unchangedCallers: UnchangedCallers[]; readonly warnings: string[] }> => {
  if (changed.length === 0) return { unchangedCallers: [], warnings: [] };
  const listed = await at.checkout.listFiles(at.sha);
  if (!listed.ok) {
    return {
      unchangedCallers: [],
      warnings: [`Couldn't read the local checkout: ${listed.error.message}`],
    };
  }
  const changedPaths = new Set(files.map((file) => file.path));
  const families = new Set(
    files.flatMap((file) => (file.language === null ? [] : [languageFamily(file.language)])),
  );
  const candidates = listed.value.flatMap((path) => {
    const language = changedPaths.has(path) ? null : parser.languageFor(path);
    return language !== null && resolvesImports(language) && families.has(languageFamily(language))
      ? [{ path, language }]
      : [];
  });
  const names = new Set(changed.map((definition) => definition.name));

  const unchanged: UnchangedFile[] = [];
  let tooLarge = 0;
  for (let start = 0; start < candidates.length; start += FILES_PER_READ) {
    const batch = candidates.slice(start, start + FILES_PER_READ);
    const read = await at.checkout.readFiles(
      at.sha,
      batch.map((file) => file.path),
    );
    if (!read.ok) {
      return {
        unchangedCallers: [],
        warnings: [`Couldn't read the local checkout: ${read.error.message}`],
      };
    }
    for (const [index, file] of read.value.entries()) {
      const candidate = batch[index];
      if (candidate === undefined) continue;
      if (file.kind === "too-large") tooLarge += 1;
      if (file.kind !== "text" || !mentionsAny(file.content, names)) continue;
      const symbols = await parser.symbols(file.content, candidate.language);
      if (symbols.ok)
        unchanged.push({ ...candidate, content: file.content, symbols: symbols.value });
    }
  }
  return {
    unchangedCallers: findUnchangedCallers(files, changed, unchanged, generated),
    warnings:
      tooLarge === 0
        ? []
        : [
            `${tooLarge === 1 ? "1 file" : `${tooLarge} files`} in the local checkout ${tooLarge === 1 ? "is" : "are"} over 1 MB, so callers in ${tooLarge === 1 ? "it" : "them"} aren't shown.`,
          ],
  };
};
