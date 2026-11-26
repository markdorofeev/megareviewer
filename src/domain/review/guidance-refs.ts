import type { Guidance } from "./preference.ts";

/** What stands for each ref of a run's guidance in prose: a file's path, or null for a preference. */
export type RefNames = ReadonlyMap<string, string | null>;

const REF_SHAPED = /(?<![\w$])[pg][1-9]\d*(?![\w$])/g;

/**
 * The refs of a run's guidance, less those the pull request's own text has as a word: there `p1`
 * may be the code's, and a point is better with a ref in it than with the wrong code.
 */
export const refNames = (
  guidance: Guidance | null,
  pullRequestTexts: Iterable<string>,
): RefNames => {
  if (guidance === null) return new Map();
  const names = new Map<string, string | null>([
    ...guidance.preferences.map(({ ref }) => [ref, null] as const),
    ...guidance.guidelines.map(({ ref, path }) => [ref, path] as const),
  ]);
  if (names.size === 0) return names;
  for (const text of pullRequestTexts) {
    for (const [word] of text.matchAll(REF_SHAPED)) names.delete(word);
  }
  return names;
};

/** Stands for what's dropped until what was around it is tidied. Not a character text has. */
const GONE = "\uE000";
/** A code span, whole, or a ref-shaped word that isn't part of a name, a path or a number. */
const SPAN_OR_REF = /`([^`]*)`|(?<![\w$./-])[pg][1-9]\d*(?![\w$/]|[.-]\w)/g;

const tidied = (text: string): string =>
  text
    .replace(/\uE000(?:\s*(?:,|&|and|or)\s*\uE000)+/g, GONE)
    .replace(/(^|[([]\s*)\uE000\s*[,;:]\s*/g, "$1")
    .replace(/\s*[,;]\s*\uE000(?=\s*[)\]])/g, "")
    .replace(/\s*[([]\s*\uE000\s*[)\]]/g, "")
    .replace(/\s*\uE000/g, "")
    .trim();

/**
 * Text the reviewer reads without the refs of the run's guidance, which name nothing on the page:
 * a file's becomes its path, or goes where the path is right before it, and a preference's goes.
 * Any other ref-shaped word stays, and so does one inside a code span that holds more.
 */
export const withoutRefs = (
  text: string,
  names: RefNames,
): { readonly text: string; readonly refs: readonly string[] } => {
  const refs: string[] = [];
  const replaced = text.replace(SPAN_OR_REF, (match, span: string | undefined, offset: number) => {
    const ref = span ?? match;
    const name = names.get(ref);
    if (name === undefined) return match;
    refs.push(ref);
    const named = text.slice(0, offset).replace(/[\s`([]+$/, "");
    if (name === null || named.endsWith(name)) return GONE;
    return span === undefined ? name : `\`${name}\``;
  });
  if (refs.length === 0) return { text, refs };
  const clean = replaced.includes(GONE) ? tidied(replaced) : replaced;
  return clean === "" ? { text, refs: [] } : { text: clean, refs };
};
