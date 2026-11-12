import { Fragment, useMemo } from "react";
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

/**
 * A field's keys in words under it, e.g. "⌘↵ add to review · Esc cancel", in place of hints on
 * its buttons. Only for keys with a modifier or Esc, which stay on when single keys are off.
 */
export const KeyHintLine = ({
  hints,
  className,
}: {
  readonly hints: readonly { readonly id: ShortcutId; readonly action: string }[];
  readonly className?: string;
}) => (
  <p
    aria-hidden="true"
    data-slot="key-hint-line"
    className={cn(
      "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground",
      className,
    )}
  >
    {hints.map(({ id, action }, at) => (
      <Fragment key={id}>
        {at > 0 && <span>·</span>}
        <KeyHint id={id} />
        <span>{action}</span>
      </Fragment>
    ))}
  </p>
);
