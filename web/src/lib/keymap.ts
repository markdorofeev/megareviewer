import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// The one table of keyboard shortcuts. Handlers, key hints and the shortcuts dialog all read it,
// so a hint can't name a key that does something else. Single-key shortcuts never fire while
// typing, and the reviewer can turn them off (WCAG 2.1.4); shortcuts with a modifier stay on.

export type ShortcutScope = "global" | "diff" | "overview" | "tree" | "composer" | "picker";

export type ShortcutId =
  | "nextFile"
  | "previousFile"
  | "lineDown"
  | "lineUp"
  | "extendDown"
  | "extendUp"
  | "comment"
  | "openCall"
  | "toggleSplit"
  | "moveFile"
  | "openFile"
  | "toggleLayout"
  | "filterTree"
  | "openReview"
  | "submit"
  | "close"
  | "help"
  | "focusLink"
  | "moveRow"
  | "openRow"
  | "cancelOpening";

/** One key press: `key` as KeyboardEvent.key has it, and the modifiers that must be held. */
export interface KeyChord {
  readonly key: string;
  readonly shift?: boolean;
  /** ⌘ on macOS, Ctrl elsewhere. */
  readonly mod?: boolean;
}

export interface Shortcut {
  readonly id: ShortcutId;
  /** Alternatives; any one of them runs the action. */
  readonly chords: readonly KeyChord[];
  readonly action: string;
  readonly scope: ShortcutScope;
}

export const KEYMAP: readonly Shortcut[] = [
  { id: "nextFile", chords: [{ key: "n" }], action: "Next file", scope: "diff" },
  { id: "previousFile", chords: [{ key: "p" }], action: "Previous file", scope: "diff" },
  { id: "lineDown", chords: [{ key: "ArrowDown" }], action: "Focus the next line", scope: "diff" },
  { id: "lineUp", chords: [{ key: "ArrowUp" }], action: "Focus the previous line", scope: "diff" },
  {
    id: "extendDown",
    chords: [{ key: "ArrowDown", shift: true }],
    action: "Extend the selection down",
    scope: "diff",
  },
  {
    id: "extendUp",
    chords: [{ key: "ArrowUp", shift: true }],
    action: "Extend the selection up",
    scope: "diff",
  },
  {
    id: "comment",
    chords: [{ key: "c" }],
    action: "Comment on the selected decision, or on the focused change",
    scope: "diff",
  },
  {
    id: "openCall",
    chords: [{ key: "o" }],
    action: "Show the code a call on the focused line runs; again for the next call",
    scope: "diff",
  },
  { id: "toggleSplit", chords: [{ key: "u" }], action: "Unified or split diff", scope: "diff" },
  { id: "toggleLayout", chords: [{ key: "v" }], action: "Map or overview", scope: "global" },
  {
    id: "moveFile",
    chords: [{ key: "ArrowLeft" }, { key: "ArrowRight" }, { key: "ArrowUp" }, { key: "ArrowDown" }],
    action: "Move between files",
    scope: "overview",
  },
  {
    id: "openFile",
    chords: [{ key: "Enter" }],
    action: "Open the file's code in the map, or a group of files in place",
    scope: "overview",
  },
  { id: "filterTree", chords: [{ key: "/" }], action: "Filter the files", scope: "tree" },
  {
    id: "openReview",
    chords: [{ key: "R", shift: true }],
    action: "Open the review to publish",
    scope: "global",
  },
  {
    id: "submit",
    chords: [{ key: "Enter", mod: true }],
    action: "Send the comment or review",
    scope: "composer",
  },
  {
    id: "close",
    chords: [{ key: "Escape" }],
    action: "Close, clear the highlight, or go back to the overview",
    scope: "global",
  },
  {
    id: "help",
    chords: [{ key: "?", shift: true }],
    action: "Show all shortcuts",
    scope: "global",
  },
  { id: "focusLink", chords: [{ key: "/" }], action: "Paste a pull request link", scope: "picker" },
  {
    id: "moveRow",
    chords: [
      { key: "ArrowUp" },
      { key: "ArrowDown" },
      { key: "ArrowLeft" },
      { key: "ArrowRight" },
      { key: "Home" },
      { key: "End" },
    ],
    action: "Move between a list's pull requests, or the activity calendar's days",
    scope: "picker",
  },
  { id: "openRow", chords: [{ key: "Enter" }], action: "Open the pull request", scope: "picker" },
  {
    id: "cancelOpening",
    chords: [{ key: "Escape" }],
    action: "Stop waiting for a review to open",
    scope: "picker",
  },
];

