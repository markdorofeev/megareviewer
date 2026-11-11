import { createContext, type RefObject, useContext, useEffect, useState } from "react";
import type { HighlighterCore, ThemedToken } from "shiki/core";
import type { FileChange, Hunk } from "../../../../src/domain/diff/index.ts";
import { GRAMMARS, hunkSides, languageOf } from "./languages.ts";
import { displayLines } from "./lines.ts";

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
 * lines from the new one. A line whose tokens don't spell its text stays plain, as does every line
 * of a side without tokens.
 */
export const tokensForHunk = (
  hunk: Pick<Hunk, "lines">,
  oldSide: readonly (readonly SyntaxToken[])[] | null,
  newSide: readonly (readonly SyntaxToken[])[] | null,
): HunkTokens => {
  let oldIndex = 0;
  let newIndex = 0;
  return displayLines(hunk.lines).map(({ line, text }) => {
    const tokens = line.kind === "del" ? oldSide?.[oldIndex] : newSide?.[newIndex];
    if (line.kind !== "add") oldIndex++;
    if (line.kind !== "del") newIndex++;
    return tokens !== undefined && tokens.map((token) => token.text).join("") === text
      ? tokens
      : null;
  });
};

/** Highlights code: the tokens of each line, or null when the language has no grammar. */
export interface Highlighter {
  highlight(code: string, language: string): Promise<readonly (readonly SyntaxToken[])[] | null>;
}

/** Lines past this length aren't tokenized: they're one plain token. */
const MAX_TOKENIZED_LINE = 1000;

/**
 * Shiki with the JavaScript regex engine, so the browser needs no WASM, and the CSS-variables
 * theme. Shiki and each grammar load on first use; a grammar that fails to load leaves its files
 * plain.
 */
export const createShikiHighlighter = (): Highlighter => {
  let core: Promise<HighlighterCore> | null = null;
  const languages = new Map<string, Promise<boolean>>();
  const loadCore = async (): Promise<HighlighterCore> => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: "hunk", variablePrefix: "--shiki-" })],
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
    async highlight(code, language) {
      if (GRAMMARS[language] === undefined) return null;
      core ??= loadCore();
      const highlighter = await core;
      if (!(await loadLanguage(highlighter, language))) return null;
      // The whole side at once, so a string or comment over several lines colors right.
      return highlighter
        .codeToTokensBase(code, {
          lang: language,
          theme: "hunk",
          tokenizeMaxLineLength: MAX_TOKENIZED_LINE,
        })
        .map((line) => syntaxTokens(line));
    },
  };
};

/** Tests provide a fake; the app uses Shiki. */
export const HighlighterContext = createContext<Highlighter>(createShikiHighlighter());

interface Entry {
  readonly promise: Promise<HunkTokens>;
  value: HunkTokens | null;
}

// Hunk IDs name their content, so a card expanded again, or a refetched view, highlights from here.
// A part of a split hunk keeps its hunk's ID, so where its lines start and end tells it apart.
const caches = new WeakMap<Highlighter, Map<string, Entry>>();

