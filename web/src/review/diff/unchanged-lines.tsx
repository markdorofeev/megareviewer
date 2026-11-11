import type { HunkId } from "../../../../src/domain/diff/index.ts";
import { DiffLine } from "./diff-line.tsx";
import type { ViewLine } from "./rows.ts";
import type { SyntaxToken } from "./syntax.ts";

export interface UnchangedLine {
  readonly oldNo: number;
  readonly newNo: number;
  readonly text: string;
  readonly tokens: readonly SyntaxToken[] | null;
}

/** Unchanged lines opened from a fold, drawn as a hunk's context lines are, with both numbers. */
export const UnchangedLines = ({
  hunkId,
  lines,
}: {
  /** A hunk next to the lines, for their keys. */
  readonly hunkId: HunkId;
  readonly lines: readonly UnchangedLine[];
}) =>
  lines.length === 0 ? null : (
    <div role="table" aria-label="Unchanged lines" className="overflow-x-auto">
      <div className="w-max min-w-full">
        {lines.map(({ oldNo, newNo, text, tokens }) => {
          const line: ViewLine = {
            key: `${hunkId}:unchanged:${newNo}`,
            hunkId,
            kind: "context",
            oldNo,
            newNo,
            text,
            tokens,
            wordRanges: [],
            notes: [],
          };
          return <DiffLine key={newNo} line={line} cellRole="cell" />;
        })}
      </div>
    </div>
  );
