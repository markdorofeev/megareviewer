#!/usr/bin/env node
/**
 * Recomputes WCAG 2.x contrast for the key token pairs straight from
 * globals.css and exits 1 if any pair drops below its target.
 * Usage: node scripts/check-contrast.mjs [path/to/globals.css]
 * Runs as `pnpm check:contrast`, in CI with the other checks.
 */
import fs from "node:fs";

const file = process.argv[2] ?? new URL("../web/src/styles/globals.css", import.meta.url).pathname;
const css = fs.readFileSync(file, "utf8");

function block(selectorStart) {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error(`Selector not found: ${selectorStart}`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]),
  );
}

const light = block(":root {");
const dark = { ...light, ...block(".dark {") };
const cbLight = { ...light, ...block('[data-diff-palette="cb"] {') };
const cbDark = { ...dark, ...block('.dark[data-diff-palette="cb"]') };

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// [label, foreground token, background token, target]
const PAIRS = [
  ["Body text", "foreground", "background", 4.5],
  ["Secondary text", "muted-foreground", "background", 4.5],
  ["Secondary on muted", "muted-foreground", "muted", 4.5],
  ["Primary button", "primary-foreground", "primary", 4.5],
  ["Link / accent text", "primary", "background", 4.5],
  ["Code on added line", "foreground", "diff-add-bg", 4.5],
  ["Code on added word", "foreground", "diff-add-word", 4.5],
  ["Code on removed line", "foreground", "diff-del-bg", 4.5],
  ["Code on removed word", "foreground", "diff-del-word", 4.5],
  ["+ marker", "diff-add-fg", "diff-add-gutter", 4.5],
  ["− marker", "diff-del-fg", "diff-del-gutter", 4.5],
  ["Line numbers", "diff-gutter-fg", "diff-gutter-bg", 4.5],
  ["Hunk header", "diff-hunk-fg", "diff-hunk-bg", 4.5],
  ["Keyword on removed word", "syntax-keyword", "diff-del-word", 4.5],
  ["String on removed word", "syntax-string", "diff-del-word", 4.5],
  ["Comment on added word", "syntax-comment", "diff-add-word", 4.5],
  ["Approved badge", "review-approved", "review-approved-bg", 4.5],
  ["Changes requested badge", "review-changes", "review-changes-bg", 4.5],
  ["Pending badge", "review-pending", "review-pending-bg", 4.5],
  ["CI running badge", "ci-running", "ci-running-bg", 4.5],
  ["Severity major", "severity-major", "severity-major-bg", 4.5],
  ["Input border (non-text)", "input", "background", 3],
  ["Focus ring (non-text)", "ring", "background", 3],
  // hunk: what the review components put where: status letters and counts on the page, cards
  // and the active tree row (surface-subtle), muted text on gaps between hunks.
  ["Added letter / + count on background", "diff-add-fg", "background", 4.5],
  ["Added letter / + count on card", "diff-add-fg", "card", 4.5],
  ["Added letter / + count on active row", "diff-add-fg", "surface-subtle", 4.5],
  ["Deleted letter / − count on background", "diff-del-fg", "background", 4.5],
  ["Deleted letter / − count on card", "diff-del-fg", "card", 4.5],
  ["Deleted letter / − count on active row", "diff-del-fg", "surface-subtle", 4.5],
  ["Modified letter on background", "diff-mod-fg", "background", 4.5],
  ["Modified letter on card", "diff-mod-fg", "card", 4.5],
  ["Modified letter on active row", "diff-mod-fg", "surface-subtle", 4.5],
  ["Renamed letter on background", "diff-hunk-fg", "background", 4.5],
  ["Renamed letter on card", "diff-hunk-fg", "card", 4.5],
  ["Renamed letter on active row", "diff-hunk-fg", "surface-subtle", 4.5],
  ["Contract count on active row", "risk-contract", "surface-subtle", 4.5],
  ["Contract count on background", "risk-contract", "background", 4.5],
  ["Gap text", "muted-foreground", "surface-subtle", 4.5],
  ["Muted text on directory hover", "muted-foreground", "accent", 4.5],
  ["Active row bar (non-text)", "primary", "surface-subtle", 3],
  // hunk: the focused diff line's 3px bar, over the gutter of each kind of line.
  ["Focused line bar on diff-gutter-bg (non-text)", "ring", "diff-gutter-bg", 3],
  ["Focused line bar on diff-add-gutter (non-text)", "ring", "diff-add-gutter", 3],
  ["Focused line bar on diff-del-gutter (non-text)", "ring", "diff-del-gutter", 3],
  // hunk: a selected tab or toggle is told by its border on the muted track.
  ["Selected segment border (non-text)", "muted-foreground", "muted", 3],
  ["Pressed toggle border (non-text)", "muted-foreground", "background", 3],
  // hunk: risk classes. A bar on its own tint is under 3:1 for logic in light, so bars sit on
  // background or card only.
  ["Contract label on its tint", "risk-contract", "risk-contract-bg", 4.5],
  ["Contract label on card", "risk-contract", "card", 4.5],
  ["Contract bar on background (non-text)", "risk-contract-solid", "background", 3],
  ["Contract bar on card (non-text)", "risk-contract-solid", "card", 3],
  ["Logic label on its tint", "risk-logic", "risk-logic-bg", 4.5],
  ["Logic label on card", "risk-logic", "card", 4.5],
  ["Logic bar on background (non-text)", "risk-logic-solid", "background", 3],
  ["Logic bar on card (non-text)", "risk-logic-solid", "card", 3],
  ["Mechanical label on its tint", "risk-mechanical", "risk-mechanical-bg", 4.5],
  ["Mechanical label on card", "risk-mechanical", "card", 4.5],
  ["Mechanical bar on background (non-text)", "risk-mechanical-solid", "background", 3],
  ["Mechanical bar on card (non-text)", "risk-mechanical-solid", "card", 3],
];

let failed = 0;
for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
  ["cb-light", cbLight],
  ["cb-dark", cbDark],
]) {
  for (const [label, fg, bg, target] of PAIRS) {
    if (!theme[fg] || !theme[bg]) throw new Error(`Missing token ${fg} or ${bg} in ${name}`);
    const r = ratio(theme[fg], theme[bg]);
    if (r < target) {
      failed++;
      console.error(
        `FAIL ${name.padEnd(8)} ${label}: ${r.toFixed(2)}:1 < ${target}:1 (--${fg} on --${bg})`,
      );
    }
  }
}
if (failed) process.exit(1);
console.log(
  `All ${PAIRS.length * 4} contrast checks pass (light, dark, color-blind light, color-blind dark).`,
);
