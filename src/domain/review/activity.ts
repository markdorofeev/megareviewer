import { z } from "zod";
import { Timestamp } from "./primitives.ts";
import { PullRequestRef } from "./pull-request.ts";

/** A review published, on the day of `at`. */
export const PublishedReview = z.object({ at: Timestamp, pullRequest: PullRequestRef }).readonly();
export type PublishedReview = z.infer<typeof PublishedReview>;

/**
 * What the reviewer posted from megareviewer on this machine: each review published, with its
 * PR, and each comment, whether it went with a review, as a reply or on its own.
 */
export const ReviewActivity = z
  .object({
    reviews: z.array(PublishedReview).readonly(),
    comments: z.array(Timestamp).readonly(),
  })
  .readonly();
export type ReviewActivity = z.infer<typeof ReviewActivity>;

/** A calendar date in the reviewer's time zone, "2026-10-21". */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type LocalDate = z.infer<typeof LocalDate>;

export interface ActivityDay {
  readonly date: LocalDate;
  /** Each PR once, however many reviews it got that day. */
  readonly pullRequests: number;
  readonly comments: number;
}

export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

export interface ActivityTotals {
  readonly pullRequests: number;
  readonly comments: number;
  readonly daysWithReviews: number;
  /** The last week's, Sunday to the last day. */
  readonly thisWeek: number;
  /** The day with the most PRs reviewed, the latest on a tie; null when none has a review. */
  readonly busiest: ActivityDay | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A local date is read as midnight UTC, so adding days never crosses a daylight-saving change.
const toUtc = (date: LocalDate): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number): LocalDate => new Date(ms).toISOString().slice(0, 10);

/** 0 for Sunday to 6 for Saturday. */
export const weekdayOf = (date: LocalDate): number => new Date(toUtc(date)).getUTCDay();

export const addDays = (date: LocalDate, days: number): LocalDate =>
  fromUtc(toUtc(date) + days * DAY_MS);

const refKey = ({ repo, number }: PullRequestRef): string =>
  `${repo.host}/${repo.owner}/${repo.repo}#${number}`;

/**
 * Every day from the Sunday `weeks - 1` weeks before today's week to today, with what was posted
 * on it. `dayOf` turns a timestamp into the reviewer's local date, so the domain reads no time zone.
 */
export const activityDays = (
  activity: ReviewActivity,
  options: {
    readonly today: LocalDate;
    readonly weeks: number;
    readonly dayOf: (at: Timestamp) => LocalDate;
  },
): readonly ActivityDay[] => {
  const { today, weeks, dayOf } = options;
  const first = addDays(today, -weekdayOf(today) - 7 * (Math.max(1, weeks) - 1));
  const reviewed = new Map<LocalDate, Set<string>>();
  for (const { at, pullRequest } of activity.reviews) {
    const date = dayOf(at);
    const refs = reviewed.get(date) ?? new Set<string>();
    refs.add(refKey(pullRequest));
    reviewed.set(date, refs);
  }
  const comments = new Map<LocalDate, number>();
  for (const at of activity.comments) {
    const date = dayOf(at);
    comments.set(date, (comments.get(date) ?? 0) + 1);
  }
  const days: ActivityDay[] = [];
  for (let date = first; date <= today; date = addDays(date, 1)) {
    days.push({
      date,
      pullRequests: reviewed.get(date)?.size ?? 0,
      comments: comments.get(date) ?? 0,
    });
  }
  return days;
};

/** A day's shade, by PRs reviewed: 0, 1, 2, 3 or 4, 5 or more. */
export const activityLevel = (pullRequests: number): ActivityLevel =>
  pullRequests <= 0
    ? 0
    : pullRequests === 1
      ? 1
      : pullRequests === 2
        ? 2
        : pullRequests <= 4
          ? 3
          : 4;

export const activityTotals = (days: readonly ActivityDay[]): ActivityTotals => {
  const last = days.at(-1);
  const weekStart = last === undefined ? null : addDays(last.date, -weekdayOf(last.date));
  let busiest: ActivityDay | null = null;
  for (const day of days) {
    if (day.pullRequests > 0 && (busiest === null || day.pullRequests >= busiest.pullRequests)) {
      busiest = day;
    }
  }
  return {
    pullRequests: days.reduce((sum, day) => sum + day.pullRequests, 0),
    comments: days.reduce((sum, day) => sum + day.comments, 0),
    daysWithReviews: days.filter((day) => day.pullRequests > 0).length,
    thisWeek: days
      .filter((day) => weekStart !== null && day.date >= weekStart)
      .reduce((sum, day) => sum + day.pullRequests, 0),
    busiest,
  };
};
