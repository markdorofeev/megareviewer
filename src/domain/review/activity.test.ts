import { describe, expect, it } from "vitest";
import {
  type ActivityDay,
  activityDays,
  activityLevel,
  activityTotals,
  addDays,
  type PullRequestRef,
  type ReviewActivity,
  weekdayOf,
} from "./index.ts";

const pr = (number: number): PullRequestRef => ({
  repo: { host: "github", owner: "acme", repo: "shop" },
  number,
});

/** A reviewer in New York: the dates as a browser there would read them. */
const newYork = (at: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(at));

const NOTHING: ReviewActivity = { reviews: [], comments: [] };

const day = (date: string, pullRequests = 0, comments = 0): ActivityDay => ({
  date,
  pullRequests,
  comments,
});

describe("activityDays", () => {
  // 2026-10-21 is a Wednesday.
  const options = { today: "2026-10-21", weeks: 2, dayOf: newYork };

  it("runs from the Sunday weeks - 1 weeks back to today, mid-week", () => {
    const days = activityDays(NOTHING, options);
    expect(days[0]?.date).toBe("2026-10-11");
    expect(weekdayOf("2026-10-11")).toBe(0);
    expect(days.at(-1)?.date).toBe("2026-10-21");
    expect(days).toHaveLength(11);
    expect(days.every((one) => one.pullRequests === 0 && one.comments === 0)).toBe(true);
  });

  it("counts a PR reviewed twice in a day once, and on two days twice", () => {
    const days = activityDays(
      {
        reviews: [
          { at: "2026-10-20T14:00:00Z", pullRequest: pr(1) },
          { at: "2026-10-20T16:00:00Z", pullRequest: pr(1) },
          { at: "2026-10-20T17:00:00Z", pullRequest: pr(2) },
          { at: "2026-10-21T14:00:00Z", pullRequest: pr(1) },
        ],
        comments: [],
      },
      options,
    );
    expect(days.at(-2)).toEqual(day("2026-10-20", 2));
    expect(days.at(-1)).toEqual(day("2026-10-21", 1));
  });

  it("puts a comment at 23:59 and one at 00:00 local on their own days", () => {
    const days = activityDays(
      // 23:59 and 00:00 in New York, on daylight time (UTC-4).
      { reviews: [], comments: ["2026-10-21T03:59:00Z", "2026-10-21T04:00:00Z"] },
      options,
    );
    expect(days.at(-2)).toEqual(day("2026-10-20", 0, 1));
    expect(days.at(-1)).toEqual(day("2026-10-21", 0, 1));
  });

  it("has every date once across a daylight-saving change", () => {
    // New York leaves daylight time on 2026-11-01.
    const days = activityDays(
      { reviews: [], comments: ["2026-11-02T04:30:00Z", "2026-11-01T03:30:00Z"] },
      { today: "2026-11-03", weeks: 2, dayOf: newYork },
    );
    const dates = days.map((one) => one.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toContain("2026-11-01");
    expect(dates).toContain("2026-11-02");
    // 23:30 on Oct 31 (UTC-4), and 23:30 on Nov 1 (UTC-5).
    expect(days.find((one) => one.date === "2026-10-31")?.comments).toBe(1);
    expect(days.find((one) => one.date === "2026-11-01")?.comments).toBe(1);
  });

  it("leaves out what's before the first day or after today", () => {
    const days = activityDays(
      {
        reviews: [{ at: "2026-10-01T12:00:00Z", pullRequest: pr(1) }],
        comments: ["2026-10-30T12:00:00Z"],
      },
      options,
    );
    expect(activityTotals(days)).toMatchObject({ pullRequests: 0, comments: 0 });
  });

  it("starts on today when today is a Sunday, with one week", () => {
    const days = activityDays(NOTHING, { today: "2026-10-18", weeks: 1, dayOf: newYork });
    expect(days).toEqual([day("2026-10-18")]);
  });
});

describe("activityLevel", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
    [5, 4],
    [7, 4],
  ])("is %i PRs at level %i", (pullRequests, level) => {
    expect(activityLevel(pullRequests)).toBe(level);
  });
});

describe("activityTotals", () => {
  it("sums the days, and takes the latest busiest day on a tie", () => {
    const totals = activityTotals([
      day("2026-10-11", 3, 2),
      day("2026-10-12", 0, 4),
      day("2026-10-13", 3, 1),
      day("2026-10-14", 1),
    ]);
    expect(totals).toEqual({
      pullRequests: 7,
      comments: 7,
      daysWithReviews: 3,
      thisWeek: 7,
      busiest: day("2026-10-13", 3, 1),
    });
  });

  it("has no busiest day without reviews, counting the comments", () => {
    expect(activityTotals([day("2026-10-11", 0, 3), day("2026-10-12", 0, 1)])).toEqual({
      pullRequests: 0,
      comments: 4,
      daysWithReviews: 0,
      thisWeek: 0,
      busiest: null,
    });
    expect(activityTotals([]).busiest).toBeNull();
  });

  it("counts this week from its Sunday, which on a Sunday is today alone", () => {
    const week = [day("2026-10-17", 4), day("2026-10-18", 2)];
    expect(activityTotals(week).thisWeek).toBe(2);
    expect(activityTotals([...week, day("2026-10-19", 1)]).thisWeek).toBe(3);
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
