import type { ReactNode } from "react";

/** Lines as a diff names them: R for the head's side, L for the base's, e.g. `R20–21`. */
export const lineRef = (side: "old" | "new", startLine: number | null, line: number): string =>
  `${side === "old" ? "L" : "R"}${startLine === null || startLine === line ? line : `${startLine}–${line}`}`;

/** A file name or lines in a comment's header, in the hunk header's colors. */
export const RefChip = ({ children }: { readonly children: ReactNode }) => (
  <code className="rounded-sm bg-diff-hunk-bg px-1 font-mono text-code-compact text-diff-hunk-fg">
    {children}
  </code>
);
