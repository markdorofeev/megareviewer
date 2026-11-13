import type { ReactNode } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { pullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { relativeTime, WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import type { ChangeTotals, ThreadTotals } from "./model.ts";

/** Up to this many warnings show in full; more collapse to a count. */
const SHOWN_WARNINGS = 2;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const Branch = ({ name }: { readonly name: string }) => (
  <code className="rounded-sm bg-muted px-1 font-mono text-code-compact text-foreground">
    {name}
  </code>
);

/**
 * The PR, named once: its repository and number with its threads, its title, who wants to merge
 * what and how much it changes, its intent in a line, and whether the analysis is still current.
 * It scrolls away; the bar under it stays.
 */
export const ReviewHeader = ({
  view,
  intent,
  totals,
  threads,
  now,
  reanalyzing,
  reanalyzeError,
  onReanalyze,
}: {
  readonly view: AnalysisView;
  /** The intent line, under the title. */
  readonly intent: ReactNode;
  /** What every file of the PR changes. */
  readonly totals: ChangeTotals;
  /** The PR's threads, once they're read. */
  readonly threads: ThreadTotals | null;
  /** The time "updated 40m ago" is counted from. */
  readonly now: number;
  readonly reanalyzing: boolean;
  readonly reanalyzeError: ApiError | null;
  readonly onReanalyze: () => void;
}) => {
  const { analysis, stale } = view;
  const { pullRequest, warnings } = analysis;
  const { ref } = analysis.key;

  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <a
          className="font-mono text-code-compact"
          href={pullRequest?.url ?? pullRequestUrl(ref)}
          target="_blank"
          rel="noreferrer"
        >
          {ref.repo.repo} #{ref.number}
        </a>
        {threads !== null && threads.threads > 0 && (
          <span data-slot="thread-totals" className="tabular text-caption text-muted-foreground">
            {plural(threads.threads, "thread", "threads")}
            {threads.unresolved > 0 && ` · ${threads.unresolved} unresolved`}
          </span>
        )}
      </div>
      <h1 className="min-w-0 text-title font-semibold tracking-[-0.01em] whitespace-pre-line">
        {pullRequest?.title ?? "Collecting the pull request…"}
      </h1>
      {pullRequest !== null && (
        <p
          data-slot="pr-byline"
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground"
        >
          <span>
            {pullRequest.author.name} wants to merge <Branch name={pullRequest.sourceBranch} />{" "}
            <span aria-hidden="true">→</span> <span className="sr-only">into</span>{" "}
            <Branch name={pullRequest.targetBranch} />
          </span>{" "}
          <span aria-hidden="true">·</span>{" "}
          <span>updated {relativeTime(pullRequest.updatedAt, now)}</span>{" "}
          {/* The files are counted once the diff is read. */}
          {analysis.stages.prep === "done" && (
            <>
              <span aria-hidden="true">·</span>{" "}
              <span className="tabular">
                {plural(totals.files, "file", "files")}{" "}
                <span className="font-mono text-code-compact">
                  <span aria-hidden="true">
                    <span className="text-diff-add-fg">+{totals.additions}</span>{" "}
                    <span className="text-diff-del-fg">−{totals.deletions}</span>
                  </span>
                  <span className="sr-only">
                    , {totals.additions} lines added, {totals.deletions} removed
                  </span>
                </span>
              </span>
            </>
          )}
        </p>
      )}
      <div className="mt-1.5">{intent}</div>
      {stale && (
        <div role="status" className={cn(WARNING, "flex flex-wrap items-center gap-3")}>
          <span>This PR has new commits since the analysis.</span>
          <Button variant="outline" size="sm" disabled={reanalyzing} onClick={onReanalyze}>
            {reanalyzing ? "Starting…" : "Re-analyze"}
          </Button>
          {reanalyzeError !== null && (
            <span className="text-destructive" role="alert">
              {errorMessage(reanalyzeError)}
            </span>
          )}
        </div>
      )}
      {warnings.length > 0 && warnings.length <= SHOWN_WARNINGS && (
        <ul className="flex flex-col gap-2" aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={warning} className={WARNING}>
              <span aria-hidden="true">⚠ </span>
              {warning}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > SHOWN_WARNINGS && (
        <details className={WARNING}>
          <summary className="cursor-pointer">
            <span aria-hidden="true">⚠ </span>
            {warnings.length} warnings
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </header>
  );
};