const highlightHunk = (highlighter: Highlighter, hunk: Hunk, language: string): Entry => {
  const cache = caches.get(highlighter) ?? new Map<string, Entry>();
  caches.set(highlighter, cache);
  const key = `${language}\0${hunk.id}\0${hunk.oldStart},${hunk.newStart},${hunk.lines.length}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const lines = displayLines(hunk.lines);
  const sides = hunkSides(lines);
  const side = (code: string, present: boolean) =>
    present ? highlighter.highlight(code, language) : Promise.resolve(null);
  const entry: Entry = {
    promise: Promise.all([
      side(
        sides.old,
        lines.some(({ line }) => line.kind !== "add"),
      ),
      side(
        sides.new,
        lines.some(({ line }) => line.kind !== "del"),
      ),
    ]).then(([oldTokens, newTokens]) => {
      const tokens = tokensForHunk(hunk, oldTokens, newTokens);
      entry.value = tokens;
      return tokens;
    }),
    value: null,
  };
  cache.set(key, entry);
  return entry;
};

/** How close to the viewport, in pixels, a card starts highlighting. */
const NEAR_MARGIN = "1200px 0px";

// One observer for every card: a page with hundreds of hunks would otherwise make hundreds.
let observer: IntersectionObserver | null = null;
const onNear = new Map<Element, () => void>();

const observe = (element: Element, near: () => void): (() => void) => {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        onNear.get(entry.target)?.();
        onNear.delete(entry.target);
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: NEAR_MARGIN },
  );
  onNear.set(element, near);
  observer.observe(element);
  return () => {
    onNear.delete(element);
    observer?.unobserve(element);
  };
};

/**
 * Whether the element has come near the viewport. Once it has, it stays true. Without
 * IntersectionObserver (tests), everything is near.
 */
export const useNearViewport = (ref: RefObject<Element | null>): boolean => {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (near || element === null) return;
    return observe(element, () => setNear(true));
  }, [ref, near]);
  return near;
};

/**
 * Tokens for each of a hunk's lines, or null until they're ready (show plain text until then),
 * while `enabled` is false, and for files in languages that can't be highlighted.
 */
export const useHunkTokens = (
  hunk: Hunk,
  file: Pick<FileChange, "path" | "language">,
  enabled = true,
): HunkTokens | null => {
  const highlighter = useContext(HighlighterContext);
  const language = languageOf(file);
  const entry = language === null || !enabled ? null : highlightHunk(highlighter, hunk, language);
  const [ready, setReady] = useState<{ readonly entry: Entry; readonly tokens: HunkTokens }>();
  // Always subscribe: a highlight can finish between the render and this effect, which runs a task
  // later, and then nothing else would draw it. A result the render already showed changes nothing.
  useEffect(() => {
    if (entry === null) return;
    let current = true;
    void entry.promise.then((tokens) => {
      if (current)
        setReady((previous) => (previous?.entry === entry ? previous : { entry, tokens }));
    });
    return () => {
      current = false;
    };
  }, [entry]);
  return entry?.value ?? (ready?.entry === entry ? ready.tokens : null);
};

/**
 * Tokens for each of a file's lines, highlighted whole so a string or comment over several lines
 * colors right: null until they're ready, and for files in languages that can't be highlighted. A
 * line whose tokens don't spell it stays plain.
 */
export const useFileTokens = (
  lines: readonly string[] | null,
  file: Pick<FileChange, "path" | "language">,
): readonly (readonly SyntaxToken[] | null)[] | null => {
  const highlighter = useContext(HighlighterContext);
  const language = languageOf(file);
  const [result, setResult] = useState<{
    readonly lines: readonly string[];
    readonly tokens: readonly (readonly SyntaxToken[] | null)[];
  } | null>(null);
  useEffect(() => {
    if (language === null || lines === null) return;
    let current = true;
    void highlighter.highlight(lines.join("\n"), language).then((tokens) => {
      if (!current || tokens === null) return;
      setResult({
        lines,
        tokens: lines.map((text, at) => {
          const line = tokens[at];
          return line !== undefined && line.map((token) => token.text).join("") === text
            ? line
            : null;
        }),
      });
    });
    return () => {
      current = false;
    };
  }, [highlighter, language, lines]);
  return result?.lines === lines ? result.tokens : null;
};

/** Tokens for every hunk of a file, for the DiffViewer: null until all are ready. */
export const useSyntax = (file: FileChange): readonly (HunkTokens | null)[] | null => {
  const highlighter = useContext(HighlighterContext);
  const language = languageOf(file);
  const [result, setResult] = useState<{
    readonly file: FileChange;
    readonly tokens: readonly HunkTokens[];
  } | null>(null);
  useEffect(() => {
    if (language === null) return;
    let current = true;
    void Promise.all(
      file.hunks.map((hunk) => highlightHunk(highlighter, hunk, language).promise),
    ).then((tokens) => {
      if (current) setResult({ file, tokens });
    });
    return () => {
      current = false;
    };
  }, [file, highlighter, language]);
  return result?.file === file ? result.tokens : null;
};
