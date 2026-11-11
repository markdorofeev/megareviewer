import { useContext, useEffect, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { HighlighterContext, type SyntaxToken, type SyntaxTokenType } from "../diff/syntax.ts";

const SYNTAX: Readonly<Record<SyntaxTokenType, string>> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  function: "text-syntax-function",
  comment: "text-syntax-comment",
  number: "text-syntax-number",
};

/** Tokens per line of `code` in `language`, or null while they load or when there's no grammar. */
export const useCodeTokens = (
  code: string,
  language: string | null,
): readonly (readonly SyntaxToken[])[] | null => {
  const highlighter = useContext(HighlighterContext);
  const [tokens, setTokens] = useState<{
    readonly key: string;
    readonly lines: readonly (readonly SyntaxToken[])[] | null;
  } | null>(null);
  const key = `${language ?? ""}\0${code}`;
  useEffect(() => {
    if (language === null) return;
    let current = true;
    void highlighter.highlight(code, language).then((lines) => {
      if (current) setTokens({ key, lines });
    });
    return () => {
      current = false;
    };
  }, [highlighter, code, language, key]);
  return tokens?.key === key ? tokens.lines : null;
};

/** One line of code, colored by its tokens when they spell it, else plain. */
export const CodeLine = ({
  text,
  tokens,
}: {
  readonly text: string;
  readonly tokens: readonly SyntaxToken[] | undefined | null;
}) =>
  tokens != null && tokens.map((token) => token.text).join("") === text
    ? tokens.map((token, at) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no identity but their place.
          key={at}
          className={cn(token.type !== null && SYNTAX[token.type])}
        >
          {token.text}
        </span>
      ))
    : text;
