import {
  type ImportReach,
  importReach,
  languageFamily,
  resolvesImports,
  type SymbolImport,
  sharesPackage,
} from "./imports.ts";
import { isTestFile } from "./test-files.ts";
import type { CallGraphHint, FileChange, Hunk } from "./types.ts";

/** What hints need from `CodeParser.symbols`, for the head version of a file. */
export interface FileSymbols {
  readonly definitions: readonly {
    readonly name: string;
    readonly startLine: number;
    readonly endLine: number;
  }[];
  readonly references: readonly {
    readonly name: string;
    readonly line: number;
    readonly kind: "name" | "member" | "type";
  }[];
  readonly imports: readonly SymbolImport[];
}

const MAX_HINTS_PER_HUNK = 10;

type Definition = FileSymbols["definitions"][number];

interface Located {
  readonly file: FileChange;
  readonly hunk: Hunk;
  /** Position in the diff, for a stable order. */
  readonly order: number;
}

/** A hunk that changes a definition. */
interface Change {
  readonly at: Located;
  readonly definition: Definition;
}

/**
 * Hints for the tour and the call chips: a hunk that uses a symbol points to each hunk that
 * changes it. A hunk changes the innermost definitions its added lines fall in, so adding a
 * method changes the method, not every use of its class. It uses a symbol when a reference falls
 * on its added or context lines; references in type positions don't count, because a type
 * annotation isn't something the reader follows.
 *
 * A reference reaches a definition only in its own file or in a file its imports reach, and
 * never across languages or from production code into tests. For languages whose imports aren't
 * read, names match within the language. A reference never reaches the definition it's in, so
 * a method that calls a same-named method elsewhere links there. When several definitions in a
 * file share the name, a reference in that file reaches the one in its own class, if any.
 *
 * A definition changed by several hunks gets one hint, to the first. One hint per symbol and
 * hunk, on its first reference's line. At most 10 hints per hunk, same file first, then by symbol
 * name.
 */
export const buildCallGraphHints = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
): CallGraphHint[] => {
  const hunks = files
    .flatMap((file) => file.hunks.map((hunk) => ({ file, hunk })))
    .map((entry, order): Located => ({ ...entry, order }));

  const changedBy = new Map<string, Change[]>();
  for (const at of hunks) {
    for (const definition of changedDefinitions(at.hunk, symbolsByPath.get(at.file.path))) {
      const changes = changedBy.get(definition.name) ?? [];
      // Hunks are in diff order, so the first change to a definition is the one kept.
      if (!changes.some((change) => change.definition === definition)) {
        changedBy.set(definition.name, [...changes, { at, definition }]);
      }
    }
  }

  const reaches = new Map(
    files.map((file) => [
      file.path,
      (symbolsByPath.get(file.path)?.imports ?? []).flatMap(
        (symbolImport) =>
          (file.language === null ? null : importReach(file.path, file.language, symbolImport)) ??
          [],
      ),
    ]),
  );
  const visible = (from: FileChange, kind: "name" | "member", name: string, to: FileChange) =>
    from.path === to.path ||
    (canLink(from, to) &&
      (!resolvesImports(from.language ?? "") ||
        sharesPackage(from.language ?? "", from.path, to.path) ||
        (reaches.get(from.path) ?? []).some((reach) => reachesBy(reach, kind, name, to.path))));

  return hunks.flatMap((from): CallGraphHint[] => {
    const lines = new Set(newLines(from.hunk, ["add", "context"]));
    // The first line each symbol is used on, per hunk it reaches.
    const firstUse = new Map<Located, Map<string, number>>();
    const own = symbolsByPath.get(from.file.path);
    for (const { name, line, kind } of own?.references ?? []) {
      if (kind === "type" || !lines.has(line)) continue;
      // A method that calls a same-named one on another object delegates; it doesn't recurse.
      const reached = (changedBy.get(name) ?? []).filter(
        ({ at, definition }) =>
          visible(from.file, kind, name, at.file) &&
          !(at.file.path === from.file.path && enclosesLine(definition, line)),
      );
      const local = reached.filter(
        ({ at, definition }) =>
          at.file.path === from.file.path &&
          enclosesLine(containerOf(definition, own?.definitions ?? []), line),
      );
      for (const { at: to } of local.length > 0 ? local : reached) {
        if (to.hunk.id === from.hunk.id) continue;
        const uses = firstUse.get(to) ?? new Map<string, number>();
        const first = uses.get(name);
        if (first === undefined || line < first) uses.set(name, line);
        firstUse.set(to, uses);
      }
    }
    const candidates = [...firstUse].flatMap(([to, uses]) =>
      [...uses].map(([symbol, line]) => ({
        to,
        symbol,
        line,
        sameFile: to.file.path === from.file.path,
      })),
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

/** The innermost definitions the hunk's added lines fall in. */
const changedDefinitions = (hunk: Hunk, symbols: FileSymbols | undefined): Set<Definition> => {
  const changed = new Set<Definition>();
  for (const line of newLines(hunk, ["add"])) {
    const around = (symbols?.definitions ?? []).filter(
      (definition) => line >= definition.startLine && line <= definition.endLine,
    );
    const span = Math.min(...around.map((definition) => definition.endLine - definition.startLine));
    for (const definition of around) {
      if (definition.endLine - definition.startLine === span) changed.add(definition);
    }
  }
  return changed;
};

/** The innermost other definition around a definition, such as a method's class. */
const containerOf = (
  definition: Definition,
  definitions: readonly Definition[],
): Definition | undefined =>
  definitions
    .filter(
      (other) =>
        other !== definition &&
        other.startLine <= definition.startLine &&
        other.endLine >= definition.endLine &&
        other.endLine - other.startLine > definition.endLine - definition.startLine,
    )
    .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];

const enclosesLine = (definition: Definition | undefined, line: number): boolean =>
  definition !== undefined && line >= definition.startLine && line <= definition.endLine;

/** Code links within a language family, and tests point at code, never code at tests. */
const canLink = (from: FileChange, to: FileChange): boolean =>
  from.language !== null &&
  to.language !== null &&
  languageFamily(from.language) === languageFamily(to.language) &&
  (isTestFile(from.path) || !isTestFile(to.path));

const reachesBy = (
  reach: ImportReach,
  kind: "name" | "member",
  name: string,
  path: string,
): boolean =>
  kind === "member"
    ? reach.member(path)
    : (reach.names === null || reach.names.includes(name)) && reach.name(path);

const newLines = (hunk: Hunk, kinds: readonly string[]): number[] =>
  hunk.lines.flatMap((line) =>
    kinds.includes(line.kind) && line.newLine !== null ? [line.newLine] : [],
  );

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
