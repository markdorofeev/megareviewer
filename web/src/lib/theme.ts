import { useCallback, useEffect, useSyncExternalStore } from "react";

// The theme (light, dark or the system's) and the diff palette (default or color-blind safe) are
// two independent preferences, kept per browser. web/public/theme.js applies them before first
// paint from the same keys; this module keeps <html> in step afterwards.

export type ThemePreference = "light" | "dark" | "system";
export type DiffPalette = "default" | "cb";

const KEYS = { theme: "megareviewer:theme", diffPalette: "megareviewer:diffPalette" } as const;
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const parseThemePreference = (stored: unknown): ThemePreference =>
  stored === "light" || stored === "dark" ? stored : "system";

export const parseDiffPalette = (stored: unknown): DiffPalette =>
  stored === "cb" ? "cb" : "default";

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): "light" | "dark" =>
  preference === "system" ? (systemDark ? "dark" : "light") : preference;

/** Sets `.dark` and `data-diff-palette` on `root`, the two switches globals.css reads. */
export const applyTheme = (
  root: HTMLElement,
  theme: "light" | "dark",
  diffPalette: DiffPalette,
): void => {
  root.classList.toggle("dark", theme === "dark");
  if (diffPalette === "cb") root.dataset.diffPalette = "cb";
  else delete root.dataset.diffPalette;
};

// Storage can be missing or throw, e.g. in a private window; then nothing is remembered.
const read = (key: string): unknown => {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; the preference still holds for this page.
  }
};

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  // Another tab changing a preference changes it here too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
};

const snapshot = () =>
  `${parseThemePreference(read(KEYS.theme))} ${parseDiffPalette(read(KEYS.diffPalette))} ${
    window.matchMedia(DARK_QUERY).matches
  }`;

/** The two preferences, the theme they resolve to, and setters that persist them. */
export const useTheme = () => {
  const [theme = "system", diffPalette = "default", systemDark] = useSyncExternalStore(
    subscribe,
    snapshot,
  ).split(" ");
  const preference = parseThemePreference(theme);
  const palette = parseDiffPalette(diffPalette);
  const resolvedTheme = resolveTheme(preference, systemDark === "true");

  useEffect(() => {
    applyTheme(document.documentElement, resolvedTheme, palette);
  }, [resolvedTheme, palette]);

  const setTheme = useCallback((next: ThemePreference) => {
    write(KEYS.theme, next);
    notify();
  }, []);
  const setDiffPalette = useCallback((next: DiffPalette) => {
    write(KEYS.diffPalette, next);
    notify();
  }, []);

  return { theme: preference, resolvedTheme, diffPalette: palette, setTheme, setDiffPalette };
};
