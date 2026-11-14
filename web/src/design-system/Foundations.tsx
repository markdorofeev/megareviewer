import { type ReactNode, useEffect, useState } from "react";
import { useTheme } from "../lib/theme.ts";
import { cn } from "../lib/utils.ts";
import { tokenMs } from "../pages/review/useLanding.ts";
import { Button } from "../ui/button.tsx";

// The tokens of globals.css, shown live: swatches read the variables, so they follow the theme
// and the diff palette as they're switched.

const COLOR_GROUPS: readonly { readonly title: string; readonly tokens: readonly string[] }[] = [
  {
    title: "Surfaces and text",
    tokens: [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "surface-subtle",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "secondary",
      "secondary-foreground",
      "border",
      "input",
    ],
  },
  {
    title: "Action and focus",
    tokens: ["primary", "primary-foreground", "ring", "destructive"],
  },
  {
    title: "Diff (follows the color-blind switch)",
    tokens: [
      "diff-add-bg",
      "diff-add-word",
      "diff-add-gutter",
      "diff-add-fg",
      "diff-del-bg",
      "diff-del-word",
      "diff-del-gutter",
      "diff-del-fg",
      "diff-mod-fg",
      "diff-hunk-bg",
      "diff-hunk-fg",
      "diff-gutter-bg",
      "diff-gutter-fg",
    ],
  },
  {
    title: "Risk",
    tokens: ["contract", "logic", "mechanical"].flatMap((risk) =>
      ["", "-bg", "-border", "-solid"].map((part) => `risk-${risk}${part}`),
    ),
  },
  {
    title: "Review states",
    tokens: ["approved", "changes", "pending", "commented"].flatMap((state) => [
      `review-${state}`,
      `review-${state}-bg`,
    ]),
  },
  {
    title: "Comments",
    tokens: ["thread-bg", "thread-border", "thread-marker", "suggestion-bg"],
  },
  {
    title: "CI (no component uses them yet), and the severity of Claude's findings",
    tokens: [
      "ci-success",
      "ci-failure",
      "ci-running",
      "ci-running-bg",
      "ci-queued",
      "ci-skipped",
      "severity-blocker",
      "severity-major",
      "severity-major-bg",
      "severity-minor",
      "severity-nit",
      "severity-info",
    ],
  },
  {
    title: "Review activity, by pull requests reviewed a day",
    tokens: ["activity-1", "activity-2", "activity-3"],
  },
  {
    title: "Authors' initials, one pair per author",
    tokens: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [`avatar-${n}-bg`, `avatar-${n}-fg`]),
  },
  {
    title: "Syntax",
    tokens: [
      "syntax-keyword",
      "syntax-string",
      "syntax-function",
      "syntax-comment",
      "syntax-number",
    ],
  },
];

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const TYPE_SCALE = [
  { name: "text-title", className: "text-title font-semibold tracking-[-0.01em]", use: "PR title" },
  { name: "text-heading", className: "text-heading font-semibold", use: "Panel and dialog titles" },
  { name: "text-body", className: "text-body", use: "Descriptions, comment bodies" },
  { name: "text-ui", className: "text-ui", use: "Buttons, tabs, tree; the body default" },
  { name: "text-caption", className: "text-caption", use: "Badges, meta" },
  { name: "text-code", className: "font-mono text-code", use: "Diff, default density" },
  {
    name: "text-code-compact",
    className: "font-mono text-code-compact",
    use: "Compact density, counts",
  },
  { name: "text-code-comfy", className: "font-mono text-code-comfy", use: "Comfortable density" },
  { name: "text-kbd", className: "font-mono text-kbd font-medium", use: "Key hints" },
] as const;

const SPACING = [
  { step: "0.5", px: 2, className: "w-0.5" },
  { step: "1", px: 4, className: "w-1" },
  { step: "1.5", px: 6, className: "w-1.5" },
  { step: "2", px: 8, className: "w-2" },
  { step: "3", px: 12, className: "w-3" },
  { step: "4", px: 16, className: "w-4" },
  { step: "6", px: 24, className: "w-6" },
  { step: "8", px: 32, className: "w-8" },
] as const;

const RADII = [
  { name: "rounded-sm", px: "4", use: "kbd, word highlight", className: "rounded-sm" },
  { name: "rounded-md", px: "6", use: "buttons, inputs, rows", className: "rounded-md" },
  { name: "rounded-lg", px: "8", use: "cards, files", className: "rounded-lg" },
  { name: "rounded-xl", px: "12", use: "dialogs, popovers", className: "rounded-xl" },
  { name: "rounded-full", px: "∞", use: "pills, switches", className: "rounded-full" },
] as const;

const SHADOWS = [
  { name: "shadow-sm", use: "Sticky headers", className: "shadow-sm" },
  { name: "shadow-md", use: "Popovers, menus", className: "shadow-md" },
  { name: "shadow-lg", use: "Dialogs, sheets", className: "shadow-lg" },
] as const;

const MOTION = [
  {
    name: "--duration-fast",
    ms: 100,
    use: "Hover, focus, press",
    className: "duration-(--duration-fast)",
  },
  {
    name: "--duration-base",
    ms: 150,
    use: "Popover, collapse",
    className: "duration-(--duration-base)",
  },
  {
    name: "--duration-slow",
    ms: 200,
    use: "Dialog, sheet",
    className: "duration-(--duration-slow)",
  },
] as const;

