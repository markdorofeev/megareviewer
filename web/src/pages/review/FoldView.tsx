import { useCallback, useRef, useState } from "react";
import type { FileChange, HunkId } from "../../../../src/domain/diff/index.ts";
import type { AnalysisId } from "../../../../src/domain/review/index.ts";
import { errorMessage, useApi } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import {
  EXPAND_STEP,
  type ExpandDirection,
  type SyntaxToken,
  type UnchangedLine,
  UnchangedLines,
  useFileTokens,
} from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { type Fold, fileLines, foldSize, type Opened, openRanges } from "./folds.ts";

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
 * that says how many, with buttons that open them, a step at a time or all at once.
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
  readonly opened: Opened;
  readonly text: FileText;
  readonly onOpen: (direction: ExpandDirection) => void;
  /** Something on the card above the fold's row and below it, for its borders. */
  readonly above: boolean;
  readonly below: boolean;
}) => {
  const lines = text.status === "ready" ? text.lines : null;
  const tokens = useFileTokens(lines, file);
  const ranges = lines === null ? null : openRanges(fold, opened, lines.length);
  const hidden = ranges?.hidden ?? foldSize(fold, null);
  // Below the last part, the fold is empty once the file says it ends there.
  if (hidden === 0 && ranges !== null && ranges.top.length + ranges.bottom.length === 0)
    return null;
  // The card's folds share its file; only one the reviewer opened waits on it or says it failed.
  const asked = opened.top > 0 || opened.bottom > 0;
  const loading = text.status === "loading" && asked;
  const label = hidden === null ? "Unchanged lines below" : `${linesLabel(hidden)} unchanged`;
  const steps: readonly ExpandDirection[] =
    hidden !== null && hidden <= EXPAND_STEP
      ? []
      : fold.after === null
        ? ["up"]
        : fold.before === null
          ? ["down"]
          : ["down", "up"];
  return (
    <div data-slot="file-fold">
      {lines !== null && ranges !== null && (
        <UnchangedLines hunkId={hunkId} lines={openLines(ranges.top, fold, lines, tokens)} />
      )}
      {hidden !== 0 && (
        <div
          data-slot="file-gap"
          className={cn(
            "flex min-h-8 flex-wrap items-center gap-x-2 bg-surface-subtle px-3 text-muted-foreground",
            (above || (ranges?.top.length ?? 0) > 0) && "border-t",
            (below || (ranges?.bottom.length ?? 0) > 0) && "border-b",
            !below && (ranges?.bottom.length ?? 0) === 0 && "rounded-b-lg",
          )}
        >
          <UnfoldIcon />
          {loading ? (
            <span role="status" className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
              />
              Opening {hidden === null ? "unchanged lines below" : label}
            </span>
          ) : (
            <span>{label}</span>
          )}
          {text.status === "error" && asked && (
            <span role="alert" className="text-destructive">
              {text.message}
            </span>
          )}
          {!loading && (
            <span className="ml-auto flex gap-1">
              {steps.map((direction) => (
                <Button
                  key={direction}
                  variant="ghost"
                  size="xs"
                  aria-label={`Show ${EXPAND_STEP} more lines ${direction === "up" ? "above the next change" : "below the previous change"}`}
                  onClick={() => onOpen(direction)}
                >
                  {direction === "up" ? "↑" : "↓"} {EXPAND_STEP}
                </Button>
              ))}
              <Button variant="ghost" size="xs" onClick={() => onOpen("all")}>
                Show all
              </Button>
            </span>
          )}
        </div>
      )}
      {lines !== null && ranges !== null && (
        <UnchangedLines hunkId={hunkId} lines={openLines(ranges.bottom, fold, lines, tokens)} />
      )}
    </div>
  );
};
