import type { ReactNode } from "react";
import type { BodyBlock } from "../../../../src/domain/review/index.ts";
import { languageOf } from "../diff/languages.ts";
import { CodeLine, useCodeTokens } from "./code-lines.tsx";

/** A fenced block's language as a grammar name: `ts`, `py` and the like read as extensions. */
const fenceLanguage = (info: string | null): string | null =>
  info === null ? null : languageOf({ path: `code.${info}`, language: info });

const CodeBlock = ({
  text,
  language,
}: {
  readonly text: string;
  readonly language: string | null;
}) => {
  const grammar = fenceLanguage(language);
  const tokens = useCodeTokens(text, grammar);
  const lines = text.split("\n");
  return (
    <pre
      data-slot="thread-code"
      className="overflow-x-auto rounded-md border bg-surface-subtle px-2.5 py-1.5 font-mono text-code-compact"
    >
      <code>
        {lines.map((line, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's place is its identity.
          <span key={at} className="block min-h-[1lh] whitespace-pre">
            <CodeLine text={line} tokens={tokens?.[at]} />
          </span>
        ))}
      </code>
    </pre>
  );
};

/**
 * A comment's blocks as text: paragraphs with code spans, and code blocks colored like the diff.
 * Nothing in a body becomes HTML, a link or an image. `suggestion` draws a suggestion block.
 */
export const ThreadBody = ({
  blocks,
  suggestion,
}: {
  readonly blocks: readonly BodyBlock[];
  readonly suggestion: (lines: readonly string[]) => ReactNode;
}) => (
  <div data-slot="thread-body" className="flex flex-col gap-2 text-body break-words">
    {blocks.map((block, at) => {
      // Blocks and spans have no identity but their place, and a body never reorders.
      const key = `${block.kind}:${at}`;
      if (block.kind === "suggestion") return <div key={key}>{suggestion(block.lines)}</div>;
      if (block.kind === "code") {
        return <CodeBlock key={key} text={block.text} language={block.language} />;
      }
      return (
        <p key={key} className="whitespace-pre-wrap">
          {block.spans.map((span, index) =>
            span.kind === "code" ? (
              <code
                // biome-ignore lint/suspicious/noArrayIndexKey: spans have no identity but their place.
                key={`code:${index}`}
                className="rounded-sm bg-muted px-1 font-mono text-code-compact"
              >
                {span.text}
              </code>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: spans have no identity but their place.
              <span key={`text:${index}`}>{span.text}</span>
            ),
          )}
        </p>
      );
    })}
  </div>
);
