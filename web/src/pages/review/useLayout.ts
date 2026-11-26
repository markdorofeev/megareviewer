import { useCallback, useEffect } from "react";
import { navigate, useSearch } from "../../app/router.ts";
import { type Layout, parseLayout } from "./model.ts";
import { useStoredState } from "./storage.ts";

const VIEWS: Readonly<Record<Layout, string>> = { map: "code", overview: "overview", tour: "tour" };

/** The layout a review's address names, `?view=code`, `?view=overview` or `?view=tour`. */
export const layoutOfSearch = (search: string): Layout | undefined => {
  const view = new URLSearchParams(search).get("view");
  return view === "code" ? "map" : view === "overview" || view === "tour" ? view : undefined;
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
  | { readonly from: "overview" | "tour" }
  | { readonly from: "code"; readonly at: string | null }
  | { readonly from: "code"; readonly step: number };

/** What the current history entry says it came from, or null. */
export const cameFrom = (state: unknown = window.history.state): CameFrom | null => {
  if (typeof state !== "object" || state === null || !("from" in state)) return null;
  if (state.from === "overview" || state.from === "tour") return { from: state.from };
  if (state.from !== "code") return null;
  if ("step" in state && typeof state.step === "number") {
    return { from: "code", step: state.step };
  }
  const at = "at" in state && typeof state.at === "string" ? state.at : null;
  return { from: "code", at };
};

/**
 * The review's layout, in its address so Back and Forward go between the layouts. The last one
 * chosen is kept per browser, for a review opened without one. The tour is a layout only while
 * there's one (`tour`); without, it's the overview.
 */
export const useLayout = (tour: boolean) => {
  const search = useSearch();
  const [stored, store] = useStoredState("review-layout", "map", parseLayout);
  const named = layoutOfSearch(search) ?? stored;
  const layout = named === "tour" && !tour ? "overview" : named;
  // The entry the page is on names the layout it shows, so Back to it shows that one.
  useEffect(() => {
    if (layoutOfSearch(search) === layout) return;
    window.history.replaceState(window.history.state, "", layoutUrl(window.location, layout));
  }, [layout, search]);
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
