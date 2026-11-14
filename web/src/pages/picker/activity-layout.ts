import {
  type ActivityDay,
  type LocalDate,
  type Timestamp,
  weekdayOf,
} from "../../../../src/domain/review/index.ts";

export const CELL_PX = 24;
/** The Mon, Wed, Fri labels' column. */
export const LABELS_PX = 32;
export const TOTALS_PX = 260;
export const GAP_PX = 32;
/** From this card width up, the totals sit beside the calendar. */
export const SIDE_BY_SIDE_PX = 900;
export const MIN_WEEKS = 8;
export const MAX_WEEKS = 26;

/** As many weeks as fit the card's content width, 8 at least and 26 at most. */
export const weeksFor = (width: number | null): number => {
  if (width === null) return MAX_WEEKS;
  const calendar = width >= SIDE_BY_SIDE_PX ? width - TOTALS_PX - GAP_PX : width;
  const fit = Math.floor((calendar - LABELS_PX) / CELL_PX);
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, fit));
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The browser's own local date of a timestamp. */
export const localDateOf = (at: Timestamp | number): LocalDate => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const asUtc = (date: LocalDate) => new Date(`${date}T00:00:00Z`);

/** "Oct 21". */
export const shortDate = (date: LocalDate): string =>
  asUtc(date).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Wed, Oct 21". */
export const weekdayDate = (date: LocalDate): string =>
  asUtc(date).toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const monthName = (date: LocalDate): string =>
  asUtc(date).toLocaleDateString("en", { month: "short", timeZone: "UTC" });

const dayOfMonth = (date: LocalDate): number => Number(date.slice(8, 10));

/** Each column's month name, over the column where the month starts, or null. */
export const monthLabels = (days: readonly ActivityDay[]): readonly (string | null)[] => {
  const columns = Math.ceil(days.length / 7);
  return Array.from({ length: columns }, (_, column) => {
    const week = days.slice(column * 7, column * 7 + 7);
    const first = week.find((day) => dayOfMonth(day.date) === 1);
    if (first !== undefined) return monthName(first.date);
    const sunday = week[0];
    // The first column names its month only when it starts in the month's first week.
    return column === 0 && sunday !== undefined && dayOfMonth(sunday.date) <= 7
      ? monthName(sunday.date)
      : null;
  });
};

const prs = (count: number) => (count === 1 ? "1 PR" : `${count} PRs`);
const comments = (count: number) => (count === 1 ? "1 comment" : `${count} comments`);

/** The tooltip's second line: "7 PRs reviewed · 26 comments". */
export const dayCounts = (day: ActivityDay): string =>
  `${day.pullRequests === 0 ? "No PRs" : prs(day.pullRequests)} reviewed · ${comments(day.comments)}`;

/** A square's name: "Oct 21: 7 PRs reviewed, 26 comments (today)". */
export const dayName = (day: ActivityDay, today: LocalDate): string =>
  `${shortDate(day.date)}: ${day.pullRequests === 0 ? "No PRs" : prs(day.pullRequests)} reviewed, ${comments(day.comments)}${day.date === today ? " (today)" : ""}`;

/** "Busiest day: Oct 21, 7 PRs and 26 comments." */
export const busiestDay = (day: ActivityDay): string =>
  `Busiest day: ${shortDate(day.date)}, ${prs(day.pullRequests)} and ${comments(day.comments)}.`;

/** Where the arrows, Home and End take the focus, by index into the days. */
export const moveDay = (key: string, index: number, last: number): number | null => {
  const to: Readonly<Record<string, number>> = {
    ArrowLeft: index - 7,
    ArrowRight: index + 7,
    ArrowUp: index - 1,
    ArrowDown: index + 1,
    Home: 0,
    End: last,
  };
  const next = to[key];
  // Past the first or last day shown, the focus stays where it is.
  return next === undefined || next < 0 || next > last ? null : next;
};

/** Sunday is the top row. */
export const rowOf = (date: LocalDate): number => weekdayOf(date);
