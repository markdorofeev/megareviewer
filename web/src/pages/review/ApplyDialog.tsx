import { useState } from "react";
import type { ThreadCommentId } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { DANGER, languageOf, SuggestionDiff } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog } from "./Dialog.tsx";
import { applyLabel, type BatchEntry, batchFiles } from "./threads.ts";

type Outcome =
  | { readonly kind: "idle" | "applying" }
  | { readonly kind: "applied"; readonly sha: string | null }
  | { readonly kind: "failed"; readonly error: ApiError };

const where = (entry: BatchEntry) =>
  entry.start === entry.end ? `line ${entry.start}` : `lines ${entry.start}–${entry.end}`;

/**
 * The suggestions about to be committed, file by file, and one button that commits them all on
 * the PR's branch. Once committed, the page's analysis is of an older head, so it offers to
 * analyze the new one.
 */
export const ApplyDialog = ({
  entries,
  covered,
  onApply,
  onApplied,
  onReanalyze,
  reanalyzing,
  onClose,
}: {
  readonly entries: readonly BatchEntry[];
  /** The lines a suggestion replaces, when the map shows them. */
  readonly covered: (entry: BatchEntry) => readonly string[] | null;
  readonly onApply: (
    commentIds: readonly ThreadCommentId[],
  ) => Promise<
    | { readonly ok: true; readonly sha: string | null }
    | { readonly ok: false; readonly error: ApiError }
  >;
  /** The suggestions are on the branch: take them out of the batch. */
  readonly onApplied: (commentIds: readonly ThreadCommentId[]) => void;
  readonly onReanalyze: () => void;
  readonly reanalyzing: boolean;
  readonly onClose: () => void;
}) => {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const files = batchFiles(entries);
  const apply = async () => {
    setOutcome({ kind: "applying" });
    const ids = entries.map((entry) => entry.commentId);
    const result = await onApply(ids);
    if (result.ok) {
      onApplied(ids);
      setOutcome({ kind: "applied", sha: result.sha });
    } else {
      setOutcome({ kind: "failed", error: result.error });
    }
  };
  return (
    <Dialog
      title={outcome.kind === "applied" ? "Suggestions applied" : applyLabel(entries.length)}
      onClose={onClose}
      className="sm:max-w-3xl"
    >
      {outcome.kind === "applied" ? (
        <div className="flex flex-col gap-3">
          <p role="status">
            <span aria-hidden="true">✓ </span>
            Committed
            {outcome.sha === null ? (
              ""
            ) : (
              <>
                {" "}
                <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">
                  {outcome.sha.slice(0, 7)}
                </code>
              </>
            )}{" "}
            on the pull request's branch. This review is of the head before it.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button data-autofocus disabled={reanalyzing} onClick={onReanalyze}>
              {reanalyzing ? "Starting…" : "Analyze the new head"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            One commit on the pull request's branch, on the head you reviewed:{" "}
            <span className="font-mono text-code-compact">
              Apply {entries.length === 1 ? "suggestion" : `${entries.length} suggestions`} from
              code review
            </span>
            .
          </p>
          {files.map((file) => (
            <section key={file.path} className="flex flex-col gap-2" aria-label={file.path}>
              <h3 className="font-mono text-code-compact font-medium">{file.path}</h3>
              {file.entries.map((entry) => (
                <div key={entry.commentId} className="flex flex-col gap-1">
                  <span className="text-caption text-muted-foreground">{where(entry)}</span>
                  <SuggestionDiff
                    removed={covered(entry)}
                    added={entry.lines}
                    language={languageOf({ path: entry.path, language: null })}
                  />
                </div>
              ))}
            </section>
          ))}
          {outcome.kind === "failed" && (
            <p role="alert" className={DANGER}>
              {outcome.error.code === "stale-analysis"
                ? "The pull request has new commits since this review, so nothing was committed. Analyze the new head and apply the suggestions there."
                : `Nothing was committed. ${errorMessage(outcome.error)}`}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              data-autofocus
              disabled={outcome.kind === "applying"}
              onClick={() => void apply()}
            >
              {outcome.kind === "applying" ? "Committing…" : applyLabel(entries.length)}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
