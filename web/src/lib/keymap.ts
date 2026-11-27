import { useEffect, useRef } from "react";

// The one table of keyboard shortcuts. Handlers and key hints read it, so a hint can't name a key
// that does something else. Keys without a modifier never fire while typing.

export type ShortcutId =
  | "lineDown"
  | "lineUp"
  | "extendDown"
  | "extendUp"
  | "submit"
  | "close"
  | "openInNewTab";

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
}

export const KEYMAP: readonly Shortcut[] = [
  { id: "lineDown", chords: [{ key: "ArrowDown" }] },
  { id: "lineUp", chords: [{ key: "ArrowUp" }] },
  { id: "extendDown", chords: [{ key: "ArrowDown", shift: true }] },
  { id: "extendUp", chords: [{ key: "ArrowUp", shift: true }] },
  { id: "submit", chords: [{ key: "Enter", mod: true }] },
  { id: "close", chords: [{ key: "Escape" }] },
  { id: "openInNewTab", chords: [{ key: "Enter", mod: true }] },
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

const SYMBOLS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
  Enter: "↵",
  Escape: "Esc",
};

/** A chord as a hint shows it, one string per key: ["⌘", "↵"], ["⇧", "↑"]. */
export const chordKeys = (chord: KeyChord, mac: boolean): string[] => {
  const keys: string[] = [];
  if (chord.mod === true) keys.push(mac ? "⌘" : "Ctrl");
  if (chord.shift === true) keys.push("⇧");
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

/** The shortcut an event runs, among `ids`, or null. A key without a modifier is skipped while typing. */
export const shortcutFor = (
  event: KeyEventLike & { readonly target: EventTarget | null },
  ids: readonly ShortcutId[],
  options: { readonly mac: boolean },
): ShortcutId | null => {
  const typing = isTextEntry(event.target);
  for (const id of ids) {
    for (const chord of shortcut(id).chords) {
      if (!matchesChord(event, chord, options.mac)) continue;
      if (isPlainKey(chord) && typing) continue;
      return id;
    }
  }
  return null;
};

export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export type ShortcutHandlers = Partial<
  Readonly<Record<ShortcutId, (event: KeyboardEvent) => void>>
>;

/**
 * Runs `handlers` on key presses anywhere on the page. A handled key doesn't reach the browser,
 * so ↓ moves the line focus rather than scrolling.
 */
export const useShortcuts = (handlers: ShortcutHandlers, enabled = true): void => {
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
      const id = shortcutFor(event, ids, { mac });
      if (id === null) return;
      event.preventDefault();
      latest.current[id]?.(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
};
