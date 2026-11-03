import { Dialog } from "./Dialog.tsx";
import type { Layout } from "./model.ts";
import { SHORTCUTS } from "./shortcuts.ts";

const KEY_NAMES: Readonly<Record<string, string>> = {
  Escape: "Esc",
  ArrowRight: "→",
  ArrowLeft: "←",
};

const GROUPS: readonly { readonly title: string; readonly layouts: readonly Layout[] }[] = [
  { title: "Map", layouts: ["map"] },
  { title: "Call tree", layouts: ["tree"] },
  { title: "Both layouts", layouts: ["map", "tree"] },
];

export const ShortcutsDialog = ({ onClose }: { readonly onClose: () => void }) => (
  <Dialog title="Keyboard shortcuts" onClose={onClose} className="shortcuts-dialog">
    {GROUPS.map(({ title, layouts }) => (
      <section key={title} aria-label={title}>
        <h3>{title}</h3>
        <dl className="shortcut-list">
          {SHORTCUTS.filter(
            (shortcut) =>
              shortcut.layouts.length === layouts.length &&
              layouts.every((layout) => shortcut.layouts.includes(layout)),
          ).map(({ keys, description }) => (
            <div key={description}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key}>{KEY_NAMES[key] ?? key}</kbd>
                ))}
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>
    ))}
    <p className="muted">Shortcuts don't work while you're typing in a text field.</p>
  </Dialog>
);
