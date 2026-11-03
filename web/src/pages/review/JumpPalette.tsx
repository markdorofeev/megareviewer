import { useMemo, useState } from "react";
import { Dialog } from "./Dialog.tsx";
import { type PaletteItem, type PaletteTarget, searchPalette } from "./palette.ts";

/**
 * One search over decisions, mismatches, contract changes, symbols, steps and files. Arrows move,
 * Enter opens; `!`, `@` and `/` narrow it to findings, symbols and files.
 */
export const JumpPalette = ({
  items,
  onPick,
  onClose,
}: {
  readonly items: readonly PaletteItem[];
  readonly onPick: (target: PaletteTarget) => void;
  readonly onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const groups = useMemo(() => searchPalette(items, query), [items, query]);
  const flat = groups.flatMap((group) => group.items);
  const at = Math.min(active, Math.max(flat.length - 1, 0));
  const current = flat[at];

  return (
    <Dialog title="Jump to" onClose={onClose} className="jump-palette">
      <input
        type="search"
        className="input"
        aria-label="Jump to"
        placeholder="A decision, function, step or file · ! findings · @ symbols · / files"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive(Math.min(Math.max(at + step, 0), Math.max(flat.length - 1, 0)));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (current !== undefined) onPick(current.target);
          }
        }}
        data-autofocus
      />
      {flat.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <div className="palette-results">
          {groups.map((group) => (
            <section key={group.group} aria-label={group.title}>
              <h3 className="palette-group">{group.title}</h3>
              <ul className="palette-list">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className={`palette-item${item === current ? " active" : ""}`}
                      aria-current={item === current ? "true" : undefined}
                      onClick={() => onPick(item.target)}
                    >
                      <span className="palette-label model-text">{item.label}</span>
                      <span className="palette-detail">{item.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
};
