import { useCallback, useState } from "react";

// Per-viewer conveniences only (collapsed panels, visited steps). Storage can be missing or throw,
// e.g. in a private window, and then the page works without remembering.

const PREFIX = "megareviewer:";

const read = (key: string): unknown => {
  try {
    const text = window.localStorage.getItem(PREFIX + key);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not remembered; the state still holds for this page.
  }
};

/** State remembered in localStorage under `key`; `parse` rejects stored values of another shape. */
export const useStoredState = <T>(
  key: string,
  initial: T,
  parse: (stored: unknown) => T | undefined,
) => {
  const [state, setState] = useState<{ readonly key: string; readonly value: T }>(() => ({
    key,
    value: parse(read(key)) ?? initial,
  }));
  // A new key (another analysis) starts from what's stored for it.
  const value = state.key === key ? state.value : (parse(read(key)) ?? initial);
  const update = useCallback(
    (next: (previous: T) => T) =>
      setState((previous) => {
        const base = previous.key === key ? previous.value : (parse(read(key)) ?? initial);
        const value = next(base);
        write(key, value);
        return { key, value };
      }),
    [key, initial, parse],
  );
  return [value, update] as const;
};

export const parseBoolean = (stored: unknown): boolean | undefined =>
  typeof stored === "boolean" ? stored : undefined;
