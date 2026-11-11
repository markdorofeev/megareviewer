import type { LanguageRegistration } from "shiki/core";
import type { FileChange } from "../../../../src/domain/diff/index.ts";
import type { DisplayLine } from "./lines.ts";

// Which Shiki grammar a file needs, and the code a hunk's two sides make.

type LanguageModule = Promise<{ readonly default: readonly LanguageRegistration[] }>;

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
  java: () => import("shiki/langs/java.mjs"),
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
