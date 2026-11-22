import { shortenPath } from "../../review/tree/names.ts";

// How the tour's strip names a directory. Its labels are set in a mono face, so a label fits by
// its count of characters, and one too long loses whole directories from its middle, as in the
// tree: where a path starts and the directory it names are what tell two boxes apart.

/** What fits a box's line of parents, at the caption size in a box of the strip's widest. */
const PARENT_CHARS = 30;
/** What fits a chip of a directory off the tour. */
const CHIP_CHARS = 36;
/** What fits a box of the compact strip, beside its steps' numbers. */
const COMPACT_CHARS = 28;

const bare = (label: string): string => (label.endsWith("/") ? label.slice(0, -1) : label);

const within =
  (chars: number) =>
  (text: string): boolean =>
    text.length <= chars;

/** A box's two lines: the directory's parents, cut to fit, and its own name. */
export const boxLabel = (label: string): { readonly prefix: string; readonly name: string } => {
  const path = bare(label);
  const cut = path.lastIndexOf("/");
  if (cut === -1) return { prefix: "", name: path || label };
  const parents = shortenPath(path.slice(0, cut), within(PARENT_CHARS - 1));
  return { prefix: `${parents}/`, name: path.slice(cut + 1) };
};

/**
 * The directories off the tour, each on one line. Two that the cut would make read alike keep
 * their whole paths: what differs between them is what was cut.
 */
export const chipLabels = (labels: readonly string[]): string[] => {
  const cut = labels.map((label) => shortenPath(bare(label), within(CHIP_CHARS)));
  return cut.map((text, at) =>
    cut.some((other, j) => j !== at && other === text) ? bare(labels[at] ?? text) : text,
  );
};

/**
 * The compact strip's names: each directory by as few of its last directories as tell it from
 * the others on the tour, so two `pgo` read as `core/pgo` and `hosted/pgo`.
 */
export const compactLabels = (labels: readonly string[]): string[] => {
  const paths = labels.map((label) => bare(label).split("/"));
  return paths.map((parts, at) => {
    for (let take = 1; take < parts.length; take += 1) {
      const name = parts.slice(-take).join("/");
      const taken = paths.some((other, j) => j !== at && other.slice(-take).join("/") === name);
      if (!taken) return shortenPath(name, within(COMPACT_CHARS));
    }
    return shortenPath(parts.join("/"), within(COMPACT_CHARS));
  });
};
