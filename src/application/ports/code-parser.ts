import type { SymbolImport } from "../../domain/diff/index.ts";
import type { Result } from "../../domain/shared/index.ts";

export type { SymbolImport };

export interface Token {
  readonly type: string;
  readonly text: string;
}

export interface SymbolDefinition {
  readonly name: string;
  readonly kind: "function" | "method" | "class" | "type" | "variable";
  readonly startLine: number;
  readonly endLine: number;
}

export interface SymbolReference {
  readonly name: string;
  readonly line: number;
  /**
   * How the name is used: on its own (called, constructed, a component, or the object of a member
   * access), as a member after a dot, or as a type.
   */
  readonly kind: "name" | "member" | "type";
}

export interface CodeSymbols {
  readonly definitions: SymbolDefinition[];
  readonly references: SymbolReference[];
  /** Empty for languages whose imports aren't read. */
  readonly imports: SymbolImport[];
}

export interface CodeParserError {
  readonly kind: "parse-error" | "unsupported-language";
  readonly message: string;
}

export interface CodeParser {
  /** A tree-sitter language name for the path, or null when none is supported. */
  languageFor(path: string): string | null;
  /**
   * Pre-order list of every syntax node, named and anonymous. Leaves carry their source text;
   * inner nodes have text "" and are closed by an end marker `{ type: "", text: "" }` after their
   * children. Source text no node covers, other than whitespace, is listed as `{ type: "", text }`.
   * No positions. Two sources with equal lists have the same syntax tree ignoring whitespace.
   * Leaves alone aren't enough, and neither is node order: dedenting a Python statement out of an
   * `if` keeps every leaf and every node but changes the tree.
   */
  syntaxNodes(source: string, language: string): Promise<Result<Token[], CodeParserError>>;
  symbols(source: string, language: string): Promise<Result<CodeSymbols, CodeParserError>>;
}
