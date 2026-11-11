import { isTestFile } from "../../../../src/domain/diff/index.ts";
import { languageOf } from "../diff/languages.ts";

// What a file is, for its icon in the tree: the shape says its role, the color its language.

/** A file's role, which picks its icon's shape. */
export type FileRole = "test" | "code" | "data" | "docs" | "style" | "other";

/** A file's language family, which picks its icon's color. */
export type FileFamily = "python" | "script" | "data" | "markup" | "plain";

const DATA = new Set(["graphql", "ini", "json", "jsonc", "sql", "toml", "xml", "yaml"]);
const STYLE = new Set(["css", "scss"]);
const MARKUP = new Set(["css", "html", "scss", "svelte", "vue"]);
const SCRIPT = new Set(["javascript", "jsx", "tsx", "typescript"]);
const DOCS = /\.(md|mdx|rst|txt)$/i;

const language = (path: string): string | null => languageOf({ path, language: null });

/** A test wins over its language's role, so tests read apart from the code they exercise. */
export const fileRole = (path: string): FileRole => {
  if (isTestFile(path)) return "test";
  if (DOCS.test(path)) return "docs";
  const name = language(path);
  if (name === null) return "other";
  if (DATA.has(name)) return "data";
  if (STYLE.has(name)) return "style";
  return "code";
};

export const fileFamily = (path: string): FileFamily => {
  const name = language(path);
  if (name === null || DOCS.test(path)) return "plain";
  if (name === "python") return "python";
  if (SCRIPT.has(name)) return "script";
  if (DATA.has(name)) return "data";
  if (MARKUP.has(name)) return "markup";
  return "plain";
};
