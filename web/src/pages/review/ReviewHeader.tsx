import type { ReactElement, ReactNode } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { type PullRequestStatus, pullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import {
  CiSummary,
  PullRequestStateBadge,
  ReviewerStack,
  ReviewStatusBadge,
  relativeTime,
  WARNING,
} from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../ui/popover.tsx";
import type { ChangeTotals, ThreadTotals } from "./model.ts";

/** Up to this many warnings show in full; more collapse to a count. */
const SHOWN_WARNINGS = 2;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const Separator = () => <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />;

/** A status read that failed: quiet, with why and a way to try again. */
const StatusUnavailable = ({
  error,
  onRetry,
}: {
  readonly error: ApiError;
  readonly onRetry: () => void;
}) => (
  <Popover>
    <PopoverTrigger
      render={
        <Button
          variant="ghost"
          size="xs"
          className="h-6 px-1.5 font-normal text-muted-foreground"
          data-slot="status-unavailable"
        >
          Status unavailable
        </Button>
      }
    />
    <PopoverContent align="end">
      <PopoverTitle>The PR's status couldn't be read</PopoverTitle>
      <p className="text-muted-foreground">{errorMessage(error)}</p>
      <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
        Try again
      </Button>
    </PopoverContent>
  </Popover>
);

const Branch = ({ name }: { readonly name: string }) => (
  <code className="rounded-sm bg-muted px-1 font-mono text-code-compact text-foreground">
    {name}
  </code>
);

/**
 * The PR, named once: its repository and number with its threads, CI and reviewers, its title
 * with its state and review status, who wants to merge what and how much it changes, its intent
 * in a line, and whether the analysis is still current. It scrolls away; the bar under it stays.
 */
export const ReviewHeader = ({
  view,
  intent,
  totals,
  threads,
  status,
  statusError,
  onRetryStatus,
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
  /** Where the PR stands on its host, once it's read. */
  readonly status: PullRequestStatus | null;
  /** Why the status couldn't be read, while it can't. */
  readonly statusError: ApiError | null;
  readonly onRetryStatus: () => void;
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <a
          className="font-mono text-code-compact"
          href={pullRequest?.url ?? pullRequestUrl(ref)}
          target="_blank"
          rel="noreferrer"
        >
          {ref.repo.repo} #{ref.number}
        </a>
        <div data-slot="pr-standing" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {[
            threads !== null && threads.threads > 0 && (
              <span
                key="threads"
                data-slot="thread-totals"
                className="tabular text-caption text-muted-foreground"
              >
                {plural(threads.threads, "thread", "threads")}
                {threads.unresolved > 0 && ` · ${threads.unresolved} unresolved`}
              </span>
            ),
            status === null && statusError !== null && (
              <StatusUnavailable key="unavailable" error={statusError} onRetry={onRetryStatus} />
            ),
            status !== null && (status.checks === null || status.checks.length > 0) && (
              <CiSummary
                key="ci"
                checks={status.checks}
                unreadable={status.checksUnreadable}
                head={analysis.key.headSha}
              />
            ),
            status !== null && status.reviewers.length > 0 && (
              <ReviewerStack key="reviewers" reviewers={status.reviewers} />
            ),
          ]
            .filter((item): item is ReactElement => item !== false)
            .flatMap((item, index) =>
              index === 0 ? [item] : [<Separator key={`before-${item.key}`} />, item],
            )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 text-title font-semibold tracking-[-0.01em] whitespace-pre-line">
          {pullRequest?.title ?? "Collecting the pull request…"}
        </h1>
        {status !== null && (
          <span className="flex items-center gap-2">
            <PullRequestStateBadge state={status.state} />
            <ReviewStatusBadge status={status.reviewStatus} />
          </span>
        )}
      </div>
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
