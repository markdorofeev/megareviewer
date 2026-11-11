import type { ReactNode } from "react";
import { type DiffPalette, type ThemePreference, useTheme } from "../lib/theme.ts";
import { cn } from "../lib/utils.ts";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { DomainComponents } from "./DomainComponents.tsx";
import { Foundations } from "./Foundations.tsx";
import { Primitives } from "./Primitives.tsx";
import { Screens } from "./Screens.tsx";

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];
const SECTIONS: readonly {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
}[] = [
  { id: "foundations", title: "Foundations", content: <Foundations /> },
  { id: "primitives", title: "Primitives", content: <Primitives /> },
  { id: "components", title: "Review components", content: <DomainComponents /> },
  { id: "screens", title: "Screens", content: <Screens /> },
];

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
        <header className="flex min-h-12 flex-wrap items-center gap-x-6 gap-y-2 border-b bg-background px-4 py-2 shadow-sm sm:px-8">
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
          <nav aria-label="Sections" className="flex flex-wrap gap-x-3 gap-y-1">
            {SECTIONS.map(({ id, title }) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-sm text-primary underline-offset-2 hover:underline"
              >
                {title}
              </a>
            ))}
          </nav>
        </header>
        <main className="flex flex-col gap-12 px-4 py-6 sm:px-8">
          {SECTIONS.map(({ id, title, content }) => (
            <section
              key={id}
              id={id}
              aria-labelledby={`${id}-title`}
              className="flex scroll-mt-28 flex-col gap-4"
            >
              <h2
                id={`${id}-title`}
                className="border-b pb-2 text-title font-semibold tracking-[-0.01em]"
              >
                {title}
              </h2>
              {content}
            </section>
          ))}
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
