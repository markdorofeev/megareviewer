const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "8 min ago", "1 h ago", "yesterday", "2 days ago", "3 weeks ago", "2 months ago". */
export const relativeTime = (timestamp: string, nowMs: number): string => {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(timestamp)) / 1000));
  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h ago`;
  const days = Math.floor(seconds / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  if (days < 30) return plural(Math.floor(days / 7), "week");
  if (days < 365) return plural(Math.floor(days / 30), "month");
  return plural(Math.floor(days / 365), "year");
};

/** The full date and time, for a `<time>`'s title. */
export const fullDate = (timestamp: string): string =>
  new Date(timestamp).toLocaleString("en", { dateStyle: "full", timeStyle: "short" });
