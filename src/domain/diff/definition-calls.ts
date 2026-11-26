import {
  addedRoutes,
  containerOf,
  type Definition,
  enclosesLine,
  type FileSymbols,
  type Located,
  linking,
  requestLinks,
  shownLines,
} from "./call-graph.ts";
import type { DefinitionCalls, FileChange, HunkPart, PartId } from "./types.ts";

/** What a class is constructed by: the class's own name in Java and C#, and these elsewhere. */
const CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set(["constructor", "__init__"]);

const span = (definition: Definition): number => definition.endLine - definition.startLine;

const innermost = (definitions: readonly Definition[], line: number): Definition | undefined =>
  definitions
    .filter((definition) => enclosesLine(definition, line))
    .sort((a, b) => span(a) - span(b))[0];

/** Whether running a definition runs one written inside it. */
const runs = (around: Definition, inside: Definition): boolean =>
  around.kind === "function" ||
  around.kind === "method" ||
  (around.kind === "class" && (inside.name === around.name || CONSTRUCTOR_NAMES.has(inside.name)));

interface Node {
  readonly name: string;
  readonly partIds: Set<PartId>;
  /** The nodes it calls, with the first line each is called on. */
  readonly calls: Map<Node, number>;
  readonly requests: Map<string, DefinitionCalls["requests"][number]>;
}

/**
 * What each definition the PR changes calls among the others, by the rules of `buildCallGraphHints`
 * but uncapped, and within a part too: each call on a part's added and context lines goes from the
 * innermost definition around it. A function runs the ones written inside it. Naming a class reaches
 * its own lines and its constructor, never its other methods.
 */
export const buildDefinitionCalls = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
  parts: readonly HunkPart[] = [],
): DefinitionCalls[] => {
  const { hunks, changes, targetsOf } = linking(files, symbolsByPath, parts);
  const routes = addedRoutes(hunks);
  const definitionsOf = (path: string) => symbolsByPath.get(path)?.definitions ?? [];

  const nodes = new Map<Definition | PartId, Node>();
  const nodeOf = (key: Definition | PartId, name: string): Node => {
    const known = nodes.get(key);
    if (known !== undefined) return known;
    const node = { name, partIds: new Set<PartId>(), calls: new Map(), requests: new Map() };
    nodes.set(key, node);
    return node;
  };
  const nodeAt = (at: Located, line: number): Node => {
    const around = innermost(definitionsOf(at.file.path), line);
    return around === undefined ? nodeOf(at.piece.id, "") : nodeOf(around, around.name);
  };
  const link = (from: Node, to: Node, line: number) => {
    const known = from.calls.get(to);
    if (from !== to && (known === undefined || line < known)) from.calls.set(to, line);
  };

  for (const from of hunks) {
    const lines = new Set(shownLines(from));
    for (const line of lines) nodeAt(from, line).partIds.add(from.piece.id);
    for (const reference of symbolsByPath.get(from.file.path)?.references ?? []) {
      if (!lines.has(reference.line) || reference.kind === "type") continue;
      for (const { definition } of targetsOf(from, reference)) {
        link(nodeAt(from, reference.line), nodeOf(definition, definition.name), reference.line);
      }
    }
    for (const { line, symbol, toPartId } of requestLinks(from, routes)) {
      nodeAt(from, line).requests.set(`${toPartId} ${symbol}`, { symbol, toPartId });
    }
  }
  const changed = new Set<Node>();
  for (const { at, all, definition } of changes) {
    const node = nodeOf(definition, definition.name);
    changed.add(node);
    for (const { piece } of all) node.partIds.add(piece.id);
    const around = containerOf(definition, definitionsOf(at.file.path));
    if (around !== undefined && runs(around, definition)) {
      link(nodeOf(around, around.name), node, definition.startLine);
    }
  }

  // A definition the PR doesn't change, shown as context, is only here for what it runs.
  const kept = [...nodes.values()].filter(
    (node) =>
      node.partIds.size > 0 && (changed.has(node) || node.calls.size > 0 || node.requests.size > 0),
  );
  const place = new Map(kept.map((node, at) => [node, at]));
  const order = new Map(hunks.map(({ piece, order }) => [piece.id, order]));
  return kept.map((node) => ({
    name: node.name,
    partIds: [...node.partIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    calls: [...node.calls].sort(([, a], [, b]) => a - b).flatMap(([to]) => place.get(to) ?? []),
    requests: [...node.requests.values()],
  }));
};
