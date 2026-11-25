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
import type { CodeParser, FoundCheckout, LocalCheckout } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";

/** A checkout to read, at the PR's head commit. */
export interface CheckoutAt {
  readonly checkout: LocalCheckout;
  readonly sha: string;
}

/** What looking for a checkout came to. */
export interface CheckoutLookup {
  readonly status: Extract<CheckoutStatus, "read" | "none" | "missing-commit">;
  /** The folder read, or the one that names the repository without the commit. */
  readonly dir: string | null;
  readonly at: CheckoutAt | null;
}

/**
 * Where the repository could be, in the order to try: the folder megareviewer was pointed at, the
 * folders it was read from before, then the clones a search finds. Each is looked for only when the
 * ones before it aren't the one to read. A folder that's gone is forgotten.
 */
async function* candidates(
  { checkouts, knownCheckouts }: Pick<AppDeps, "checkouts" | "knownCheckouts">,
  repo: RepoRef,
): AsyncGenerator<FoundCheckout> {
  const pointed = await checkouts.pointedAt(repo);
  if (pointed !== null) yield pointed;
  for (const dir of await knownCheckouts.foldersRead(repo)) {
    const found = await checkouts.at(dir, repo);
    if (found === null) await knownCheckouts.forgetFolder(repo, dir);
    // It held this repository's code before, whatever its remotes say now.
    else yield { ...found, namesRepo: true };
  }
  yield* await checkouts.search(repo);
}

/**
 * The checkout to read for a PR: the first that has its head commit, whatever its remotes, since the
 * commit pins the content. It's remembered for the next time. After the reviewer's own come the
 * copies megareviewer downloaded. Without one, "missing-commit" with the first folder that names the
 * repository, so the reviewer knows where a `git fetch` would help, and "none" otherwise.
 */
export const lookUpCheckout = async (
  deps: Pick<AppDeps, "checkouts" | "knownCheckouts" | "copies">,
  repo: RepoRef,
  headSha: string,
): Promise<CheckoutLookup> => {
  const tried = new Set<string>();
  let naming: string | null = null;
  for await (const { checkout, dir, namesRepo } of candidates(deps, repo)) {
    if (namesRepo) naming ??= dir;
    if (tried.has(dir)) continue;
    tried.add(dir);
    if (await checkout.hasCommit(headSha)) {
      await deps.knownCheckouts.rememberFolder(repo, dir);
      return { status: "read", dir, at: { checkout, sha: headSha } };
    }
  }
  const copy = await deps.copies.find(repo, headSha);
  if (copy !== null) {
    return { status: "read", dir: copy.dir, at: { checkout: copy.checkout, sha: headSha } };
  }
  return naming === null
    ? { status: "none", dir: null, at: null }
    : { status: "missing-commit", dir: naming, at: null };
};

const COPY_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/** Removes megareviewer's copies that nothing read for a while. Call once at startup. */
export const forgetOldCopies = ({
  copies,
  clock,
}: Pick<AppDeps, "copies" | "clock">): Promise<number> =>
  copies.forget(new Date(Date.parse(clock.now()) - COPY_KEPT_MS).toISOString());

/** Files read per `git cat-file --batch`, so a large repository isn't held in memory at once. */
const FILES_PER_READ = 500;

/**
 * Parses only the files that could call a changed definition. A failure is a warning, never a
 * failed analysis.
 */
export const readUnchangedCallers = async (
  parser: CodeParser,
  at: CheckoutAt,
  files: readonly FileChange[],
  changed: readonly ChangedDefinition[],
  generated: ReadonlySet<string>,
): Promise<{ readonly unchangedCallers: UnchangedCallers[]; readonly warnings: string[] }> => {
  if (changed.length === 0) return { unchangedCallers: [], warnings: [] };
  const names = new Set(changed.map((definition) => definition.name));
  const mentioning = await at.checkout.filesMentioning(at.sha, [...names]);
  if (!mentioning.ok) {
    return {
      unchangedCallers: [],
      warnings: [`Couldn't read the local checkout: ${mentioning.error.message}`],
    };
  }
  const changedPaths = new Set(files.map((file) => file.path));
  const families = new Set(
    files.flatMap((file) => (file.language === null ? [] : [languageFamily(file.language)])),
  );
  const candidates = mentioning.value.flatMap((path) => {
    const language = changedPaths.has(path) ? null : parser.languageFor(path);
    return language !== null && resolvesImports(language) && families.has(languageFamily(language))
      ? [{ path, language }]
      : [];
  });

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
      // The checkout may answer a file that holds a name only within a longer one.
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
