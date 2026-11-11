// How a file relates to the file in view, from the links the overview draws: which files call it
// and which it calls. The tree and the miniature mark them with arrows and mute the rest.

/** For each file, the files it links to. */
export type Neighbors = ReadonlyMap<string, ReadonlySet<string>>;

export type Relation = "current" | "caller" | "callee" | "both" | "other" | "none";

export const ARROWS: Readonly<
  Record<Relation, { readonly mark: string; readonly text: string } | null>
> = {
  caller: { mark: "↑", text: "calls the file in view" },
  callee: { mark: "↓", text: "called by the file in view" },
  both: { mark: "↕", text: "calls and is called by the file in view" },
  current: null,
  other: null,
  none: null,
};

export const relationOf = (
  path: string,
  current: string | null,
  neighbors: Neighbors,
): Relation => {
  if (current === null) return "none";
  if (path === current) return "current";
  const calls = neighbors.get(path)?.has(current) === true;
  const called = neighbors.get(current)?.has(path) === true;
  return calls && called ? "both" : calls ? "caller" : called ? "callee" : "other";
};