/** Colors, type, spacing, radius, elevation and motion. */
export const Foundations = () => (
  <div className="flex flex-col gap-10">
    <Colors />
    <Group title="Type scale">
      <dl className="flex flex-col divide-y rounded-lg border">
        {TYPE_SCALE.map((entry) => (
          <div key={entry.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
            <dt className="w-40 font-mono text-code-compact text-muted-foreground">{entry.name}</dt>
            <dd className={cn("min-w-0 flex-1", entry.className)}>
              {entry.use}: const ok = a !== b;
            </dd>
          </div>
        ))}
      </dl>
    </Group>
    <Group title="Spacing (Tailwind's 4px steps)">
      <dl className="flex flex-col gap-1.5">
        {SPACING.map((entry) => (
          <div key={entry.step} className="flex items-center gap-3">
            <dt className="tabular w-24 font-mono text-code-compact text-muted-foreground">
              {entry.step} = {entry.px}px
            </dt>
            <dd className={cn("h-4 rounded-sm bg-primary", entry.className)} />
          </div>
        ))}
      </dl>
    </Group>
    <Group title="Radius">
      <div className="flex flex-wrap gap-4">
        {RADII.map((entry) => (
          <figure key={entry.name} className="flex flex-col items-center gap-1.5">
            <div className={cn("size-16 border-2 border-primary bg-muted", entry.className)} />
            <figcaption className="text-center text-caption">
              <span className="font-mono">{entry.name}</span> {entry.px}px
              <span className="block text-muted-foreground">{entry.use}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Group>
    <Group title="Elevation (only sticky headers, popovers and dialogs)">
      <div className="flex flex-wrap gap-6 rounded-lg bg-surface-subtle p-6">
        {SHADOWS.map((entry) => (
          <div
            key={entry.name}
            className={cn(
              "flex h-20 w-40 flex-col justify-center rounded-lg bg-popover px-3",
              entry.className,
            )}
          >
            <span className="font-mono text-code-compact">{entry.name}</span>
            <span className="text-caption text-muted-foreground">{entry.use}</span>
          </div>
        ))}
      </div>
    </Group>
    <Motion />
  </div>
);

const Colors = () => {
  const { resolvedTheme, diffPalette } = useTheme();
  const [values, setValues] = useState<ReadonlyMap<string, string>>(new Map());
  // Read after the theme's class and attribute are on <html>, so the values are the ones in use.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the variables change with the theme.
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(
      new Map(
        COLOR_GROUPS.flatMap((group) => group.tokens).map((token) => [
          token,
          style.getPropertyValue(`--${token}`).trim(),
        ]),
      ),
    );
  }, [resolvedTheme, diffPalette]);
  return (
    <Group title={`Colors (${resolvedTheme}${diffPalette === "cb" ? ", color-blind diff" : ""})`}>
      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="flex flex-col gap-2">
          <h4 className="text-caption font-medium text-muted-foreground">{group.title}</h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
            {group.tokens.map((token) => (
              <li key={token} className="flex items-center gap-2 rounded-md border p-1.5">
                <span
                  aria-hidden="true"
                  className="size-8 shrink-0 rounded-sm border"
                  style={{ background: `var(--${token})` }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-code-compact">{token}</span>
                  <span className="tabular block font-mono text-caption text-muted-foreground">
                    {values.get(token) ?? ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Group>
  );
};

/** The tokens Claude's run plays to: the hairline's loop while it reads, and the landing. */
const LANDING_MOTION = [
  { name: "--hairline-loop", use: "The hairline's trip along the header while Claude reads" },
  { name: "--hairline-finish", use: "The hairline running out to full width and fading" },
  { name: "--landing-step-chip", use: "Between the receipt's chips" },
  { name: "--landing-count", use: "A chip's count rolling up from zero" },
  { name: "--landing-at-tree", use: "When the tree's marks start" },
  { name: "--landing-step-tree", use: "Between the tree's rows, at most" },
  { name: "--landing-span-tree", use: "By when the last row's mark has started" },
  { name: "--landing-at-code", use: "When the code's points start" },
  { name: "--landing-step-code", use: "Between points in view" },
  { name: "--landing-bar", use: "A point's mark drawing down its lines' numbers" },
  { name: "--landing-wash", use: "The kind's wash passing over the lines" },
  { name: "--landing-unfold", use: "A card unfolding under its lines" },
  { name: "--landing-total", use: "The landing, for one point in view" },
] as const;

const Motion = () => {
  const [moved, setMoved] = useState(false);
  return (
    <Group title="Motion (ease-standard; all 0ms under reduced motion)">
      <div className="flex flex-col gap-3">
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setMoved(!moved)}>
          Play
        </Button>
        {MOTION.map((entry) => (
          <div key={entry.name} className="flex flex-wrap items-center gap-3">
            <span className="tabular w-48 font-mono text-code-compact text-muted-foreground">
              {entry.name} {entry.ms}ms
            </span>
            <div className="relative h-6 w-48 rounded-full bg-muted">
              <span
                className={cn(
                  "absolute top-1 left-1 size-4 rounded-full bg-primary transition-transform ease-standard",
                  entry.className,
                  moved && "translate-x-[10.5rem]",
                )}
              />
            </div>
            <span className="text-caption text-muted-foreground">{entry.use}</span>
          </div>
        ))}
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[14rem_4rem_minmax(0,1fr)]">
          {LANDING_MOTION.map((entry) => (
            <div key={entry.name} className="contents">
              <dt className="font-mono text-code-compact text-muted-foreground">{entry.name}</dt>
              <dd className="tabular font-mono text-code-compact">{tokenMs(entry.name)}ms</dd>
              <dd className="text-caption text-muted-foreground">{entry.use}</dd>
            </div>
          ))}
        </dl>
        <p className="text-caption text-muted-foreground">
          Played on Claude's run landing, under Domain components.
        </p>
      </div>
    </Group>
  );
};

const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h3 className="text-heading font-semibold">{title}</h3>
    {children}
  </section>
);
