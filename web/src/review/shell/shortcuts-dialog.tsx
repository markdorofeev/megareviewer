import { useId, useMemo } from "react";
import {
  chordKeys,
  isCharacterKey,
  isMac,
  KEYMAP,
  type ShortcutId,
  type ShortcutScope,
  useSingleKeyShortcuts,
} from "../../lib/keymap.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.tsx";
import { Kbd, KbdGroup } from "../../ui/kbd.tsx";
import { Label } from "../../ui/label.tsx";
import { Switch } from "../../ui/switch.tsx";

const SCOPES: readonly { readonly scope: ShortcutScope; readonly title: string }[] = [
  { scope: "global", title: "Anywhere" },
  { scope: "diff", title: "In the code" },
  { scope: "overview", title: "In the overview" },
  { scope: "tree", title: "In the file tree" },
  { scope: "composer", title: "Writing a comment or review" },
];

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The shortcuts this page has; all of them when not given. */
  readonly ids?: readonly ShortcutId[];
}

/** Every shortcut from the keymap, by where it works, and the switch for single-key ones. */
export const ShortcutsDialog = ({ open, onOpenChange, ids }: ShortcutsDialogProps) => {
  const shown = KEYMAP.filter((entry) => ids === undefined || ids.includes(entry.id));
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();
  const mac = useMemo(isMac, []);
  const switchId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keys don't fire while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Label htmlFor={switchId} className="leading-snug">
            Single-key shortcuts
            <span className="block text-caption font-normal text-muted-foreground">
              Letter keys like n and c. Off if they get in the way of speech input or another tool.
            </span>
          </Label>
          <Switch id={switchId} checked={singleKeys} onCheckedChange={setSingleKeys} />
        </div>
        {SCOPES.filter(({ scope }) => shown.some((entry) => entry.scope === scope)).map(
          ({ scope, title }) => (
            <section key={scope} aria-label={title} className="flex flex-col gap-1">
              <h3 className="text-caption font-medium text-muted-foreground">{title}</h3>
              <dl className="flex flex-col">
                {shown
                  .filter((entry) => entry.scope === scope)
                  .map((entry) => {
                    const off = !singleKeys && entry.chords.every(isCharacterKey);
                    return (
                      <div
                        key={entry.id}
                        className="flex min-h-7 items-center justify-between gap-4 border-b py-1 last:border-0"
                      >
                        <dt className={off ? "text-muted-foreground line-through" : undefined}>
                          {entry.action}
                          {off && <span className="sr-only"> (off)</span>}
                        </dt>
                        <dd className="flex gap-2">
                          {entry.chords.map((chord) => (
                            <KbdGroup key={chordKeys(chord, mac).join(" ")}>
                              {chordKeys(chord, mac).map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                              ))}
                            </KbdGroup>
                          ))}
                        </dd>
                      </div>
                    );
                  })}
              </dl>
            </section>
          ),
        )}
      </DialogContent>
    </Dialog>
  );
};
