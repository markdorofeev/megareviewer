import type { ReactElement, ReactNode } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { type PullRequestStatus, pullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
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
import type { ChangeTotals } from "./model.ts";

/** Up to this many warnings show in full; more collapse to a count. */
const SHOWN_WARNINGS = 2;

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

const HOST_NAMES = { github: "GitHub", bitbucket: "Bitbucket" } as const;

const Branch = ({ name }: { readonly name: string }) => (
  <code className="rounded-sm bg-secondary px-1 font-mono text-code-compact text-foreground">
    {name}
  </code>
);

/**
 * The PR, named once: its title with its number, a link to it on the host, its state and review
 * status, then its CI and reviewers at the row's other end; one line of where it is, how much of
 * its repository was read, who wants to merge what, when it was updated and how much it changes;
 * and its intent as a brief. It scrolls away; the bar under it stays. The threads are counted in
 * the bar, and the files in the tree.
 */
export const ReviewHeader = ({
  view,
  repository,
  intent,
  totals,
  status,
  statusError,
  onRetryStatus,
  now,
}: {
  readonly view: AnalysisView;
  /** Whether the repository was read, after its name, with the dot before it. */
  readonly repository: ReactNode;
  /** The intent's brief, under the byline. */
  readonly intent: ReactNode;
  /** What every file of the PR changes. */
  readonly totals: ChangeTotals;
  /** Where the PR stands on its host, once it's read. */
  readonly status: PullRequestStatus | null;
  /** Why the status couldn't be read, while it can't. */
  readonly statusError: ApiError | null;
  readonly onRetryStatus: () => void;
  /** The time "updated 40m ago" is counted from. */
  readonly now: number;
}) => {
  const { analysis } = view;
  const { pullRequest, warnings } = analysis;
  const { ref } = analysis.key;

  const standing = [
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
    );

  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 text-title font-semibold tracking-[-0.01em] whitespace-pre-line">
          {pullRequest?.title ?? "Collecting the pull request…"}
        </h1>
        {/* Beside the h1 rather than in it, so the heading is named by the title alone. */}
        <a
          className="-ml-1.5 text-title text-muted-foreground no-underline hover:underline"
          href={pullRequest?.url ?? pullRequestUrl(ref)}
          target="_blank"
          rel="noreferrer"
          title={`Open on ${HOST_NAMES[ref.repo.host]}`}
        >
          #{ref.number}
        </a>
        {status !== null && (
          <span className="flex items-center gap-2">
            <PullRequestStateBadge state={status.state} />
            <ReviewStatusBadge status={status.reviewStatus} />
          </span>
        )}
        {standing.length > 0 && (
          <div
            data-slot="pr-standing"
            className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            {standing}
          </div>
        )}
      </div>
      <p
        data-slot="pr-byline"
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground"
      >
        <span>{ref.repo.repo}</span>
        {repository}
        {pullRequest !== null && (
          <>
            {" "}
            <span aria-hidden="true">·</span>{" "}
            <span>
              <span className="font-medium text-foreground">{pullRequest.author.name}</span> wants
              to merge <Branch name={pullRequest.sourceBranch} /> <span aria-hidden="true">→</span>{" "}
              <span className="sr-only">into</span> <Branch name={pullRequest.targetBranch} />
            </span>{" "}
            <span aria-hidden="true">·</span>{" "}
            <span>updated {relativeTime(pullRequest.updatedAt, now)}</span>
          </>
        )}
        {/* The lines are counted once the diff is read; a zero isn't said. */}
        {analysis.stages.prep === "done" && totals.additions + totals.deletions > 0 && (
          <>
            {" "}
            <span aria-hidden="true">·</span>{" "}
            <span className="tabular font-mono text-code-compact">
              <span aria-hidden="true">
                {totals.additions > 0 && (
                  <span className="text-diff-add-fg">+{totals.additions}</span>
                )}
                {totals.additions > 0 && totals.deletions > 0 && " "}
                {totals.deletions > 0 && (
                  <span className="text-diff-del-fg">−{totals.deletions}</span>
                )}
              </span>
              <span className="sr-only">
                {totals.additions} lines added, {totals.deletions} removed
              </span>
            </span>
          </>
        )}
      </p>
      <div className="mt-3 max-w-[980px]">{intent}</div>
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