const BY_ID: ReadonlyMap<ShortcutId, Shortcut> = new Map(KEYMAP.map((entry) => [entry.id, entry]));

export const shortcut = (id: ShortcutId): Shortcut => {
  const entry = BY_ID.get(id);
  if (entry === undefined) throw new Error(`No shortcut ${id}`);
  return entry;
};

/** Keys that work while typing. */
const ALWAYS_ON = new Set(["Escape"]);

/** A chord typing would collide with: no modifier, so the key would also go into a field. */
export const isPlainKey = (chord: KeyChord): boolean =>
  chord.mod !== true && !ALWAYS_ON.has(chord.key);

/**
 * A character key with no modifier, the kind WCAG 2.1.4 lets users turn off, since speech input
 * types characters by accident. Arrow keys aren't characters and stay on.
 */
export const isCharacterKey = (chord: KeyChord): boolean =>
  chord.mod !== true && chord.key.length === 1;

const SYMBOLS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  Escape: "Esc",
  Home: "Home",
  End: "End",
};

/** A chord as a hint shows it, one string per key: ["⌘", "↵"], ["⇧", "R"]. */
export const chordKeys = (chord: KeyChord, mac: boolean): string[] => {
  const keys: string[] = [];
  if (chord.mod === true) keys.push(mac ? "⌘" : "Ctrl");
  // `?` is typed with shift on every layout, so it needs no ⇧ beside it.
  if (chord.shift === true && chord.key !== "?") keys.push("⇧");
  keys.push(SYMBOLS[chord.key] ?? chord.key);
  return keys;
};

interface KeyEventLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

export const matchesChord = (event: KeyEventLike, chord: KeyChord, mac: boolean): boolean => {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  if (event.altKey || otherMod || mod !== (chord.mod === true)) return false;
  // A printable key already carries shift in its value ("R", "?"), so only named keys check it.
  if (chord.key.length > 1 && event.shiftKey !== (chord.shift === true)) return false;
  return event.key === chord.key;
};

/** The element takes text, so a key typed there is text, not a shortcut. */
export const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
    target.type,
  );
};

/**
 * The shortcut an event runs, among `ids`, or null. A key without a modifier is skipped while
 * typing, and a character key also when single-key shortcuts are off.
 */
export const shortcutFor = (
  event: KeyEventLike & { readonly target: EventTarget | null },
  ids: readonly ShortcutId[],
  options: { readonly mac: boolean; readonly singleKeys: boolean },
): ShortcutId | null => {
  const typing = isTextEntry(event.target);
  for (const id of ids) {
    for (const chord of shortcut(id).chords) {
      if (!matchesChord(event, chord, options.mac)) continue;
      if (isPlainKey(chord) && typing) continue;
      if (isCharacterKey(chord) && !options.singleKeys) continue;
      return id;
    }
  }
  return null;
};

export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// The single-key preference, per browser. Storage can be missing or throw, e.g. in a private
// window; then shortcuts are on and nothing is remembered.
const SINGLE_KEYS = "megareviewer:singleKeyShortcuts";
const listeners = new Set<() => void>();

const readSingleKeys = (): boolean => {
  try {
    return window.localStorage.getItem(SINGLE_KEYS) !== "false";
  } catch {
    return true;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

/** Whether single-key shortcuts are on, and a setter that remembers the choice. */
export const useSingleKeyShortcuts = (): readonly [boolean, (on: boolean) => void] => {
  const on = useSyncExternalStore(subscribe, readSingleKeys);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SINGLE_KEYS, String(next));
    } catch {
      // Not remembered.
    }
    for (const listener of listeners) listener();
  }, []);
  return [on, set] as const;
};

export type ShortcutHandlers = Partial<
  Readonly<Record<ShortcutId, (event: KeyboardEvent) => void>>
>;

/**
 * Runs `handlers` on key presses anywhere on the page. A handled key doesn't reach the browser,
 * so ↓ moves the line focus rather than scrolling.
 */
export const useShortcuts = (handlers: ShortcutHandlers, enabled = true): void => {
  const [singleKeys] = useSingleKeyShortcuts();
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const mac = isMac();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const ids = KEYMAP.filter((entry) => latest.current[entry.id] !== undefined).map(
        (entry) => entry.id,
      );
      const id = shortcutFor(event, ids, { mac, singleKeys });
      if (id === null) return;
      event.preventDefault();
      latest.current[id]?.(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, singleKeys]);
};
