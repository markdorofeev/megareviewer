import { useCallback, useRef, useState } from "react";
import type { FileChange, HunkId } from "../../../../src/domain/diff/index.ts";
import type { AnalysisId } from "../../../../src/domain/review/index.ts";
import { errorMessage, useApi } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import {
  type SyntaxToken,
  type UnchangedLine,
  UnchangedLines,
  useFileTokens,
} from "../../review/index.ts";
import { type Fold, fileLines, foldLines, foldSize } from "./folds.ts";

/** A file's text at the PR's head commit, fetched the first time a fold of its card opens. */
export type FileText =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly lines: readonly string[] };

export const useFileText = (id: AnalysisId, path: string) => {
  const { client } = useApi();
  const [text, setText] = useState<FileText>({ status: "idle" });
  // Read by `load`, so two folds opened at once fetch the file once.
  const status = useRef<FileText["status"]>("idle");
  const load = useCallback(() => {
    if (status.current === "loading" || status.current === "ready") return;
    const settle = (next: FileText) => {
      status.current = next.status;
      setText(next);
    };
    settle({ status: "loading" });
    void client
      .getFileContent(id, "head", path)
      .then((result) =>
        settle(
          !result.ok
            ? { status: "error", message: errorMessage(result.error) }
            : result.value.content === null
              ? { status: "error", message: "The file isn't at the pull request's head commit." }
              : { status: "ready", lines: fileLines(result.value.content) },
        ),
      );
  }, [client, id, path]);
  return { text, load };
};

/** Arrows apart from a line: lines folded away here. */
const UnfoldIcon = () => (
  <svg
    data-slot="unfold-icon"
    className="shrink-0"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M8 1.5v4M5.5 3.5 8 1l2.5 2.5M8 14.5v-4M5.5 12.5 8 15l2.5-2.5M2 8h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const linesLabel = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;

/** The opened lines at these head line numbers. */
const openLines = (
  numbers: readonly number[],
  fold: Fold,
  lines: readonly string[],
  tokens: readonly (readonly SyntaxToken[] | null)[] | null,
): UnchangedLine[] =>
  numbers.map((n) => ({
    oldNo: n + fold.offset,
    newNo: n,
    text: lines[n - 1] ?? "",
    tokens: tokens?.[n - 1] ?? null,
  }));

/**
 * The unchanged lines between two parts, or above the first or below the last: folded under a row
 * that says how many, which opens them all when clicked.
 */
export const FoldView = ({
  fold,
  file,
  hunkId,
  opened,
  text,
  onOpen,
  above,
  below,
}: {
  readonly fold: Fold;
  readonly file: Pick<FileChange, "path" | "language">;
  /** A hunk next to the fold, for the opened lines' keys. */
  readonly hunkId: HunkId;
  readonly opened: boolean;
  readonly text: FileText;
  readonly onOpen: () => void;
  /** Something on the card above the fold's row and below it, for its borders. */
  readonly above: boolean;
  readonly below: boolean;
}) => {
  const lines = text.status === "ready" ? text.lines : null;
  const tokens = useFileTokens(lines, file);
  const size = foldSize(fold, lines?.length ?? null);
  // Below the last part, the fold is empty once the file says it ends there.
  if (size === 0) return null;
  if (opened && lines !== null) {
    return (
      <div data-slot="file-fold">
        <UnchangedLines
          hunkId={hunkId}
          lines={openLines(foldLines(fold, lines.length), fold, lines, tokens)}
        />
      </div>
    );
  }
  // The card's folds share its file; only one the reviewer opened waits on it or says it failed.
  const loading = opened && text.status === "loading";
  const label = size === null ? "Unchanged lines below" : `${linesLabel(size)} unchanged`;
  return (
    <div
      data-slot="file-gap"
      className={cn(
        "flex flex-wrap items-center bg-surface-subtle text-muted-foreground",
        above && "border-t",
        below ? "border-b" : "rounded-b-lg",
      )}
    >
      <button
        type="button"
        data-slot="fold-open"
        aria-busy={loading || undefined}
        disabled={loading}
        onClick={onOpen}
        className={cn(
          "flex min-h-8 flex-1 items-center gap-2 px-3 cursor-pointer text-left -outline-offset-2 hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:hover:bg-transparent",
          !below && "rounded-b-lg",
        )}
      >
        <UnfoldIcon />
        {loading ? (
          <span role="status" className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
            />
            Opening {size === null ? "unchanged lines below" : label}
          </span>
        ) : (
          <span>{label}</span>
        )}
      </button>
      {opened && text.status === "error" && (
        <span role="alert" className="px-3 text-destructive">
          {text.message}
        </span>
      )}
    </div>
  );
};
