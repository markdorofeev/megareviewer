import {
  type ImportReach,
  importReach,
  languageFamily,
  resolvesImports,
  type SymbolImport,
  sharesPackage,
} from "./imports.ts";
import { type Piece, partsByHunk, piecesOf } from "./parts.ts";
import { type Route, requestsOn, routesFor, routesOn } from "./requests.ts";
import { isTestFile } from "./test-files.ts";
import type { CallGraphHint, CallSite, FileChange, Hunk, HunkPart, PartId } from "./types.ts";

/** What hints need from `CodeParser.symbols`, for the head version of a file. */
export interface FileSymbols {
  readonly definitions: readonly {
    readonly name: string;
    readonly startLine: number;
    readonly endLine: number;
  }[];
  readonly references: readonly Reference[];
  readonly imports: readonly SymbolImport[];
}

interface Reference {
  readonly name: string;
  readonly line: number;
  readonly kind: "name" | "member" | "type";
  /** Where each use starts on the line. Without them, a reference makes hints but no call sites. */
  readonly columns?: readonly number[];
}

const MAX_HINTS_PER_HUNK = 10;

type Definition = FileSymbols["definitions"][number];

interface Located {
  readonly file: FileChange;
  readonly piece: Piece;
  /** Position in the diff, for a stable order. */
  readonly order: number;
}

/** A definition the PR changes: `at` is the first piece that changes it, `all` every one. */
interface Change {
  readonly at: Located;
  readonly all: readonly Located[];
  readonly definition: Definition;
}

/**
 * Hints for the tour and the overview: a part that uses a symbol points to each part that
 * changes it. Hunks split into `parts` are read part by part; any other hunk is one part. A part
 * changes the innermost definitions its added lines fall in, so adding a method changes the
 * method, not every use of its class. It uses a symbol when a reference falls on its added or
 * context lines. A use in a type position is a hint with `use: "type"`: it groups
 * code, but a type annotation isn't a call for the reader to follow.
 *
 * A reference reaches a definition only in its own file or in a file its imports reach, and
 * never across languages or from production code into tests. For languages whose imports aren't
 * read, names match within the language. A reference never reaches the definition it's in, so
 * a method that calls a same-named method elsewhere links there. When several definitions in a
 * file share the name, a reference in that file reaches the one in its own class, if any.
 *
 * A definition changed by several hunks gets one hint, to the first. One hint per symbol and
 * hunk, on its first reference's line. At most 10 calls and 10 type uses per hunk, same file
 * first, then by symbol name. Calls come before type uses.
 *
 * Requests come last: a part that sends an HTTP request points to each part whose added lines
 * declare a route serving it (see `routesFor`), across languages but never from production code
 * into tests. Both ends are code, in a language the parser knows. At most 10 per part, by line.
 */
export const buildCallGraphHints = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
  parts: readonly HunkPart[] = [],
): CallGraphHint[] => {
  const { hunks, targetsOf } = linking(files, symbolsByPath, parts);
  const routes = hunks.flatMap((at) =>
    at.file.language === null
      ? []
      : at.piece.hunk.lines.flatMap((line) =>
          line.kind === "add" ? routesOn(line.text).map((route) => ({ ...route, at })) : [],
        ),
  );

  return hunks.flatMap((from): CallGraphHint[] => {
    const requests = requestHints(from, routes);
    const lines = new Set(newLines(from.piece.hunk, ["add", "context"]));
    // The first line each symbol is used on, per use and hunk it reaches.
    const firstUse = { call: new Map<Located, Map<string, number>>(), type: new Map() };
    for (const reference of symbolsByPath.get(from.file.path)?.references ?? []) {
      if (!lines.has(reference.line)) continue;
      const { name, line, kind } = reference;
      const byUse = firstUse[kind === "type" ? "type" : "call"];
      for (const { at: to } of targetsOf(from, reference)) {
        if (to.piece.id === from.piece.id) continue;
        const uses = byUse.get(to) ?? new Map<string, number>();
        const first = uses.get(name);
        if (first === undefined || line < first) uses.set(name, line);
        byUse.set(to, uses);
      }
    }
    const hints = (use: "call" | "type"): CallGraphHint[] =>
      [...firstUse[use]]
        .flatMap(([to, uses]) =>
          [...uses]
            // A symbol the hunk calls is a call, even where it's also named as a type.
            .filter(([symbol]) => use === "call" || !firstUse.call.get(to)?.has(symbol))
            .map(([symbol, line]) => ({
              to,
              symbol,
              line,
              sameFile: to.file.path === from.file.path,
            })),
        )
        .sort(
          (a, b) =>
            Number(b.sameFile) - Number(a.sameFile) ||
            compare(a.symbol, b.symbol) ||
            a.to.order - b.to.order,
        )
        .slice(0, MAX_HINTS_PER_HUNK)
        .map(({ to, symbol, line }) => ({
          fromPartId: from.piece.id,
          toPartId: to.piece.id,
          symbol,
          line,
          use,
        }));
    return [...hints("call"), ...hints("type"), ...requests];
  });
};

