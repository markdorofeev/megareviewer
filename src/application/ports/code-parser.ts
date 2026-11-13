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
  /** Where each use of the name with this kind starts on the line, in UTF-16 units from 0. */
  readonly columns: readonly number[];
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
   * Every syntax node in pre-order, leaves with their text, each inner node closed by an end
   * marker. Equal lists mean the same tree, ignoring whitespace.
   */
  syntaxNodes(source: string, language: string): Promise<Result<Token[], CodeParserError>>;
  symbols(source: string, language: string): Promise<Result<CodeSymbols, CodeParserError>>;
}
