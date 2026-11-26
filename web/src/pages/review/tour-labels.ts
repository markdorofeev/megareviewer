import { shortenPath } from "../../review/tree/names.ts";

// How the tour's strip names a directory. Its labels are set in a mono face, so a label fits by
// its count of characters, and one too long loses whole directories from its middle, as in the
// tree: where a path starts and the directory it names are what tell two boxes apart.

/** What fits a box's line of parents, at the caption size in a box of the strip's widest. */
const PARENT_CHARS = 30;
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

/** `com.oracle.svm.hosted/pgo` without the dotted parts every such name on the strip starts with. */
const withoutSharedPackage = (names: readonly string[]): string[] => {
  const headOf = (name: string) => (name.includes("/") ? name.slice(0, name.indexOf("/")) : "");
  const heads = [...new Set(names.map(headOf).filter((head) => head.includes(".")))];
  const [first, ...rest] = heads.map((head) => head.split("."));
  if (first === undefined || rest.length === 0) return [...names];
  let shared = 0;
  // Each keeps its last part: what's left has to name it.
  while (
    [first, ...rest].every((parts) => parts.length > shared + 1 && parts[shared] === first[shared])
  ) {
    shared += 1;
  }
  return names.map((name) => {
    const head = headOf(name);
    return heads.includes(head)
      ? head.split(".").slice(shared).join(".") + name.slice(head.length)
      : name;
  });
};

/**
 * The compact strip's names: each directory by as few of its last directories as tell it from
 * the other directories on the tour, and a Java module among them without the package they all
 * start with, so two `pgo` read as `core/pgo` and `hosted/pgo`. A directory the tour comes back
 * to has the same name each time.
 */
export const compactLabels = (labels: readonly string[]): string[] => {
  const paths = labels.map((label) => bare(label).split("/"));
  const names = paths.map((parts) => {
    const whole = parts.join("/");
    for (let take = 1; take < parts.length; take += 1) {
      const name = parts.slice(-take).join("/");
      const taken = paths.some(
        (other) => other.join("/") !== whole && other.slice(-take).join("/") === name,
      );
      if (!taken) return name;
    }
    return whole;
  });
  return withoutSharedPackage(names).map((name) => shortenPath(name, within(COMPACT_CHARS)));
};
