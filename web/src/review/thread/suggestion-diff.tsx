import { cn } from "../../lib/utils.ts";
import { CodeLine, useCodeTokens } from "./code-lines.tsx";

const Row = ({
  kind,
  text,
  tokens,
}: {
  readonly kind: "del" | "add";
  readonly text: string;
  readonly tokens: Parameters<typeof CodeLine>[0]["tokens"];
}) => (
  <div
    data-kind={kind}
    className={cn(
      "flex min-h-5 whitespace-pre",
      kind === "add" ? "bg-diff-add-bg" : "bg-diff-del-bg",
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "w-5 shrink-0 select-none text-center",
        kind === "add"
          ? "bg-diff-add-gutter text-diff-add-fg"
          : "bg-diff-del-gutter text-diff-del-fg",
      )}
    >
      {kind === "add" ? "+" : "−"}
    </span>
    <span className="sr-only">{kind === "add" ? "added line " : "removed line "}</span>
    <span className="px-2">
      <CodeLine text={text} tokens={tokens} />
    </span>
  </div>
);

/**
 * A suggested change as a small diff: the lines the comment covers, removed, and the suggestion's
 * lines, added. Without the covered lines (still loading, or the file isn't readable) it shows
 * only what would be added.
 */
export const SuggestionDiff = ({
  removed,
  added,
  language,
  title,
}: {
  readonly removed: readonly string[] | null;
  readonly added: readonly string[];
  readonly language: string | null;
  /** Named inside the box, above the lines, e.g. "Suggested change". */
  readonly title?: string;
}) => {
  const oldTokens = useCodeTokens((removed ?? []).join("\n"), removed === null ? null : language);
  const newTokens = useCodeTokens(added.join("\n"), language);
  return (
    <div
      data-slot="suggestion-diff"
      className="overflow-x-auto rounded-md border font-mono text-code-compact"
    >
      {title !== undefined && (
        <p className="border-b px-2 py-1 font-sans text-caption font-medium text-primary">
          {title}
        </p>
      )}
      {(removed ?? []).map((text, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's place is its identity.
        <Row key={`del:${at}`} kind="del" text={text} tokens={oldTokens?.[at]} />
      ))}
      {added.map((text, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's place is its identity.
        <Row key={`add:${at}`} kind="add" text={text} tokens={newTokens?.[at]} />
      ))}
      {added.length === 0 && (
        <p className="px-2 py-1 font-sans text-caption text-muted-foreground">
          Deletes{" "}
          {removed === null
            ? "the lines"
            : removed.length === 1
              ? "the line"
              : `the ${removed.length} lines`}
          .
        </p>
      )}
    </div>
  );
};
