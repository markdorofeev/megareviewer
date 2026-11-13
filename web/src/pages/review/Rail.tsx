import type { ReactNode } from "react";

/** The rail beside the code, holding the tree of files. */
export const Rail = ({ children }: { readonly children: ReactNode }) => (
  <aside
    id="review-tree-rail"
    aria-label="Files"
    // Padded on both sides so the focus outlines aren't clipped, and pulled left by the same
    // amount so its contents line up with the page's. It sits under the review bar.
    className="sticky top-[var(--review-bar-h,0px)] -ml-1 flex h-[calc(100vh-var(--review-bar-h,0px))] min-h-0 flex-col gap-2 self-start overflow-hidden p-1"
  >
    {children}
  </aside>
);
