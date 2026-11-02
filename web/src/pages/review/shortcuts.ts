import { useEffect, useRef } from "react";

export type ShortcutAction =
  | "next-hunk"
  | "previous-hunk"
  | "next-step"
  | "previous-step"
  | "toggle-reviewed"
  | "next-unreviewed"
  | "previous-unreviewed"
  | "find-file"
  | "approve"
  | "reject"
  | "comment"
  | "escape"
  | "help";

export const SHORTCUTS: readonly {
  readonly keys: readonly string[];
  readonly action: ShortcutAction;
  readonly description: string;
}[] = [
  { keys: ["j"], action: "next-hunk", description: "Next hunk" },
  { keys: ["k"], action: "previous-hunk", description: "Previous hunk" },
  { keys: ["n"], action: "next-step", description: "Next tour step" },
  { keys: ["p"], action: "previous-step", description: "Previous tour step" },
  {
    keys: ["x"],
    action: "toggle-reviewed",
    description: "Mark the hunk reviewed and go to the next",
  },
  { keys: ["]"], action: "next-unreviewed", description: "Next unreviewed hunk" },
  { keys: ["["], action: "previous-unreviewed", description: "Previous unreviewed hunk" },
  { keys: ["t"], action: "find-file", description: "Go to a file" },
  { keys: ["a"], action: "approve", description: "Approve the selected decision" },
  { keys: ["r"], action: "reject", description: "Reject the selected decision" },
  {
    keys: ["c"],
    action: "comment",
    description: "Comment on the selected decision, or on the focused hunk",
  },
  {
    keys: ["Escape"],
    action: "escape",
    description: "Back to the tour, or to where a link was followed from",
  },
  { keys: ["?"], action: "help", description: "Show these shortcuts" },
];

const ACTIONS = new Map(SHORTCUTS.flatMap(({ keys, action }) => keys.map((key) => [key, action])));

export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The action a key press asks for, or null. Typing in a text field never triggers one. */
export const shortcutFor = (
  event: Pick<KeyboardEvent, "key" | "target" | "metaKey" | "ctrlKey" | "altKey">,
): ShortcutAction | null => {
  if (event.metaKey || event.ctrlKey || event.altKey || isTextField(event.target)) return null;
  return ACTIONS.get(event.key) ?? null;
};

/** Calls `onAction` for shortcut keys pressed anywhere on the page while `enabled`. */
export const useShortcuts = (enabled: boolean, onAction: (action: ShortcutAction) => void) => {
  // The latest handler, so the listener isn't re-added on every render.
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });
  useEffect(() => {
    if (!enabled) return;
    const listen = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (action === null) return;
      event.preventDefault();
      handler.current(action);
    };
    document.addEventListener("keydown", listen);
    return () => document.removeEventListener("keydown", listen);
  }, [enabled]);
};
