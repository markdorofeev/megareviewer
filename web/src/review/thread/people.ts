/** Up to two initials from a display name, for the circle that stands in for an avatar. */
export const initialsOf = (name: string): string => {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    words.length === 1
      ? [...(words[0] ?? "")].slice(0, 2)
      : words.slice(0, 2).map((word) => [...word][0] ?? "");
  const initials = letters.join("").toUpperCase();
  return initials === "" ? "?" : initials;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export const relativeTime = (iso: string, now: number): string => {
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};
