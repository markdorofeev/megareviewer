import { useEffect, useState } from "react";
import type { FileChange } from "../../../../src/domain/diff/index.ts";
import { createSyntaxHighlighter, type HunkTokens, type SyntaxHighlighter } from "./syntax.ts";

const shared = createSyntaxHighlighter();

/**
 * A file's syntax tokens per hunk, or null until they're ready or when its language isn't known.
 * The diff shows plain text meanwhile, so highlighting never holds the code back.
 */
export const useSyntax = (
  file: FileChange,
  highlighter: SyntaxHighlighter = shared,
): readonly (HunkTokens | null)[] | null => {
  const [result, setResult] = useState<{
    readonly file: FileChange;
    readonly tokens: readonly (HunkTokens | null)[] | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    highlighter.highlightFile(file).then(
      (tokens) => {
        if (current) setResult({ file, tokens });
      },
      // A grammar that fails to load leaves the file plain.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [file, highlighter]);
  return result?.file === file ? result.tokens : null;
};
