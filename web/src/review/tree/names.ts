// A file name that doesn't fit its row loses words from its middle, never its extension, so the
// start and the end, where class names differ most, stay readable.

const ELLIPSIS = "…";

/** The stem's words: `CallCountProfileRecorder` is Call, Count, Profile, Recorder. */
const words = (stem: string): readonly string[] =>
  stem.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])|[^A-Za-z0-9]+/g) ?? [stem];

/**
 * The longest form of `stem` that `fits`: the whole stem; else the fewest whole words cut from
 * its middle, as `Recurring…Support`; else characters cut from its middle, keeping up to its last
 * 8. The last try is returned when nothing fits, and the row cuts it at its end.
 */
export const shortenName = (stem: string, fits: (text: string) => boolean): string => {
  if (fits(stem)) return stem;
  const parts = words(stem);
  if (parts.length > 2 && parts.join("") === stem) {
    for (let cut = 1; cut <= parts.length - 2; cut++) {
      for (let start = Math.ceil((parts.length - cut) / 2); start >= 1; start--) {
        if (start + cut > parts.length - 1) continue;
        const text = `${parts.slice(0, start).join("")}${ELLIPSIS}${parts.slice(start + cut).join("")}`;
        if (fits(text)) return text;
      }
    }
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
 * A name's stem and its extension, `.java`. An extension is short and lowercase, so a service
 * file named after a class, `com.acme.feature.InternalFeature`, is all stem.
 */
export const splitName = (name: string): readonly [string, string] => {
  const extension = /(?<=.)\.[a-z][a-z0-9]{0,9}$/.exec(name)?.[0] ?? "";
  return [name.slice(0, name.length - extension.length), extension];
};
