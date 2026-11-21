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

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const AVATARS = [
  "bg-avatar-1-bg text-avatar-1-fg",
  "bg-avatar-2-bg text-avatar-2-fg",
  "bg-avatar-3-bg text-avatar-3-fg",
  "bg-avatar-4-bg text-avatar-4-fg",
  "bg-avatar-5-bg text-avatar-5-fg",
  "bg-avatar-6-bg text-avatar-6-fg",
  "bg-avatar-7-bg text-avatar-7-fg",
  "bg-avatar-8-bg text-avatar-8-fg",
] as const;

/** A person's colors, the same for them wherever their initials show: a hash of their host ID. */
export const avatarColors = (id: string): string => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return AVATARS[hash % AVATARS.length] ?? AVATARS[0];
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "3h ago", "yesterday", "2 days ago", then the date. */
export const relativeTime = (iso: string, now: number): string => {
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/** The date and time in full, for the title of a relative one. */
export const absoluteTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
