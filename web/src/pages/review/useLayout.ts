import { useCallback, useEffect } from "react";
import { navigate, useSearch } from "../../app/router.ts";
import { type Layout, parseLayout } from "./model.ts";
import { useStoredState } from "./storage.ts";

const VIEWS: Readonly<Record<Layout, string>> = { map: "code", overview: "overview" };

/** The layout a review's address names, `?view=code` or `?view=overview`. */
export const layoutOfSearch = (search: string): Layout | undefined => {
  const view = new URLSearchParams(search).get("view");
  return view === "code" ? "map" : view === "overview" ? "overview" : undefined;
};

/** The address of this page in `layout`, keeping the rest of its query. */
export const layoutUrl = (location: Pick<Location, "pathname" | "search">, layout: Layout) => {
  const params = new URLSearchParams(location.search);
  params.set("view", VIEWS[layout]);
  return `${location.pathname}?${params.toString()}`;
};

/**
 * Where a history entry of the review came from, so going back to it is one step: the code
 * opened from the overview or the tour, or the overview opened from the code on the node it
 * focused first (`at`), or the tour on its step.
 */
export type CameFrom =
  | { readonly from: "overview" }
  | { readonly from: "code"; readonly at: string | null }
  | { readonly from: "code"; readonly step: number };

/** What the current history entry says it came from, or null. */
export const cameFrom = (state: unknown = window.history.state): CameFrom | null => {
  if (typeof state !== "object" || state === null || !("from" in state)) return null;
  if (state.from === "overview") return { from: "overview" };
  if (state.from !== "code") return null;
  if ("step" in state && typeof state.step === "number") {
    return { from: "code", step: state.step };
  }
  const at = "at" in state && typeof state.at === "string" ? state.at : null;
  return { from: "code", at };
};

/**
 * The review's layout, in its address so Back and Forward go between the code and the overview.
 * The last one chosen is kept per browser, for a review opened without one.
 */
export const useLayout = () => {
  const search = useSearch();
  const [stored, store] = useStoredState("review-layout", "map", parseLayout);
  const layout = layoutOfSearch(search) ?? stored;
  // The entry the page opened on names its layout too, so Back to it shows that one.
  useEffect(() => {
    if (layoutOfSearch(window.location.search) !== undefined) return;
    window.history.replaceState(window.history.state, "", layoutUrl(window.location, layout));
  }, [layout]);
  /** Shows `next` on a new history entry, keeping where it came from; nothing when it's shown. */
  const setLayout = useCallback(
    (next: Layout, from: CameFrom | null = null) => {
      store(() => next);
      if (next === layout) return;
      navigate(layoutUrl(window.location, next), from === null ? null : { ...from });
    },
    [layout, store],
  );
  return [layout, setLayout] as const;
};
