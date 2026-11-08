import type { FileSymbols } from "./call-graph.ts";
import { importReach, languageFamily, resolvesImports, sharesPackage } from "./imports.ts";
import { type DefinitionSpan, partsByHunk, piecesOf } from "./parts.ts";
import { isTestFile } from "./test-files.ts";
import type { FileChange, HunkPart, PartId, UnchangedCallers, UnchangedUse } from "./types.ts";

/** At most this many uses per changed definition; the rest are counted. */
export const MAX_UNCHANGED_USES = 50;
const EXCERPT_LINES_AROUND = 2;

/** A definition the PR changes that existed before it: what an unchanged caller may call. */
export interface ChangedDefinition {
  readonly partId: PartId;
  readonly path: string;
  readonly name: string;
}

/** A file the PR doesn't change, in a language whose imports are read, parsed at the head commit. */
export interface UnchangedFile {
  readonly path: string;
  readonly language: string;
  readonly content: string;
  readonly symbols: FileSymbols;
}

const holds = (definition: DefinitionSpan, line: number): boolean =>
  line >= definition.startLine && line <= definition.endLine;

const innermost = (
  definitions: readonly DefinitionSpan[],
  line: number,
): DefinitionSpan | undefined =>
  definitions
    .filter((definition) => holds(definition, line))
    .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];

/**
 * The definitions whose own lines the PR adds or deletes, and which were in the base file: an added
 * line belongs to the innermost head definition around it, a deleted one to the innermost base
 * definition, so a class whose methods the PR adds or changes isn't changed itself. Blank lines
 * don't count. One per file and name, from the first part in diff order that changes it.
 */
export const changedDefinitions = (
  files: readonly FileChange[],
  definitions: ReadonlyMap<
    string,
    { readonly head: readonly DefinitionSpan[]; readonly base: readonly DefinitionSpan[] }
  >,
  parts: readonly HunkPart[] = [],
): ChangedDefinition[] => {
  const byHunk = partsByHunk(parts);
  const changed: ChangedDefinition[] = [];
  for (const file of files) {
    const spans = definitions.get(file.path);
    if (file.status === "added" || spans === undefined) continue;
    const before = new Set(spans.base.map((definition) => definition.name));
    for (const piece of piecesOf(file, byHunk)) {
      for (const line of piece.hunk.lines) {
        if (line.kind === "context" || line.text.trim() === "") continue;
        const definition =
          line.kind === "add"
            ? line.newLine === null
              ? undefined
              : innermost(spans.head, line.newLine)
            : line.oldLine === null
              ? undefined
              : innermost(spans.base, line.oldLine);
        if (
          definition !== undefined &&
          before.has(definition.name) &&
          !changed.some((known) => known.path === file.path && known.name === definition.name)
        ) {
          changed.push({ partId: piece.id, path: file.path, name: definition.name });
        }
      }
    }
  }
  return changed;
};

/** Whether a file could call into another: one language family, and code never into tests. */
const canCall = (from: { path: string; language: string }, to: FileChange): boolean =>
  to.language !== null &&
  languageFamily(from.language) === languageFamily(to.language) &&
  (isTestFile(from.path) || !isTestFile(to.path));

/**
 * Uses outside the PR of the definitions it changes: calls, and type uses unless the changed file is
 * generated. A use counts only where `buildCallGraphHints` would link it: in a file whose imports
 * reach the changed file (or, in Go and Java, in its package), within its language family, and
 * never from code into tests. Languages whose imports aren't read are left out, since matching
 * names alone finds mostly other things with the same name. A name the file defines itself is its
 * own. Per definition, code comes before tests, then by path and line; at most 50 uses, the rest
 * counted in `more`.
 */
export const findUnchangedCallers = (
  files: readonly FileChange[],
  changed: readonly ChangedDefinition[],
  unchanged: readonly UnchangedFile[],
  generated: ReadonlySet<string>,
): UnchangedCallers[] => {
  const changedPaths = new Set(files.map((file) => file.path));
  const fileOf = new Map(files.map((file) => [file.path, file]));
  const byName = new Map<string, { definition: ChangedDefinition; file: FileChange }[]>();
  for (const definition of changed) {
    const file = fileOf.get(definition.path);
    if (file === undefined) continue;
    byName.set(definition.name, [...(byName.get(definition.name) ?? []), { definition, file }]);
  }

  const usesOf = new Map<ChangedDefinition, Map<string, UnchangedUse>>();
  for (const caller of unchanged) {
    if (changedPaths.has(caller.path) || !resolvesImports(caller.language)) continue;
    const reaches = caller.symbols.imports.flatMap(
      (symbolImport) => importReach(caller.path, caller.language, symbolImport) ?? [],
    );
    const own = new Set(caller.symbols.definitions.map((definition) => definition.name));
    const lines = caller.content.split(/\r?\n/);
    for (const { name, line, kind } of caller.symbols.references) {
      if (kind !== "member" && own.has(name)) continue;
      for (const { definition, file } of byName.get(name) ?? []) {
        const visible =
          canCall(caller, file) &&
          (sharesPackage(caller.language, caller.path, file.path) ||
            reaches.some((reach) =>
              kind === "member"
                ? reach.member(file.path)
                : (reach.names === null || reach.names.includes(name)) && reach.name(file.path),
            ));
        if (!visible || (kind === "type" && generated.has(file.path))) continue;
        const uses = usesOf.get(definition) ?? new Map<string, UnchangedUse>();
        const key = `${caller.path}:${line}`;
        const use = kind === "type" ? "type" : "call";
        // A line that calls a definition and names it as a type is a call.
        if (uses.get(key)?.use !== "call") {
          uses.set(key, { path: caller.path, line, use, excerpt: excerpt(lines, line) });
        }
        usesOf.set(definition, uses);
      }
    }
  }

  return changed.flatMap((definition) => {
    const uses = [...(usesOf.get(definition)?.values() ?? [])].sort(
      (a, b) =>
        Number(isTestFile(a.path)) - Number(isTestFile(b.path)) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line),
    );
    return uses.length === 0
      ? []
      : [
          {
            partId: definition.partId,
            symbol: definition.name,
            uses: uses.slice(0, MAX_UNCHANGED_USES),
            more: Math.max(0, uses.length - MAX_UNCHANGED_USES),
          },
        ];
  });
};

/** The lines around a use, at most two either side. */
const excerpt = (lines: readonly string[], line: number): UnchangedUse["excerpt"] => {
  const start = Math.max(1, line - EXCERPT_LINES_AROUND);
  const end = Math.min(lines.length, line + EXCERPT_LINES_AROUND);
  return { start, lines: lines.slice(start - 1, end) };
};

/** Whether a file's text names any of the definitions, so it's worth parsing. */
export const mentionsAny = (content: string, names: ReadonlySet<string>): boolean => {
  for (const word of content.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (names.has(word[0])) return true;
  }
  return false;
};
