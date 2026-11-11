import type { ReactNode } from "react";
import { type DiffPalette, type ThemePreference, useTheme } from "../lib/theme.ts";
import { cn } from "../lib/utils.ts";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { DomainComponents } from "./DomainComponents.tsx";
import { Primitives } from "./Primitives.tsx";

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];
// Spelled out because Tailwind only generates the classes it finds whole in the source.
const RISKS = [
  {
    risk: "contract",
    tint: "border-risk-contract-border bg-risk-contract-bg text-risk-contract",
    bar: "bg-risk-contract-solid",
  },
  {
    risk: "logic",
    tint: "border-risk-logic-border bg-risk-logic-bg text-risk-logic",
    bar: "bg-risk-logic-solid",
  },
  {
    risk: "mechanical",
    tint: "border-risk-mechanical-border bg-risk-mechanical-bg text-risk-mechanical",
    bar: "bg-risk-mechanical-solid",
  },
] as const;

const PALETTES: readonly { readonly value: DiffPalette; readonly label: string }[] = [
  { value: "default", label: "Default" },
  { value: "cb", label: "Color-blind safe" },
];

/** The Indigo Calm tokens and components in every state, with the theme switches on top. */
export const DesignSystemPage = () => {
  const { theme, resolvedTheme, diffPalette, setTheme, setDiffPalette } = useTheme();
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-x-6 gap-y-2 border-b bg-background px-4 py-2 shadow-sm sm:px-8">
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
        <main className="flex flex-col gap-8 px-4 py-6 sm:px-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-semibold">Type</h2>
            <p className="text-title font-semibold tracking-[-0.01em]">Title 20/28</p>
            <p className="text-body">Body 14/22: descriptions and comment bodies.</p>
            <p>UI 13/20, the body default.</p>
            <p className="text-caption text-muted-foreground">Caption 12/16</p>
            <code className="text-code">{"const ok = a !== b && f => g; // no ligatures"}</code>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-semibold">Risk</h2>
            <div className="flex gap-3">
              {RISKS.map(({ risk, tint, bar }) => (
                <div key={risk} className="flex items-stretch gap-2">
                  <span className={cn("w-1 rounded-full", bar)} />
                  <span
                    className={cn("rounded-md border px-2 py-0.5 text-caption font-medium", tint)}
                  >
                    {risk}
                  </span>
                </div>
              ))}
            </div>
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
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-semibold">Primitives</h2>
            <Primitives />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-semibold">Review components</h2>
            <DomainComponents />
          </section>
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
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
