import type { CallGraphHint, FileChange, Hunk } from "./types.ts";

/** What hints need from `CodeParser.symbols`, for the head version of a file. */
export interface FileSymbols {
  readonly definitions: readonly {
    readonly name: string;
    readonly startLine: number;
    readonly endLine: number;
  }[];
  readonly references: readonly { readonly name: string; readonly line: number }[];
}

const MAX_HINTS_PER_HUNK = 10;

interface Located {
  readonly path: string;
  readonly hunk: Hunk;
  /** Position in the diff, for a stable order. */
  readonly order: number;
}

/**
 * Hints for the tour: a hunk that references a symbol points to each other hunk that changes it.
 * A hunk changes a symbol when its added lines overlap the definition; it references one when a
 * reference falls on its added or context lines. Symbols match by name only, so two symbols with
 * one name link both ways: these order the tour, they aren't facts. One hint per symbol and
 * hunk, on its first reference's line. At most 10 hints per hunk, same file first, then by symbol
 * name.
 */
export const buildCallGraphHints = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
): CallGraphHint[] => {
  const hunks = files
    .flatMap((file) => file.hunks.map((hunk) => ({ path: file.path, hunk })))
    .map((entry, order): Located => ({ ...entry, order }));

  const changedBy = new Map<string, Located[]>();
  for (const entry of hunks) {
    const added = newLines(entry.hunk, ["add"]);
    for (const definition of symbolsByPath.get(entry.path)?.definitions ?? []) {
      if (!added.some((line) => line >= definition.startLine && line <= definition.endLine)) {
        continue;
      }
      const changers = changedBy.get(definition.name) ?? [];
      if (!changers.includes(entry)) changedBy.set(definition.name, [...changers, entry]);
    }
  }

  return hunks.flatMap((from): CallGraphHint[] => {
    const lines = new Set(newLines(from.hunk, ["add", "context"]));
    const firstLine = new Map<string, number>();
    for (const { name, line } of symbolsByPath.get(from.path)?.references ?? []) {
      const first = firstLine.get(name);
      if (lines.has(line) && (first === undefined || line < first)) firstLine.set(name, line);
    }
    const candidates = [...firstLine].flatMap(([symbol, line]) =>
      (changedBy.get(symbol) ?? [])
        .filter((to) => to.hunk.id !== from.hunk.id)
        .map((to) => ({ to, symbol, line, sameFile: to.path === from.path })),
    );
    return candidates
      .sort(
        (a, b) =>
          Number(b.sameFile) - Number(a.sameFile) ||
          compare(a.symbol, b.symbol) ||
          a.to.order - b.to.order,
      )
      .slice(0, MAX_HINTS_PER_HUNK)
      .map(({ to, symbol, line }) => ({
        fromHunkId: from.hunk.id,
        toHunkId: to.hunk.id,
        symbol,
        line,
      }));
  });
};

const newLines = (hunk: Hunk, kinds: readonly string[]): number[] =>
  hunk.lines.flatMap((line) =>
    kinds.includes(line.kind) && line.newLine !== null ? [line.newLine] : [],
  );

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
