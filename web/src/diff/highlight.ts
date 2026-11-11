import type { HighlighterCore, LanguageRegistration, ThemedTokenWithVariants } from "shiki/core";
import type { FileChange } from "../../../src/domain/diff/index.ts";
import type { DisplayLine } from "./lines.ts";
import { type CodeToken, plainTokens } from "./tokens.ts";

/** Highlights code; the tokens of each line, or null when the language can't be highlighted. */
export interface Highlighter {
  highlight(code: string, language: string): Promise<readonly (readonly CodeToken[])[] | null>;
}

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

/**
 * Maps the tokens of each side's lines back onto the diff lines: deleted lines from the old side,
 * added and context lines from the new one. A line whose tokens don't spell its text is plain.
 */
export const tokensForLines = (
  lines: readonly DisplayLine[],
  oldTokens: readonly (readonly CodeToken[])[] | null,
  newTokens: readonly (readonly CodeToken[])[] | null,
): (readonly CodeToken[])[] => {
  let oldIndex = 0;
  let newIndex = 0;
  return lines.map(({ line, text }) => {
    const tokens = line.kind === "del" ? oldTokens?.[oldIndex] : newTokens?.[newIndex];
    if (line.kind !== "add") oldIndex++;
    if (line.kind !== "del") newIndex++;
    return tokens !== undefined && tokens.map((token) => token.text).join("") === text
      ? tokens
      : plainTokens(text);
  });
};

/** A plain-text line has its whole length in one token. Lines past this aren't tokenized. */
const MAX_TOKENIZED_LINE = 1000;

// The default GitHub themes, which match the UI's colors. Two light colors fall below 4.5:1 on
// the diff backgrounds, so they're darkened: comments and function names.
const THEMES = { light: "github-light-default", dark: "github-dark-default" } as const;
const LIGHT_REPLACEMENTS: Readonly<Record<string, string>> = {
  "#6e7781": "#57606a",
  "#8250df": "#6639ba",
};

const ITALIC = 1;
const BOLD = 2;

/** Each theme's default text color. */
export interface Foregrounds {
  readonly light: string;
  readonly dark: string;
}

/**
 * Shiki's tokens of one line as ours. Text in the themes' default colors is plain, so it takes the
 * UI's text color, and neighbors with the same style merge: a long hunk renders fewer elements.
 */
export const themeTokens = (
  line: readonly ThemedTokenWithVariants[],
  foregrounds: Foregrounds,
): CodeToken[] => {
  const tokens: CodeToken[] = [];
  for (const { content, variants } of line) {
    const light = variants.light?.color?.toLowerCase() ?? null;
    const dark = variants.dark?.color?.toLowerCase() ?? null;
    const plain = light === foregrounds.light && dark === foregrounds.dark;
    const fontStyle = variants.light?.fontStyle ?? 0;
    const token: CodeToken = {
      text: content,
      light: plain || light === null ? null : (LIGHT_REPLACEMENTS[light] ?? light),
      dark: plain ? null : dark,
      italic: fontStyle > 0 && (fontStyle & ITALIC) !== 0,
      bold: fontStyle > 0 && (fontStyle & BOLD) !== 0,
    };
    const last = tokens.at(-1);
    if (
      last !== undefined &&
      last.light === token.light &&
      last.dark === token.dark &&
      last.italic === token.italic &&
      last.bold === token.bold
    ) {
      tokens[tokens.length - 1] = { ...last, text: last.text + token.text };
    } else {
      tokens.push(token);
    }
  }
  return tokens;
};

/**
 * Shiki with the JavaScript regex engine, so the browser needs no WASM. Shiki, the themes and each
 * grammar load on first use. A grammar that fails to load leaves its files plain.
 */
export const createShikiHighlighter = (): Highlighter => {
  let core: Promise<HighlighterCore> | null = null;
  const languages = new Map<string, Promise<boolean>>();

  const loadCore = async (): Promise<HighlighterCore> => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [
        import("shiki/themes/github-light-default.mjs"),
        import("shiki/themes/github-dark-default.mjs"),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  };

  const loadLanguage = (highlighter: HighlighterCore, language: string): Promise<boolean> => {
    const loading =
      languages.get(language) ??
      (async () => {
        const grammar = GRAMMARS[language];
        if (grammar === undefined) return false;
        await highlighter.loadLanguage(...(await grammar()).default);
        return true;
      })();
    languages.set(language, loading);
    return loading;
  };

  return {
    highlight: async (code, language) => {
      if (!(language in GRAMMARS)) return null;
      try {
        core ??= loadCore();
        const highlighter = await core;
        if (!(await loadLanguage(highlighter, language))) return null;
        const foregrounds = {
          light: highlighter.getTheme(THEMES.light).fg.toLowerCase(),
          dark: highlighter.getTheme(THEMES.dark).fg.toLowerCase(),
        };
        return highlighter
          .codeToTokensWithThemes(code, {
            lang: language,
            themes: THEMES,
            tokenizeMaxLineLength: MAX_TOKENIZED_LINE,
          })
          .map((line) => themeTokens(line, foregrounds));
      } catch {
        // A chunk that failed to load is tried again next time.
        core = null;
        languages.delete(language);
        return null;
      }
    },
  };
};
