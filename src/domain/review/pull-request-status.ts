import { z } from "zod";
import { HttpUrl } from "./primitives.ts";

/** Bitbucket's declined and superseded PRs are closed. */
export const PullRequestState = z.enum(["open", "draft", "merged", "closed"]);
export type PullRequestState = z.infer<typeof PullRequestState>;

/** What a reviewer's latest review on the host says. */
export const ReviewerVerdict = z.enum(["approved", "changes-requested", "commented"]);
export type ReviewerVerdict = z.infer<typeof ReviewerVerdict>;

export const Reviewer = z
  .object({
    /** GitHub login (or `team:` and the team's slug), or Bitbucket account UUID. */
    id: z.string().min(1),
    name: z.string(),
    team: z.boolean(),
    /** null while they're asked to review and haven't. */
    verdict: ReviewerVerdict.nullable(),
  })
  .readonly();
export type Reviewer = z.infer<typeof Reviewer>;

/** What the PR's reviews add up to on its host; null when they say neither. */
export const ReviewStatus = z.enum(["approved", "changes-requested"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const CheckState = z.enum(["passed", "failed", "running", "skipped"]);
export type CheckState = z.infer<typeof CheckState>;

/** One CI result on a commit. */
export const Check = z
  .object({
    name: z.string().min(1),
    state: CheckState,
    /** Where the host says its details are; only http(s). */
    url: HttpUrl.nullable(),
  })
  .readonly();
export type Check = z.infer<typeof Check>;

/** Where a PR stands on its host, read live: never part of an analysis. */
export const PullRequestStatus = z
  .object({
    state: PullRequestState,
    reviewStatus: ReviewStatus.nullable(),
    /** Everyone asked to review and everyone who has, but the PR's author. */
    reviewers: z.array(Reviewer).readonly(),
    /** The checks on the analysis's head commit; null when the host wouldn't say. */
    checks: z.array(Check).readonly().nullable(),
    /** Why the checks couldn't be read, when they couldn't. */
    checksUnreadable: z.string().nullable(),
  })
  .readonly();
export type PullRequestStatus = z.infer<typeof PullRequestStatus>;

/** For a host without a status of its own: one request for changes outweighs any approval. */
export const reviewStatusOf = (reviewers: readonly Reviewer[]): ReviewStatus | null => {
  if (reviewers.some((reviewer) => reviewer.verdict === "changes-requested")) {
    return "changes-requested";
  }
  return reviewers.some((reviewer) => reviewer.verdict === "approved") ? "approved" : null;
};

const VERDICT_ORDER: Readonly<Record<ReviewerVerdict | "none", number>> = {
  "changes-requested": 0,
  approved: 1,
  commented: 2,
  none: 3,
};

/** Changes requested first, then approved, commented, and those yet to review; stable. */
export const orderReviewers = (reviewers: readonly Reviewer[]): Reviewer[] =>
  [...reviewers].sort(
    (a, b) => VERDICT_ORDER[a.verdict ?? "none"] - VERDICT_ORDER[b.verdict ?? "none"],
  );

const CHECK_ORDER: Readonly<Record<CheckState, number>> = {
  failed: 0,
  running: 1,
  passed: 2,
  skipped: 3,
};

/** Failed first, then running, passed and skipped, each by name. */
export const orderChecks = (checks: readonly Check[]): Check[] =>
  [...checks].sort(
    (a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name),
  );

export interface CheckSummary {
  /** What the checks add up to: any failure fails, else any running runs; null with none. */
  readonly state: CheckState | null;
  /** Checks that ran or run: skipped ones don't count. */
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly running: number;
  readonly skipped: number;
}

export const checkSummary = (checks: readonly Check[]): CheckSummary => {
  const count = (state: CheckState) => checks.filter((check) => check.state === state).length;
  const passed = count("passed");
  const failed = count("failed");
  const running = count("running");
  const skipped = count("skipped");
  const state: CheckState | null =
    failed > 0
      ? "failed"
      : running > 0
        ? "running"
        : passed > 0
          ? "passed"
          : skipped > 0
            ? "skipped"
            : null;
  return { state, total: passed + failed + running, passed, failed, running, skipped };
};
