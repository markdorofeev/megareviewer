import type { LanguageRegistration } from "shiki/core";
import type { FileChange } from "../../../../src/domain/diff/index.ts";
import type { DisplayLine } from "./lines.ts";

// Which Shiki grammar a file needs, and the code a hunk's two sides make.

type LanguageModule = Promise<{ readonly default: readonly LanguageRegistration[] }>;

// Java's grammar gives an UPPER_CASE name no scope of its own, so `MAX_ITEMS` and `HttpStatus.OK`
// read as variables. TypeScript's grammar, IntelliJ and GitHub all color them as constants. The
// match is the name's shape, as theirs is, so an all-caps type such as `UUID` is one too.
const JAVA_CONSTANTS: LanguageRegistration = {
  name: "java-constants",
  scopeName: "source.java.constants",
  injectTo: ["source.java"],
  injectionSelector: "L:source.java -comment -string -meta.import -meta.package",
  repository: {},
  patterns: [
    { match: "(?<![\\w$])[A-Z][A-Z0-9_]*[A-Z0-9](?![\\w$])", name: "variable.other.constant.java" },
    // After a dot the grammar's own rule starts at the dot, before the name.
    {
      match: "(\\.)\\s*([A-Z][A-Z0-9_]*[A-Z0-9])(?![\\w$]|\\s*\\()",
      captures: {
        1: { name: "punctuation.separator.period.java" },
        2: { name: "variable.other.constant.java" },
      },
    },
  ],
};

// Each grammar is its own chunk, loaded the first time a file needs it.
export const GRAMMARS: Readonly<Record<string, () => LanguageModule>> = {
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: async () => ({
    default: [...(await import("shiki/langs/java.mjs")).default, JAVA_CONSTANTS],
  }),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

/** tree-sitter names that differ from Shiki's; the others are the same. */
const TREE_SITTER_NAMES: Readonly<Record<string, string>> = { c_sharp: "csharp" };

const EXTENSIONS: Readonly<Record<string, string>> = {
  bash: "shellscript",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  diff: "diff",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  patch: "diff",
  php: "php",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
};

const BASENAMES: Readonly<Record<string, string>> = {
  Dockerfile: "docker",
  GNUmakefile: "make",
  Makefile: "make",
};

/** The Shiki language for a file: from its tree-sitter language, else its name. null: plain text. */
export const languageOf = (file: Pick<FileChange, "path" | "language">): string | null => {
  const fromParser =
    file.language === null ? null : (TREE_SITTER_NAMES[file.language] ?? file.language);
  if (fromParser !== null && fromParser in GRAMMARS) return fromParser;
  const basename = file.path.slice(file.path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  const extension = dot > 0 ? basename.slice(dot + 1).toLowerCase() : "";
  return BASENAMES[basename] ?? EXTENSIONS[extension] ?? null;
};

/**
 * The hunk's old text (context and deleted lines) and new text (context and added lines). Each
 * side is highlighted whole, so a string or comment spanning several lines colors correctly.
 */
export const hunkSides = (
  lines: readonly DisplayLine[],
): { readonly old: string; readonly new: string } => ({
  old: sideText(lines, "add"),
  new: sideText(lines, "del"),
});

const sideText = (lines: readonly DisplayLine[], other: "add" | "del"): string =>
  lines
    .filter(({ line }) => line.kind !== other)
    .map(({ text }) => text)
    .join("\n");

// Openers as deep as the piece's first line, so each closing brace in it closes what it would in
// the file, and the lines after it are read in the class or method body they're in.
const javaClassBody = (depth: number) => "class _ {\n".repeat(depth);
const javaMethodBody = (depth: number) => `class _ {\nvoid _() {\n${"{\n".repeat(depth - 2)}`;

/** A member of a class: what a method body can't start with. */
const JAVA_MEMBER =
  /^(?:@\w|(?:public|protected|private|abstract|static|native|transient|volatile)\b)/;

/** A statement: what a class body can't start with. */
const JAVA_STATEMENT =
  /^(?:[}\])]|default\s*(?:->|:)|(?:if|else|for|while|do|switch|case|return|throw|try|catch|finally|yield|break|continue|var|this|super|assert|new)\b|[\w$.]+(?:\[[^\]]*\])?\s*(?:[-+*/%&|^]?=(?!=)|\+\+|--|\())/;

/** Lines inside a block comment, or the comment's last. */
const COMMENT_CONTINUES = /^\*/;

/**
 * Code to tokenize before a piece of a file, so the piece starts in the grammar state its first
 * line is in, or "" to start at the top. A hunk's side starts wherever git cut it, usually inside
 * a class, and Java's grammar reads a method declaration only in a class body and a statement only
 * in a method's: elsewhere a declaration is a call and `throws` is plain. Indentation says how deep
 * the first line is, and its words which of the two it's in when they disagree. A whole file
 * starts at indent 0, so it's read from the top as before.
 */
export const grammarContext = (code: string, language: string): string => {
  if (language !== "java") return "";
  const lines = code.split("\n").filter((line) => line.trim() !== "");
  const first = lines[0];
  if (first === undefined) return "";
  const inComment = COMMENT_CONTINUES.test(first.trim());
  const firstCode = lines.find((line) => !/^(?:\*|\/\*|\/\/)/.test(line.trim()));
  const comment = inComment ? "/*\n" : "";
  if (firstCode === undefined) return comment;
  const depth = indentDepth(firstCode, lines);
  const text = firstCode.trim();
  const context =
    depth === 0
      ? ""
      : JAVA_MEMBER.test(text) || (depth === 1 && !JAVA_STATEMENT.test(text))
        ? javaClassBody(depth)
        : javaMethodBody(Math.max(depth, 2));
  return context + comment;
};

/** How many levels a line is indented: by tabs, else by 2 or 4 spaces, whichever the code uses. */
const indentDepth = (line: string, lines: readonly string[]): number => {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  const tabs = indent.split("\t").length - 1;
  if (tabs > 0) return tabs + Math.floor((indent.length - tabs) / 4);
  const twoSpaces = lines.some((other) => {
    const width = /^ */.exec(other)?.[0].length ?? 0;
    return width % 4 === 2 && !COMMENT_CONTINUES.test(other.trim());
  });
  return Math.floor(indent.length / (twoSpaces ? 2 : 4));
};
