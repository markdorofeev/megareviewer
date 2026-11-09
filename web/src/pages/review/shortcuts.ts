import { useEffect, useRef } from "react";
import type { Layout } from "./model.ts";

export type ShortcutAction =
  | "next-hunk"
  | "previous-hunk"
  | "next-file"
  | "previous-file"
  | "toggle-reviewed"
  | "next-unreviewed"
  | "previous-unreviewed"
  | "jump"
  | "toggle-layout"
  | "open-call"
  | "move-file"
  | "open-file"
  | "approve"
  | "reject"
  | "comment"
  | "escape"
  | "help";

const BOTH: readonly Layout[] = ["map", "overview"];

/** Keys the focused file in the overview handles itself, listed for the shortcuts dialog. */
const LOCAL: ReadonlySet<ShortcutAction> = new Set(["move-file", "open-file"]);

export const SHORTCUTS: readonly {
  readonly keys: readonly string[];
  readonly action: ShortcutAction;
  readonly description: string;
  readonly layouts: readonly Layout[];
}[] = [
  { keys: ["j"], action: "next-hunk", description: "Next hunk", layouts: ["map"] },
  { keys: ["k"], action: "previous-hunk", description: "Previous hunk", layouts: ["map"] },
  { keys: ["n"], action: "next-file", description: "Next file", layouts: ["map"] },
  { keys: ["p"], action: "previous-file", description: "Previous file", layouts: ["map"] },
  {
    keys: ["o"],
    action: "open-call",
    description: "Open or close the hunk's first call",
    layouts: ["map"],
  },
  {
    keys: ["x"],
    action: "toggle-reviewed",
    description: "Mark the hunk reviewed and go to the next",
    layouts: ["map"],
  },
  { keys: ["]"], action: "next-unreviewed", description: "Next unreviewed hunk", layouts: ["map"] },
  {
    keys: ["["],
    action: "previous-unreviewed",
    description: "Previous unreviewed hunk",
    layouts: ["map"],
  },
  {
    keys: ["a"],
    action: "approve",
    description: "Approve the selected decision",
    layouts: ["map"],
  },
  { keys: ["r"], action: "reject", description: "Reject the selected decision", layouts: ["map"] },
  {
    keys: ["c"],
    action: "comment",
    description: "Comment on the selected decision, or on the focused hunk",
    layouts: ["map"],
  },
  {
    keys: ["Escape"],
    action: "escape",
    description:
      "Clear the selection, go back to where a link was followed from, or back to the overview",
    layouts: ["map"],
  },
  {
    keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
    action: "move-file",
    description: "Move between files",
    layouts: ["overview"],
  },
  {
    keys: ["Enter"],
    action: "open-file",
    description: "Open the file's code in the map, or a group of files in place",
    layouts: ["overview"],
  },
  { keys: ["⌘K", "t"], action: "jump", description: "Jump to anything", layouts: BOTH },
  { keys: ["v"], action: "toggle-layout", description: "Map or overview", layouts: BOTH },
  { keys: ["?"], action: "help", description: "Show these shortcuts", layouts: BOTH },
];

const actionsFor = (layout: Layout) =>
  new Map(
    SHORTCUTS.filter(
      ({ layouts, action }) => layouts.includes(layout) && !LOCAL.has(action),
    ).flatMap(({ keys, action }) => keys.map((key) => [key, action])),
  );
const ACTIONS: Readonly<Record<Layout, ReadonlyMap<string, ShortcutAction>>> = {
  map: actionsFor("map"),
  overview: actionsFor("overview"),
};

export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The action a key press asks for in this layout, or null. Typing in a text field never triggers
 * one. ⌘K and Ctrl+K are the only shortcuts with a modifier.
 */
export const shortcutFor = (
  event: Pick<KeyboardEvent, "key" | "target" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  layout: Layout,
): ShortcutAction | null => {
  if (isTextField(event.target) || event.altKey) return null;
  if (event.metaKey || event.ctrlKey) {
    return event.key.toLowerCase() === "k" && !event.shiftKey ? "jump" : null;
  }
  return ACTIONS[layout].get(event.key) ?? null;
};

/** Calls `onAction` for shortcut keys pressed anywhere on the page while `enabled`. */
export const useShortcuts = (
  enabled: boolean,
  layout: Layout,
  onAction: (action: ShortcutAction) => void,
) => {
  // The latest handler, so the listener isn't re-added on every render.
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });
  useEffect(() => {
    if (!enabled) return;
    const listen = (event: KeyboardEvent) => {
      const action = shortcutFor(event, layout);
      if (action === null) return;
      event.preventDefault();
      handler.current(action);
    };
    document.addEventListener("keydown", listen);
    return () => document.removeEventListener("keydown", listen);
  }, [enabled, layout]);
};
