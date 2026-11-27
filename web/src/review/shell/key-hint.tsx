import { Fragment, useMemo } from "react";
import { chordKeys, isMac, type ShortcutId, shortcut } from "../../lib/keymap.ts";
import { cn } from "../../lib/utils.ts";
import { Kbd, KbdGroup } from "../../ui/kbd.tsx";

/** A shortcut's key as chips: `⌘ ↵`, `Esc`. Decorative: the action has its own label. */
const KeyHint = ({ id }: { readonly id: ShortcutId }) => {
  const mac = useMemo(isMac, []);
  const [chord] = shortcut(id).chords;
  if (chord === undefined) return null;
  return (
    <KbdGroup aria-hidden="true" className="shrink-0">
      {chordKeys(chord, mac).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
};

/** A field's keys in words under it, e.g. "⌘↵ add to review · Esc cancel". */
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
