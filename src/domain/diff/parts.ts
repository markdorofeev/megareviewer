import type { CallGraphHint, DiffLine, FileChange, Hunk, HunkPart } from "./types.ts";
import { HunkId, PartId } from "./types.ts";

/** A definition's name and new- or old-side lines, as `CodeParser.symbols` reports them. */
export interface DefinitionSpan {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** A file's definitions in its head and base versions. */
export interface FileDefinitions {
  readonly head: readonly DefinitionSpan[];
  readonly base: readonly DefinitionSpan[];
}

/** The hunk a part is of: the part ID without its ".n". */
export const hunkIdOf = (id: PartId): HunkId => HunkId.parse(id.replace(/\.[0-9]+$/, ""));

/** Part `n` (from 1) of a split hunk. */
export const partId = (hunkId: HunkId, n: number): PartId => PartId.parse(`${hunkId}.${n}`);

const holds = (definition: DefinitionSpan, line: number): boolean =>
  line >= definition.startLine && line <= definition.endLine;

const span = (definition: DefinitionSpan): number => definition.endLine - definition.startLine;

/**
 * Where a hunk is cut on one side: the outermost definitions among those that start or end inside
 * the hunk's lines. A definition that holds every line, like the class around a block of methods,
 * doesn't cut, so what's inside it does.
 */
const cutters = (
  definitions: readonly DefinitionSpan[],
  lines: readonly number[],
): DefinitionSpan[] => {
  if (lines.length === 0) return [];
  const first = Math.min(...lines);
  const last = Math.max(...lines);
  const inside = definitions.filter(
    (definition) =>
      definition.startLine <= last &&
      definition.endLine >= first &&
      !(definition.startLine <= first && definition.endLine >= last),
  );
  return inside.filter(
    (definition) =>
      !inside.some(
        (other) =>
          other !== definition &&
          other.startLine <= definition.startLine &&
          other.endLine >= definition.endLine &&
          span(other) > span(definition),
      ),
  );
};

const changes = (line: DiffLine): boolean => line.kind !== "context";

interface Run {
  start: number;
  end: number;
  key: string;
  /** The names of the definitions its lines change, in order. */
  names: string[];
}

/**
 * A hunk's candidate parts, one per definition it changes, or none when it changes one or none.
 *
 * The hunk is cut at the outermost definitions that start or end inside it. An added line goes
 * with the head definition around it, a deleted line with the base one, so a deleted definition
 * stays where it was and lines keep their diff order. A definition is known by its name on both
 * sides, so a changed function is one part. Unchanged lines inside a changed definition go with
 * it; any other line (an unchanged stretch, a decorator, a comment, an import) goes with the next
 * part, or the previous one at the end. A part always adds or deletes a line.
 */
export const splitByDefinition = (hunk: Hunk, definitions: FileDefinitions): HunkPart[] => {
  const head = cutters(
    definitions.head,
    hunk.lines.flatMap((line) => line.newLine ?? []),
  );
  const base = cutters(
    definitions.base,
    hunk.lines.flatMap((line) => line.oldLine ?? []),
  );
  const around = (cut: readonly DefinitionSpan[], line: number | null): string | null =>
    line === null ? null : (cut.find((definition) => holds(definition, line))?.name ?? null);
  // A base and a head definition that share an unchanged line are one, such as a renamed method.
  const same = new Map<string, string>();
  const root = (name: string): string => {
    const parent = same.get(name);
    return parent === undefined || parent === name ? name : root(parent);
  };
  for (const line of hunk.lines) {
    const [inHead, inBase] = [around(head, line.newLine), around(base, line.oldLine)];
    if (line.kind === "context" && inHead !== null && inBase !== null) {
      same.set(root(inBase), root(inHead));
    }
  }
  const nameOf = (line: DiffLine): string | null =>
    line.kind === "del" ? around(base, line.oldLine) : around(head, line.newLine);
  const changedKey = (line: DiffLine): string | null => {
    const name = changes(line) ? nameOf(line) : null;
    return name === null ? null : root(name);
  };
  const changed = new Set(hunk.lines.flatMap((line) => changedKey(line) ?? []));
  const keyOf = (line: DiffLine): string | null => {
    if (changes(line)) return changedKey(line);
    const name = around(head, line.newLine) ?? around(base, line.oldLine);
    return name !== null && changed.has(root(name)) ? root(name) : null;
  };

  // Runs of one key; a line without one joins the next run.
  const runs: Run[] = [];
  let pending = 0;
  hunk.lines.forEach((line, at) => {
    const key = keyOf(line);
    if (key === null) return;
    const name = changes(line) ? nameOf(line) : null;
    const last = runs.at(-1);
    if (last !== undefined && last.key === key) {
      last.end = at + 1;
      if (name !== null) last.names.push(name);
    } else {
      runs.push({ start: pending, end: at + 1, key, names: name === null ? [] : [name] });
      if (last !== undefined) last.end = pending;
    }
    pending = at + 1;
  });
  const last = runs.at(-1);
  if (last !== undefined) last.end = hunk.lines.length;

  // A run that changes nothing joins the next one, or the previous one at the end.
  const merged: Run[] = [];
  let carried: Run | null = null;
  for (const run of runs) {
    const current: Run =
      carried === null
        ? run
        : { ...run, start: carried.start, names: [...carried.names, ...run.names] };
    carried = null;
    if (hunk.lines.slice(current.start, current.end).some(changes)) merged.push(current);
    else carried = current;
  }
  const previous = merged.at(-1);
  if (carried !== null && previous !== undefined) previous.end = carried.end;
  if (merged.length < 2) return [];
  return merged.map((run, at) => ({
    id: partId(hunk.id, at + 1),
    hunkId: hunk.id,
    start: run.start,
    end: run.end,
    definitions: [...new Set(run.names)],
  }));
};

/**
 * Every hunk's candidate parts, in diff order. A hunk in `unsplit` (one with a mechanical proof,
 * which is about the whole hunk) and a file without definitions aren't split.
 */
export const splitHunks = (
  files: readonly FileChange[],
  definitionsByPath: ReadonlyMap<string, FileDefinitions>,
  unsplit: ReadonlySet<HunkId>,
): HunkPart[] =>
  files.flatMap((file) => {
    const definitions = definitionsByPath.get(file.path);
    if (definitions === undefined) return [];
    return file.hunks.flatMap((hunk) =>
      unsplit.has(hunk.id) ? [] : splitByDefinition(hunk, definitions),
    );
  });

/** A part's lines as a hunk of their own, with the hunk's ID and the part's line numbers. */
export const partHunk = (hunk: Hunk, part: Pick<HunkPart, "start" | "end">): Hunk => {
  const before = hunk.lines.slice(0, part.start);
  const lines = hunk.lines.slice(part.start, part.end);
  const count = (of: readonly DiffLine[], kind: "add" | "del") =>
    of.filter((line) => line.kind !== kind).length;
  const oldLines = count(lines, "add");
  const newLines = count(lines, "del");
  // As in a diff, an empty side starts at the line before where it would be.
  const start = (hunkStart: number, hunkLines: number, skipped: number, length: number) =>
    Math.max(hunkStart + (hunkLines === 0 ? 1 : 0) + skipped - (length === 0 ? 1 : 0), 0);
  return {
    ...hunk,
    oldStart: start(hunk.oldStart, hunk.oldLines, count(before, "add"), oldLines),
    oldLines,
    newStart: start(hunk.newStart, hunk.newLines, count(before, "del"), newLines),
    newLines,
    lines,
  };
};

/** A hunk, or a part of a split one, with its own lines: what hints and the tour are built on. */
export interface Piece {
  readonly id: PartId;
  /** The part's lines as a hunk, which keeps the hunk's ID. */
  readonly hunk: Hunk;
}

/** Each split hunk's parts, in order. */
export const partsByHunk = (
  parts: readonly HunkPart[],
): ReadonlyMap<HunkId, readonly HunkPart[]> => {
  const byHunk = new Map<HunkId, HunkPart[]>();
  for (const part of parts) byHunk.set(part.hunkId, [...(byHunk.get(part.hunkId) ?? []), part]);
  return byHunk;
};

/** A file's hunks, each split one replaced by its parts. */
export const piecesOf = (
  file: FileChange,
  byHunk: ReadonlyMap<HunkId, readonly HunkPart[]>,
): Piece[] =>
  file.hunks.flatMap((hunk) => {
    const parts = byHunk.get(hunk.id);
    return parts === undefined
      ? [{ id: hunk.id, hunk }]
      : parts.map((part) => ({ id: part.id, hunk: partHunk(hunk, part) }));
  });

/**
 * Hints with each part renamed by `rename`, such as to its hunk: a hint within one part is
 * dropped, and of hints that become the same, the one on the first line is kept, in its place.
 */
export const renameHints = (
  hints: readonly CallGraphHint[],
  rename: (id: PartId) => PartId,
): CallGraphHint[] => {
  const kept = new Map<string, CallGraphHint>();
  for (const hint of hints) {
    const fromPartId = rename(hint.fromPartId);
    const toPartId = rename(hint.toPartId);
    if (fromPartId === toPartId) continue;
    const key = `${fromPartId}>${toPartId}:${hint.use}:${hint.symbol}`;
    const known = kept.get(key);
    if (known === undefined || hint.line < known.line) {
      kept.set(key, { ...hint, fromPartId, toPartId });
    }
  }
  return [...kept.values()];
};
