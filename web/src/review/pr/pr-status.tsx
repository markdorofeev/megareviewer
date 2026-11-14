import {
  CheckIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  type LucideIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Check,
  type CheckSummary,
  checkSummary,
  orderChecks,
  orderReviewers,
  type PullRequestState,
  type Reviewer,
  type ReviewStatus,
} from "../../../../src/domain/review/index.ts";
import {
  CHECK_STATUS,
  PR_STATE_STATUS,
  REVIEW_STATUS,
  REVIEWER_VERDICT,
} from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../ui/popover.tsx";
import { StatusBadge } from "../../ui/status-badge.tsx";
import { initialsOf } from "../thread/people.ts";

const PR_STATE_ICON: Readonly<Record<PullRequestState, LucideIcon>> = {
  open: GitPullRequestArrowIcon,
  draft: GitPullRequestDraftIcon,
  merged: GitMergeIcon,
  closed: GitPullRequestClosedIcon,
};

/** The PR's state on its host, always shown: Open, Draft, Merged or Closed. */
export const PullRequestStateBadge = ({ state }: { readonly state: PullRequestState }) => {
  const { label, className } = PR_STATE_STATUS[state];
  const Icon = PR_STATE_ICON[state];
  return (
    <Badge data-slot="pr-state" variant="outline" className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
};

/** What the PR's reviews add up to; nothing while they say neither approved nor changes. */
export const ReviewStatusBadge = ({ status }: { readonly status: ReviewStatus | null }) =>
  status === null ? null : (
    <span data-slot="review-status">
      <StatusBadge status={REVIEW_STATUS[status]} />
    </span>
  );

/** "CI 12/12 passed", "CI 2 of 12 failed": what the checks add up to, in words. */
export const ciLabel = (summary: CheckSummary): string => {
  switch (summary.state) {
    case "failed":
      return `CI ${summary.failed} of ${summary.total} failed`;
    case "running":
      return `CI ${summary.running} of ${summary.total} running`;
    case "skipped":
      return `CI ${summary.skipped} skipped`;
    default:
      return `CI ${summary.passed}/${summary.total} passed`;
  }
};

/** The same for a screen reader, where "12/12" reads badly. */
const ciSpoken = (summary: CheckSummary): string => {
  const checks = (count: number) => `${count} ${count === 1 ? "check" : "checks"}`;
  switch (summary.state) {
    case "failed":
      return `CI: ${summary.failed} of ${checks(summary.total)} failed`;
    case "running":
      return `CI: ${summary.running} of ${checks(summary.total)} running`;
    case "skipped":
      return `CI: ${checks(summary.skipped)} skipped`;
    default:
      return `CI: ${summary.passed} of ${checks(summary.total)} passed`;
  }
};

const QUIET = "h-6 gap-1.5 px-1.5 font-normal text-muted-foreground";

const CheckRow = ({ check }: { readonly check: Check }) => {
  const style = CHECK_STATUS[check.state];
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className={cn("w-3 shrink-0 text-center", style.tone)}>
        {style.glyph}
      </span>
      <span className="min-w-0 flex-1 truncate" title={check.name}>
        {check.name}
      </span>
      <span className="shrink-0 text-caption text-muted-foreground">{style.label}</span>
      {check.url !== null && (
        <a
          className="shrink-0 text-caption"
          href={check.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Details of ${check.name}`}
        >
          Details
        </a>
      )}
    </li>
  );
};

/**
 * What CI says about the commit the reviewer reads, as one line that opens its checks. A change
 * of that line after the first read is announced, so a failure that lands mid-review is heard.
 */
export const CiSummary = ({
  checks,
  unreadable,
  head,
}: {
  /** null when the host wouldn't show them. */
  readonly checks: readonly Check[] | null;
  readonly unreadable: string | null;
  /** The commit they're on, which may be behind the PR's latest. */
  readonly head: string;
}) => {
  const summary = checks === null ? null : checkSummary(checks);
  const spoken = summary === null || summary.state === null ? null : ciSpoken(summary);
  const announced = useAnnouncedChange(spoken);

  if (checks === null) {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="xs" className={QUIET} data-slot="ci-summary">
              CI not readable
            </Button>
          }
        />
        <PopoverContent align="end">
          <PopoverTitle>CI not readable</PopoverTitle>
          <p className="text-muted-foreground">{unreadable}</p>
        </PopoverContent>
      </Popover>
    );
  }
  if (summary === null || summary.state === null) return null;
  const style = CHECK_STATUS[summary.state];
  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className={QUIET}
              data-slot="ci-summary"
              data-state={summary.state}
              aria-label={`${spoken}, show checks`}
            >
              <span aria-hidden="true" className={style.tone}>
                {style.glyph}
              </span>
              <span className="tabular">{ciLabel(summary)}</span>
            </Button>
          }
        />
        <PopoverContent align="end" className="w-96">
          <PopoverTitle>
            Checks on <code className="font-mono text-code-compact">{head.slice(0, 7)}</code>
          </PopoverTitle>
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto" aria-label="Checks">
            {orderChecks(checks).map((check) => (
              <CheckRow key={`${check.name}:${check.url ?? ""}`} check={check} />
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <span role="status" className="sr-only">
        {announced}
      </span>
    </>
  );
};

/** The text, once it changes after its first value; until then nothing, so a load is silent. */
const useAnnouncedChange = (text: string | null): string => {
  const first = useRef<string | null | undefined>(undefined);
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    if (first.current === undefined) {
      first.current = text;
      return;
    }
    if (text !== null && text !== first.current) {
      first.current = text;
      setAnnounced(text);
    }
  }, [text]);
  return announced;
};

const VERDICT_ICON: Readonly<Record<NonNullable<Reviewer["verdict"]>, LucideIcon>> = {
  "changes-requested": XIcon,
  approved: CheckIcon,
  commented: MessageSquareIcon,
};

/** Shown in full up to this many; past it, one fewer and "+N". */
const SHOWN_REVIEWERS = 3;

const Initials = ({ reviewer }: { readonly reviewer: Reviewer }) => {
  const Icon = reviewer.verdict === null ? null : VERDICT_ICON[reviewer.verdict];
  return (
    <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground ring-2 ring-background">
      {initialsOf(reviewer.name)}
      {Icon !== null && reviewer.verdict !== null && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-background">
          <Icon
            className={cn("size-2.5", REVIEWER_VERDICT[reviewer.verdict].tone)}
            strokeWidth={3.5}
          />
        </span>
      )}
    </span>
  );
};

/** "3 reviewers: 1 requested changes, 1 approved, 1 not reviewed yet". */
export const reviewersSpoken = (reviewers: readonly Reviewer[]): string => {
  const counts = new Map<string, number>();
  for (const reviewer of reviewers) {
    const label = REVIEWER_VERDICT[reviewer.verdict ?? "waiting"].label.toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, count]) => `${count} ${label}`);
  const total = `${reviewers.length} ${reviewers.length === 1 ? "reviewer" : "reviewers"}`;
  return `${total}: ${parts.join(", ")}`;
};

/** The reviewers as initials with their verdicts' marks, opening the list of them in words. */
export const ReviewerStack = ({ reviewers }: { readonly reviewers: readonly Reviewer[] }) => {
  if (reviewers.length === 0) return null;
  const ordered = orderReviewers(reviewers);
  const shown = ordered.length > SHOWN_REVIEWERS ? ordered.slice(0, SHOWN_REVIEWERS - 1) : ordered;
  const more = ordered.length - shown.length;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-7 px-1"
            data-slot="reviewers"
            aria-label={`${reviewersSpoken(ordered)}, show reviewers`}
          >
            <span aria-hidden="true" className="flex items-center -space-x-1">
              {shown.map((reviewer) => (
                <Initials key={reviewer.id} reviewer={reviewer} />
              ))}
              {more > 0 && (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground ring-2 ring-background">
                  +{more}
                </span>
              )}
            </span>
          </Button>
        }
      />
      <PopoverContent align="end">
        <PopoverTitle>Reviewers</PopoverTitle>
        <ul className="flex flex-col gap-2" aria-label="Reviewers">
          {ordered.map((reviewer) => {
            const verdict = REVIEWER_VERDICT[reviewer.verdict ?? "waiting"];
            return (
              <li key={reviewer.id} className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true">
                  <Initials reviewer={reviewer} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {reviewer.name}
                  {reviewer.team && <span className="text-muted-foreground"> (team)</span>}
                </span>
                <span className={cn("shrink-0 text-caption", verdict.tone)}>{verdict.label}</span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
