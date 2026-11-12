import type { Node, Query, Tree } from "web-tree-sitter";
import type {
  CodeSymbols,
  SymbolDefinition,
  SymbolImport,
  SymbolReference,
} from "../../application/ports/index.ts";

const KINDS: ReadonlySet<string> = new Set(["function", "method", "class", "type", "variable"]);
const REFERENCE_KINDS: ReadonlySet<string> = new Set(["name", "member", "type"]);

const isKind = (kind: string): kind is SymbolDefinition["kind"] => KINDS.has(kind);
const isReferenceKind = (kind: string): kind is SymbolReference["kind"] =>
  REFERENCE_KINDS.has(kind);

const startLine = (node: Node): number => node.startPosition.row + 1;

// A node that ends at column 0 ends with a newline, which isn't on the next line.
const endLine = (node: Node): number => {
  const { row, column } = node.endPosition;
  return column === 0 && row > node.startPosition.row ? row : row + 1;
};

/**
 * Definitions, references and imports found by a symbols query.
 *
 * - A definition pattern captures the whole definition as `@definition.<kind>` and its name as
 *   `@name`.
 * - A reference pattern captures the identifier as `@reference.<kind>`: name, member or type.
 * - An import pattern captures the module as `@import.module`, and each imported name as
 *   `@import.name`. A match without names imports the whole module.
 *
 * When definition or reference patterns overlap, the first in the query wins. Captures starting
 * with `_` are only for predicates.
 */
export const findSymbols = (tree: Tree, query: Query): CodeSymbols => {
  const definitions = new Map<number, { patternIndex: number; definition: SymbolDefinition }>();
  const references = new Map<number, { patternIndex: number; reference: SymbolReference }>();
  const imports = new Map<number, { module: string; names: string[] | null }>();

  for (const match of query.matches(tree.rootNode)) {
    const captures = match.captures.filter((capture) => !capture.name.startsWith("_"));
    const name = captures.find((capture) => capture.name === "name")?.node;
    const whole = captures.find((capture) => capture.name.startsWith("definition."));
    const reference = captures.find((capture) => capture.name.startsWith("reference."));
    const module = captures.find((capture) => capture.name === "import.module")?.node;
    if (name !== undefined && whole !== undefined) {
      const kind = whole.name.slice("definition.".length);
      if (!isKind(kind)) throw new Error(`unknown definition kind in query: ${whole.name}`);
      const existing = definitions.get(name.startIndex);
      if (existing !== undefined && existing.patternIndex < match.patternIndex) continue;
      definitions.set(name.startIndex, {
        patternIndex: match.patternIndex,
        definition: {
          name: name.text,
          kind,
          startLine: startLine(whole.node),
          endLine: endLine(whole.node),
        },
      });
    } else if (reference !== undefined) {
      const kind = reference.name.slice("reference.".length);
      if (!isReferenceKind(kind)) throw new Error(`unknown reference kind: ${reference.name}`);
      const existing = references.get(reference.node.startIndex);
      if (existing !== undefined && existing.patternIndex < match.patternIndex) continue;
      references.set(reference.node.startIndex, {
        patternIndex: match.patternIndex,
        reference: {
          name: reference.node.text,
          line: startLine(reference.node),
          kind,
          columns: [reference.node.startPosition.column],
        },
      });
    } else if (module !== undefined) {
      const names = captures.flatMap((capture) =>
        capture.name === "import.name" ? [capture.node.text] : [],
      );
      const existing = imports.get(module.startIndex);
      const merged =
        existing === undefined
          ? names.length === 0
            ? null
            : names
          : existing.names === null || names.length === 0
            ? null
            : [...existing.names, ...names];
      imports.set(module.startIndex, { module: module.text, names: merged });
    } else {
      throw new Error(
        `query pattern ${match.patternIndex} captures no definition, reference or import`,
      );
    }
  }

  // One reference per name, kind and line, with the column of each use on it.
  const unique = new Map<string, SymbolReference>();
  for (const [position, { reference }] of references) {
    // A type's name is a type identifier too; it doesn't reference itself.
    if (definitions.has(position)) continue;
    const key = `${reference.line}:${reference.name}:${reference.kind}`;
    const existing = unique.get(key);
    unique.set(
      key,
      existing === undefined
        ? reference
        : {
            ...existing,
            columns: [...existing.columns, ...reference.columns].sort((a, b) => a - b),
          },
    );
  }
  return {
    definitions: [...definitions.values()]
      .map(({ definition }) => definition)
      .sort((a, b) => a.startLine - b.startLine || compare(a.name, b.name)),
    references: [...unique.values()].sort(
      (a, b) => a.line - b.line || compare(a.name, b.name) || compare(a.kind, b.kind),
    ),
    imports: [...imports.entries()]
      .sort(([a], [b]) => a - b)
      .map(
        ([, { module, names }]): SymbolImport => ({
          module,
          names: names === null ? null : [...new Set(names)],
        }),
      ),
  };
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