/**
 * Every use of a name, on a part's added or context lines, that reaches a definition the PR
 * changes, by the rules of `buildCallGraphHints`: one site per use, reaching every part that changes
 * a definition it reaches, in diff order, except its own part. Calls and type uses alike; uses
 * without columns make none. In diff order, then by line and column.
 */
export const buildCallSites = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
  parts: readonly HunkPart[] = [],
): CallSite[] => {
  const { hunks, targetsOf } = linking(files, symbolsByPath, parts);
  return hunks.flatMap((from): CallSite[] => {
    const lines = new Set(newLines(from.piece.hunk, ["add", "context"]));
    return (symbolsByPath.get(from.file.path)?.references ?? [])
      .filter((reference) => lines.has(reference.line))
      .flatMap((reference) => {
        const reached = [
          ...new Set(targetsOf(from, reference).flatMap((change) => change.all)),
        ].filter((to) => to.piece.id !== from.piece.id);
        if (reached.length === 0) return [];
        const toPartIds = [
          ...new Set(reached.sort((a, b) => a.order - b.order).map((to) => to.piece.id)),
        ];
        return (reference.columns ?? []).map((column) => ({
          partId: from.piece.id,
          path: from.file.path,
          line: reference.line,
          column,
          length: reference.name.length,
          symbol: reference.name,
          toPartIds,
        }));
      })
      .sort((a, b) => a.line - b.line || a.column - b.column);
  });
};

/**
 * The pieces of the PR in diff order, and what a reference in one of them reaches: definitions the
 * PR changes, in its own file or in a file its imports reach, and in its own class when its file
 * has several of that name.
 */
const linking = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
  parts: readonly HunkPart[],
): {
  readonly hunks: readonly Located[];
  readonly targetsOf: (from: Located, reference: Reference) => readonly Change[];
} => {
  const byHunk = partsByHunk(parts);
  const hunks = files
    .flatMap((file) => piecesOf(file, byHunk).map((piece) => ({ file, piece })))
    .map((entry, order): Located => ({ ...entry, order }));

  const changedBy = new Map<string, Change[]>();
  for (const at of hunks) {
    for (const definition of changedDefinitions(at.piece.hunk, symbolsByPath.get(at.file.path))) {
      const changes = changedBy.get(definition.name) ?? [];
      const known = changes.find((change) => change.definition === definition);
      // Hunks are in diff order, so the first change to a definition is its `at`.
      changedBy.set(
        definition.name,
        known === undefined
          ? [...changes, { at, all: [at], definition }]
          : changes.map((change) =>
              change === known ? { ...known, all: [...known.all, at] } : change,
            ),
      );
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

  const targetsOf = (from: Located, { name, line, kind }: Reference): readonly Change[] => {
    const own = symbolsByPath.get(from.file.path);
    // A method that calls a same-named one on another object delegates; it doesn't recurse.
    const reached = (changedBy.get(name) ?? []).filter(
      ({ at, definition }) =>
        visible(from.file, kind === "member" ? "member" : "name", name, at.file) &&
        !(at.file.path === from.file.path && enclosesLine(definition, line)),
    );
    const local = reached.filter(
      ({ at, definition }) =>
        at.file.path === from.file.path &&
        enclosesLine(containerOf(definition, own?.definitions ?? []), line),
    );
    return local.length > 0 ? local : reached;
  };
  return { hunks, targetsOf };
};

/** The requests a part sends, each to the parts that add a route serving it. */
const requestHints = (
  from: Located,
  routes: readonly (Route & { readonly at: Located })[],
): CallGraphHint[] => {
  if (from.file.language === null) return [];
  const first = new Map<string, CallGraphHint>();
  for (const line of from.piece.hunk.lines) {
    if (line.kind === "del" || line.newLine === null) continue;
    for (const request of requestsOn(line.text, from.file.path)) {
      for (const route of routesFor(request, routes)) {
        const to = route.at;
        // Production code never links into tests.
        if (
          to.piece.id === from.piece.id ||
          (isTestFile(to.file.path) && !isTestFile(from.file.path))
        )
          continue;
        const symbol = `${route.method} ${route.path}`;
        const key = `${to.piece.id} ${symbol}`;
        if (!first.has(key)) {
          first.set(key, {
            fromPartId: from.piece.id,
            toPartId: to.piece.id,
            symbol,
            line: line.newLine,
            use: "request",
          });
        }
      }
    }
  }
  return [...first.values()].slice(0, MAX_HINTS_PER_HUNK);
};

/** Each part's changed definitions, innermost, by name: what the tour reads entry points from. */
export const changedDefinitionNames = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
  parts: readonly HunkPart[] = [],
): ReadonlyMap<PartId, readonly string[]> => {
  const byHunk = partsByHunk(parts);
  return new Map(
    files.flatMap((file) =>
      piecesOf(file, byHunk).map(({ id, hunk }) => [
        id,
        [...changedDefinitions(hunk, symbolsByPath.get(file.path))].map(
          (definition) => definition.name,
        ),
      ]),
    ),
  );
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
