import type { HighlighterCore, ThemedToken } from "shiki/core";
import type { FileChange, Hunk } from "../../../../src/domain/diff/index.ts";
import { GRAMMARS, hunkSides, languageOf } from "../../diff/highlight.ts";
import { displayLines } from "../../diff/lines.ts";

// Syntax colors come from the five --syntax-* tokens, never from a theme's hex values, so they
// follow light, dark and the contrast check. Shiki's CSS-variables theme names each token's scope
// (var(--shiki-token-keyword)), and that name picks the token's type; what has no type is plain
// text in the foreground color.

export type SyntaxTokenType = "keyword" | "string" | "function" | "comment" | "number";

export interface SyntaxToken {
  readonly text: string;
  readonly type: SyntaxTokenType | null;
}

const TYPES: Readonly<Record<string, SyntaxTokenType>> = {
  "token-keyword": "keyword",
  "token-string": "string",
  "token-string-expression": "string",
  "token-function": "function",
  "token-comment": "comment",
  "token-constant": "number",
};

const PREFIX = "--shiki-";

/** The type a Shiki token's color names, or null for plain text. */
export const syntaxType = (color: string | undefined): SyntaxTokenType | null => {
  const name = /^var\(--shiki-([\w-]+)/.exec(color ?? "")?.[1];
  return name === undefined ? null : (TYPES[name] ?? null);
};

/** A line's Shiki tokens as ours, neighbors of the same type merged. */
export const syntaxTokens = (line: readonly Pick<ThemedToken, "content" | "color">[]) => {
  const tokens: SyntaxToken[] = [];
  for (const { content, color } of line) {
    const type = syntaxType(color);
    const last = tokens.at(-1);
    if (last !== undefined && last.type === type) {
      tokens[tokens.length - 1] = { text: last.text + content, type };
    } else {
      tokens.push({ text: content, type });
    }
  }
  return tokens;
};

/** Tokens per line of a hunk, in the hunk's order, or null for a line that stays plain. */
export type HunkTokens = readonly (readonly SyntaxToken[] | null)[];

/**
 * Maps each side's lines back onto the hunk: deleted lines from the old side, added and context
 * lines from the new one. A line whose tokens don't spell its text stays plain.
 */
export const tokensForHunk = (
  hunk: Pick<Hunk, "lines">,
  oldSide: readonly (readonly SyntaxToken[])[],
  newSide: readonly (readonly SyntaxToken[])[],
): HunkTokens => {
  let oldIndex = 0;
  let newIndex = 0;
  return displayLines(hunk.lines).map(({ line, text }) => {
    const tokens = line.kind === "del" ? oldSide[oldIndex] : newSide[newIndex];
    if (line.kind !== "add") oldIndex++;
    if (line.kind !== "del") newIndex++;
    return tokens !== undefined && tokens.map((token) => token.text).join("") === text
      ? tokens
      : null;
  });
};

/** Each hunk side is tokenized whole, so a string or comment over several lines colors right. */
export interface SyntaxHighlighter {
  /** Tokens per hunk of the file, in its order; null when its language isn't known. */
  highlightFile(
    file: Pick<FileChange, "path" | "language" | "hunks">,
  ): Promise<HunkTokens[] | null>;
}

/** Shiki with the JavaScript regex engine and the CSS-variables theme, loaded on first use. */
export const createSyntaxHighlighter = (): SyntaxHighlighter => {
  let core: Promise<HighlighterCore> | null = null;
  const loaded = new Map<string, Promise<void>>();
  const load = async (language: string): Promise<HighlighterCore> => {
    core ??= (async () => {
      const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
        await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
      return createHighlighterCore({
        themes: [createCssVariablesTheme({ name: "hunk", variablePrefix: PREFIX })],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
    const highlighter = await core;
    const loading =
      loaded.get(language) ??
      (async () => {
        const grammar = GRAMMARS[language];
        if (grammar !== undefined) await highlighter.loadLanguage(...(await grammar()).default);
      })();
    loaded.set(language, loading);
    await loading;
    return highlighter;
  };

  return {
    async highlightFile(file) {
      const language = languageOf(file);
      if (language === null) return null;
      const highlighter = await load(language);
      const tokenize = (code: string) =>
        highlighter
          .codeToTokensBase(code, { lang: language, theme: "hunk" })
          .map((line) => syntaxTokens(line));
      return file.hunks.map((hunk) => {
        const sides = hunkSides(displayLines(hunk.lines));
        return tokensForHunk(hunk, tokenize(sides.old), tokenize(sides.new));
      });
    },
  };
};
