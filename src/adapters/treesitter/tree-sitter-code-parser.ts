import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Language, Parser, Query, type Tree } from "web-tree-sitter";
import type { CodeParser, CodeParserError } from "../../application/ports/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { commentLines } from "./comments.ts";
import { type LanguageSpec, languageSpecFor, languageSpecNamed } from "./languages.ts";
import { findSymbols } from "./symbols.ts";
import { syntaxNodes } from "./syntax-nodes.ts";

export interface TreeSitterCodeParserOptions {
  /** Holds `web-tree-sitter.wasm`, a `tree-sitter-<language>.wasm` per language, and `queries/`. */
  readonly grammarsDir: string;
  readonly maxFileBytes?: number;
}

interface LoadedLanguage {
  readonly parser: Parser;
  readonly symbolsQuery: Query;
}

// The runtime is one WASM module per process, so the first parser's grammarsDir provides it.
let runtime: Promise<void> | null = null;

export const createTreeSitterCodeParser = async (
  options: TreeSitterCodeParserOptions,
): Promise<CodeParser> => {
  const { grammarsDir, maxFileBytes = 1_000_000 } = options;
  runtime ??= Parser.init({ locateFile: (file: string) => join(grammarsDir, file) });
  await runtime;

  const loaded = new Map<string, Promise<LoadedLanguage>>();
  const load = (spec: LanguageSpec): Promise<LoadedLanguage> => {
    const cached = loaded.get(spec.name);
    if (cached !== undefined) return cached;
    const loading = loadLanguage(grammarsDir, spec);
    loaded.set(spec.name, loading);
    return loading;
  };

  /** Parses `source`, hands the tree to `use`, and frees the tree: WASM memory isn't collected. */
  const withTree = async <T>(
    source: string,
    language: string,
    use: (tree: Tree, loaded: LoadedLanguage) => T,
  ): Promise<Result<T, CodeParserError>> => {
    const spec = languageSpecNamed(language);
    if (spec === null) {
      return err({ kind: "unsupported-language", message: `no grammar for ${language}` });
    }
    if (Buffer.byteLength(source, "utf8") > maxFileBytes) {
      return err({ kind: "unsupported-language", message: "file too large to parse" });
    }
    const languageParser = await load(spec);
    const tree = languageParser.parser.parse(source);
    if (tree === null) return err({ kind: "parse-error", message: "parsing was cancelled" });
    try {
      if (tree.rootNode.hasError) {
        return err({ kind: "parse-error", message: "the file has a syntax error" });
      }
      return ok(use(tree, languageParser));
    } finally {
      tree.delete();
    }
  };

  return {
    languageFor: (path) => languageSpecFor(path)?.name ?? null,
    syntaxNodes: (source, language) =>
      withTree(source, language, (tree) => syntaxNodes(tree, source)),
    symbols: (source, language) =>
      withTree(source, language, (tree, { symbolsQuery }) => ({
        ...findSymbols(tree, symbolsQuery),
        commentLines: commentLines(tree, source),
      })),
  };
};

const loadLanguage = async (grammarsDir: string, spec: LanguageSpec): Promise<LoadedLanguage> => {
  const language = await Language.load(
    await readFile(join(grammarsDir, `tree-sitter-${spec.name}.wasm`)),
  );
  const queries = await Promise.all(
    spec.queries.map((name) => readFile(join(grammarsDir, "queries", `${name}.scm`), "utf8")),
  );
  const parser = new Parser();
  parser.setLanguage(language);
  return { parser, symbolsQuery: new Query(language, queries.join("\n")) };
};
