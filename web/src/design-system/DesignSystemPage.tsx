import type { ReactNode } from "react";
import { type DiffPalette, type ThemePreference, useTheme } from "../lib/theme.ts";
import { cn } from "../lib/utils.ts";

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];
const PALETTES: readonly { readonly value: DiffPalette; readonly label: string }[] = [
  { value: "default", label: "Default" },
  { value: "cb", label: "Color-blind safe" },
];

/** The Indigo Calm tokens and components in every state, with the theme switches on top. */
export const DesignSystemPage = () => {
  const { theme, resolvedTheme, diffPalette, setTheme, setDiffPalette } = useTheme();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 flex h-12 items-center gap-6 border-b bg-background px-8 shadow-sm">
        <h1 className="text-heading font-semibold">Indigo Calm</h1>
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Theme</legend>
          {THEMES.map(({ value, label }) => (
            <SegmentButton key={value} pressed={theme === value} onClick={() => setTheme(value)}>
              {value === "system" ? `${label} (${resolvedTheme})` : label}
            </SegmentButton>
          ))}
        </fieldset>
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Diff palette</legend>
          {PALETTES.map(({ value, label }) => (
            <SegmentButton
              key={value}
              pressed={diffPalette === value}
              onClick={() => setDiffPalette(value)}
            >
              {label}
            </SegmentButton>
          ))}
        </fieldset>
      </header>
      <main className="flex flex-col gap-8 px-8 py-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-heading font-semibold">Type</h2>
          <p className="text-title font-semibold tracking-[-0.01em]">Title 20/28</p>
          <p className="text-body">Body 14/22: descriptions and comment bodies.</p>
          <p>UI 13/20, the body default.</p>
          <p className="text-caption text-muted-foreground">Caption 12/16</p>
          <code className="text-code">{"const ok = a !== b && f => g; // no ligatures"}</code>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-heading font-semibold">Diff</h2>
          <div className="overflow-hidden rounded-lg border font-mono text-code">
            <div className="flex bg-diff-add-bg">
              <span className="w-6 bg-diff-add-gutter text-center text-diff-add-fg">+</span>
              <span className="px-2">
                return <span className="rounded-sm bg-diff-add-word">retry(3)</span>
                {";"}
              </span>
            </div>
            <div className="flex bg-diff-del-bg">
              <span className="w-6 bg-diff-del-gutter text-center text-diff-del-fg">−</span>
              <span className="px-2">
                return <span className="rounded-sm bg-diff-del-word">once()</span>
                {";"}
              </span>
            </div>
          </div>
          <p className="text-review-approved">✓ Approved</p>
          <div className="w-64 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
            Popover: rounded-xl, shadow-lg
          </div>
        </section>
      </main>
    </div>
  );
};

const SegmentButton = ({
  pressed,
  onClick,
  children,
}: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      "h-7 rounded-md px-2 transition-colors duration-(--duration-fast) ease-standard",
      pressed ? "bg-primary text-primary-foreground" : "hover:bg-accent",
    )}
  >
    {children}
  </button>
);
