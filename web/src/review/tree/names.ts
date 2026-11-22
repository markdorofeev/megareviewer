// A file name that doesn't fit its row loses words from its middle, never its extension, so the
// start and the end, where class names differ most, stay readable.

const ELLIPSIS = "…";

/** The stem's words: `CallCountProfileRecorder` is Call, Count, Profile, Recorder. */
const words = (stem: string): readonly string[] =>
  stem.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])|[^A-Za-z0-9]+/g) ?? [stem];

/** The fewest of `parts` cut from their middle, never the first or the last, so the rest `fits`. */
const cutMiddle = (
  parts: readonly string[],
  separator: string,
  fits: (text: string) => boolean,
): string | null => {
  for (let cut = 1; cut <= parts.length - 2; cut++) {
    for (let start = Math.ceil((parts.length - cut) / 2); start >= 1; start--) {
      if (start + cut > parts.length - 1) continue;
      const text = [...parts.slice(0, start), ELLIPSIS, ...parts.slice(start + cut)].join(
        separator,
      );
      if (fits(text)) return text;
    }
  }
  return null;
};

/**
 * The longest form of `stem` that `fits`: the whole stem; else the fewest whole words cut from
 * its middle, as `Recurring…Support`; else characters cut from its middle, keeping up to its last
 * 8. The last try is returned when nothing fits, and the row cuts it at its end.
 */
export const shortenName = (stem: string, fits: (text: string) => boolean): string => {
  if (fits(stem)) return stem;
  const parts = words(stem);
  if (parts.length > 2 && parts.join("") === stem) {
    const text = cutMiddle(parts, "", fits);
    if (text !== null) return text;
  }
  const keep = Math.min(8, stem.length >> 1);
  let text = stem;
  for (let head = stem.length - keep - 1; head >= 3; head--) {
    text = `${stem.slice(0, head)}${ELLIPSIS}${stem.slice(-keep)}`;
    if (fits(text)) return text;
  }
  return text;
};

/**
 * The longest form of a repository's name that `fits`: the whole name; else the fewest whole
 * segments between `-`, `_` or `.` cut from its middle, the separator kept on both sides of the
 * cut, as `delphi-…-service`; else as `shortenName` cuts it.
 */
export const shortenRepoName = (name: string, fits: (text: string) => boolean): string => {
  if (fits(name)) return name;
  // "delphi-", "payments-", "service": each segment with the separator after it.
  const parts = name.split(/(?<=[-_.])(?=.)/);
  for (let cut = 1; cut <= parts.length - 2; cut++) {
    for (let start = Math.ceil((parts.length - cut) / 2); start >= 1; start--) {
      if (start + cut > parts.length - 1) continue;
      const separator = parts[start + cut - 1]?.slice(-1) ?? "";
      const text = `${parts.slice(0, start).join("")}${ELLIPSIS}${separator}${parts.slice(start + cut).join("")}`;
      if (fits(text)) return text;
    }
  }
  return shortenName(name, fits);
};

/**
 * The longest form of a directory path that `fits`: the whole path; else the fewest directories
 * cut from its middle, as `src/test/…/orders`, so where it starts and the directory it names stay
 * readable; else `…/` and its last directory, which the row cuts at its end if that doesn't fit.
 */
export const shortenPath = (path: string, fits: (text: string) => boolean): string => {
  if (fits(path)) return path;
  const parts = path.split("/");
  if (parts.length < 2) return path;
  return cutMiddle(parts, "/", fits) ?? `${ELLIPSIS}/${parts.at(-1) ?? ""}`;
};

/**
 * A name's stem and its extension, `.java`. An extension is short and lowercase, so a service
 * file named after a class, `com.acme.feature.InternalFeature`, is all stem.
 */
export const splitName = (name: string): readonly [string, string] => {
  const extension = /(?<=.)\.[a-z][a-z0-9]{0,9}$/.exec(name)?.[0] ?? "";
  return [name.slice(0, name.length - extension.length), extension];
};
