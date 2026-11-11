import { useMemo } from "react";
import {
  chordKeys,
  isCharacterKey,
  isMac,
  type ShortcutId,
  shortcut,
  useSingleKeyShortcuts,
} from "../../lib/keymap.ts";
import { cn } from "../../lib/utils.ts";
import { Kbd, KbdGroup } from "../../ui/kbd.tsx";

export interface KeyHintProps {
  /** The shortcut, from the keymap, so the hint always names the key that works. */
  readonly id: ShortcutId;
  readonly className?: string;
}

/**
 * A shortcut's key as chips: `n`, `⇧ R`, `⌘ ↵`. Hidden when single-key shortcuts are off and this
 * one is a character key, since the key wouldn't work then. Decorative: the action has its own
 * label.
 */
export const KeyHint = ({ id, className }: KeyHintProps) => {
  const [singleKeys] = useSingleKeyShortcuts();
  const mac = useMemo(isMac, []);
  const [chord] = shortcut(id).chords;
  if (chord === undefined || (!singleKeys && isCharacterKey(chord))) return null;
  return (
    <KbdGroup aria-hidden="true" className={cn("shrink-0", className)}>
      {chordKeys(chord, mac).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
};
