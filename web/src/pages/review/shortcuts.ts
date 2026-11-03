import { useEffect, useRef } from "react";
import type { Layout } from "./model.ts";

export type ShortcutAction =
  | "next-hunk"
  | "previous-hunk"
  | "next-step"
  | "previous-step"
  | "toggle-reviewed"
  | "next-unreviewed"
  | "previous-unreviewed"
  | "jump"
  | "toggle-layout"
  | "open-call"
  | "first-call"
  | "back-to-caller"
  | "approve"
  | "reject"
  | "comment"
  | "escape"
  | "help";

const BOTH: readonly Layout[] = ["map", "tree"];

export const SHORTCUTS: readonly {
  readonly keys: readonly string[];
  readonly action: ShortcutAction;
  readonly description: string;
  readonly layouts: readonly Layout[];
}[] = [
  { keys: ["j"], action: "next-hunk", description: "Next hunk", layouts: ["map"] },
  { keys: ["k"], action: "previous-hunk", description: "Previous hunk", layouts: ["map"] },
  {
    keys: ["j"],
    action: "next-hunk",
    description: "Next hunk in the tree",
    layouts: ["tree"],
  },
  {
    keys: ["k"],
    action: "previous-hunk",
    description: "Previous hunk in the tree",
    layouts: ["tree"],
  },
  { keys: ["n"], action: "next-step", description: "Next tour step", layouts: ["map"] },
  { keys: ["p"], action: "previous-step", description: "Previous tour step", layouts: ["map"] },
  {
    keys: ["o"],
    action: "open-call",
    description: "Open or close the hunk's first call",
    layouts: ["map"],
  },
  {
    keys: ["ArrowRight"],
    action: "first-call",
    description: "The first hunk this one calls",
    layouts: ["tree"],
  },
  {
    keys: ["ArrowLeft"],
    action: "back-to-caller",
    description: "Back to the caller you came from",
    layouts: ["tree"],
  },
  {
    keys: ["x"],
    action: "toggle-reviewed",
    description: "Mark the hunk reviewed and go to the next",
    layouts: BOTH,
  },
  { keys: ["]"], action: "next-unreviewed", description: "Next unreviewed hunk", layouts: BOTH },
  {
    keys: ["["],
    action: "previous-unreviewed",
    description: "Previous unreviewed hunk",
    layouts: BOTH,
  },
  { keys: ["⌘K", "t"], action: "jump", description: "Jump to anything", layouts: BOTH },
  { keys: ["v"], action: "toggle-layout", description: "Map or call tree", layouts: BOTH },
  { keys: ["a"], action: "approve", description: "Approve the selected decision", layouts: BOTH },
  { keys: ["r"], action: "reject", description: "Reject the selected decision", layouts: BOTH },
  {
    keys: ["c"],
    action: "comment",
    description: "Comment on the selected decision, or on the focused hunk",
    layouts: BOTH,
  },
  {
    keys: ["Escape"],
    action: "escape",
    description: "Clear the selection, or go back to where a link was followed from",
    layouts: BOTH,
  },
  { keys: ["?"], action: "help", description: "Show these shortcuts", layouts: BOTH },
];

const actionsFor = (layout: Layout) =>
  new Map(
    SHORTCUTS.filter(({ layouts }) => layouts.includes(layout)).flatMap(({ keys, action }) =>
      keys.map((key) => [key, action]),
    ),
  );
const ACTIONS: Readonly<Record<Layout, ReadonlyMap<string, ShortcutAction>>> = {
  map: actionsFor("map"),
  tree: actionsFor("tree"),
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
