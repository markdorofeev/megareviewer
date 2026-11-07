import { describe, expect, it } from "vitest";
import css from "./tokens.css?raw";

const colors = (block: string): Map<string, string> =>
  new Map(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name = "", hex = ""]) => [
      name,
      hex,
    ]),
  );

const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = colors(css.slice(0, darkStart));
const dark = new Map([...light, ...colors(css.slice(darkStart))]);

/** WCAG 2 relative luminance. */
const luminance = (hex: string): number => {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const contrast = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

const SURFACES = ["color-surface", "color-surface-subtle", "color-surface-sunken"];
const TEXT_ON_SURFACES = [
  "color-text",
  "color-text-muted",
  "color-accent",
  "color-success",
  "color-warning",
  "color-danger",
];
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ...SURFACES.flatMap((surface) => TEXT_ON_SURFACES.map((text) => [surface, text] as const)),
  ["color-accent-bg", "color-on-accent"],
  ["color-accent-subtle", "color-text"],
  ["color-accent-subtle", "color-text-muted"],
  ["color-accent-subtle", "color-accent"],
  ["color-danger-subtle", "color-text"],
  ["color-danger-subtle", "color-danger"],
  ["color-warning-subtle", "color-text"],
  ["risk-contract-bg", "risk-contract-text"],
  ["risk-logic-bg", "risk-logic-text"],
  ["risk-mechanical-bg", "risk-mechanical-text"],
  ["diff-added-bg", "color-text"],
  ["diff-added-word-bg", "color-text"],
  ["diff-deleted-bg", "color-text"],
  ["diff-deleted-word-bg", "color-text"],
];
const CONTROL_PAIRS: readonly (readonly [string, string])[] = [
  ["color-surface", "color-border-strong"],
  ["color-surface", "color-focus"],
];

const stylesheets = import.meta.glob<string>("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every rule that sets both a background token and a text token, as [selector, background, text]. */
const rulePairs = Object.values(stylesheets).flatMap((sheet) =>
  [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector = "", body = ""]) => {
    const background = body.match(/(?:^|[\s;])background(?:-color)?:\s*var\(--([\w-]+)\)\s*;/)?.[1];
    const text = body.match(/(?:^|[\s;])color:\s*var\(--([\w-]+)\)\s*;/)?.[1];
    return background === undefined || text === undefined
      ? []
      : [[selector.replace(/\/\*.*?\*\//gs, "").trim(), background, text] as const];
  }),
);

describe.each([
  ["light", light],
  ["dark", dark],
])("%s tokens", (_, tokens) => {
  const color = (name: string): string => {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`no token --${name}`);
    return value;
  };

  it("finds the rules that set a background and a text color", () => {
    expect(rulePairs.length).toBeGreaterThan(10);
  });

  it.each(rulePairs)("%s: %s with %s text meets AA (4.5:1)", (_selector, background, text) => {
    expect(contrast(color(background), color(text))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_PAIRS)("%s with %s text meets AA (4.5:1)", (background, text) => {
    expect(contrast(color(background), color(text))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CONTROL_PAIRS)("%s with %s meets 3:1 for controls", (background, control) => {
    expect(contrast(color(background), color(control))).toBeGreaterThanOrEqual(3);
  });
});
