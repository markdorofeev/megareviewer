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
  // hunk: the main page: its text on the page, the field's and squares' borders, the busiest
  // day's dot, and the Connections button's tones.
  ["Text on the main page", "foreground", "surface-subtle", 4.5],
  ["Secondary text on the main page", "muted-foreground", "surface-subtle", 4.5],
  ["Input border on card (non-text)", "input", "card", 3],
  ["Primary border on card (non-text)", "primary", "card", 3],
  ["Busiest day's dot (non-text)", "primary-foreground", "primary", 3],
  ["Connections with an issue", "review-pending", "review-pending-bg", 4.5],
  ["Connections failing", "destructive", "review-changes-bg", 4.5],
  ["Connected check", "ci-success", "background", 3],
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
  // hunk: every syntax color on every line and word tint, since a changed word can be any token.
  ...[
    "syntax-keyword",
    "syntax-string",
    "syntax-function",
    "syntax-comment",
    "syntax-number",
  ].flatMap((token) =>
    ["diff-add-bg", "diff-add-word", "diff-del-bg", "diff-del-word"].map((surface) => [
      `${token} on ${surface}`,
      token,
      surface,
      4.5,
    ]),
  ),
  ["Approved badge", "review-approved", "review-approved-bg", 4.5],
  ["Changes requested badge", "review-changes", "review-changes-bg", 4.5],
  ["Pending badge", "review-pending", "review-pending-bg", 4.5],
  ["CI running badge", "ci-running", "ci-running-bg", 4.5],
  ["Open PR badge", "pr-open", "pr-open-bg", 4.5],
  ["Merged PR badge", "pr-merged", "pr-merged-bg", 4.5],
  // hunk: the CI summary and reviewers' marks in the header, on the page's background.
  ["CI passed on background", "ci-success", "background", 4.5],
  ["CI failed on background", "ci-failure", "background", 4.5],
  ["CI running on background", "ci-running", "background", 4.5],
  ["CI skipped on background", "ci-skipped", "background", 4.5],
  ["Approved mark (non-text)", "review-approved", "background", 3],
  ["Changes mark (non-text)", "review-changes", "background", 3],
  ["Commented mark (non-text)", "review-commented", "background", 3],
  ["Severity major", "severity-major", "severity-major-bg", 4.5],
  ["Input border (non-text)", "input", "background", 3],
  ["Focus ring (non-text)", "ring", "background", 3],
  // hunk: what the review components put where: counts and headings on the page, cards
  // and the active or hovered tree row (surface-row), muted text on gaps between hunks.
  ["+ count on background", "diff-add-fg", "background", 4.5],
  ["+ count on card", "diff-add-fg", "card", 4.5],
  ["+ count on active row", "diff-add-fg", "surface-row", 4.5],
  ["− count on background", "diff-del-fg", "background", 4.5],
  ["− count on card", "diff-del-fg", "card", 4.5],
  ["− count on active row", "diff-del-fg", "surface-row", 4.5],
  ["Section heading on background", "diff-hunk-fg", "background", 4.5],
  ["Section heading on card", "diff-hunk-fg", "card", 4.5],
  ["Section heading on active row", "diff-hunk-fg", "surface-row", 4.5],
  ["Contract count on active row", "risk-contract", "surface-row", 4.5],
  ["Contract count on background", "risk-contract", "background", 4.5],
  ["Gap text", "muted-foreground", "surface-subtle", 4.5],
  ["Error on a fold", "destructive", "surface-subtle", 4.5],
  ["Muted text on directory hover", "muted-foreground", "accent", 4.5],
  ["Active row bar (non-text)", "primary", "surface-row", 3],
  ["Text on active row", "foreground", "surface-row", 4.5],
  ["Muted file name on hovered row", "muted-foreground", "surface-row", 4.5],
  // hunk: the tree's file icons, on the rail and on the active or hovered row.
  ...["syntax-function", "syntax-number", "syntax-string", "syntax-keyword"].flatMap((token) => [
    [`File icon ${token} on background (non-text)`, token, "background", 3],
    [`File icon ${token} on active row (non-text)`, token, "surface-row", 3],
  ]),
  ["Directory name on hover", "foreground", "accent", 4.5],
  // hunk: the focused diff line's 3px bar, over the gutter of each kind of line.
  ["Focused line bar on diff-gutter-bg (non-text)", "ring", "diff-gutter-bg", 3],
  ["Focused line bar on diff-add-gutter (non-text)", "ring", "diff-add-gutter", 3],
  ["Focused line bar on diff-del-gutter (non-text)", "ring", "diff-del-gutter", 3],
  // hunk: a file's status chip: new, deleted or renamed, on its own tint.
  ["New file chip", "diff-add-fg", "diff-add-bg", 4.5],
  ["Deleted file chip", "diff-del-fg", "diff-del-bg", 4.5],
  // hunk: a selected tab or toggle is told by its border on the muted track.
  ["Selected segment border (non-text)", "muted-foreground", "muted", 3],
  ["Pressed toggle border (non-text)", "muted-foreground", "background", 3],
  // hunk: risk classes. A bar on its own tint is under 3:1 for logic in light, so bars sit on
  // background or card only.
  ["Contract label on its tint", "risk-contract", "risk-contract-bg", 4.5],
  ["Contract label on card", "risk-contract", "card", 4.5],
  // hunk: a point's bar at the edge of the lines it rests on, by kind.
  ["Finding bar on card (non-text)", "review-changes", "card", 3],
  ["Decision bar on card (non-text)", "review-pending", "card", 3],
  // The stepper's kind glyph, beside the current point's title in the review bar.
  ["Finding glyph in the review bar (non-text)", "review-changes", "background", 3],
  ["Decision glyph in the review bar (non-text)", "review-pending", "background", 3],
  // A pressed point chip's border is its text's color, on the chip's own tint.
  ["Pressed finding chip border (non-text)", "review-changes", "review-changes-bg", 3],
  ["Pressed risk chip border (non-text)", "risk-contract", "risk-contract-bg", 3],
  ["Pressed decision chip border (non-text)", "review-pending", "review-pending-bg", 3],
  ["Contract bar on background (non-text)", "risk-contract-solid", "background", 3],
  ["Contract bar on card (non-text)", "risk-contract-solid", "card", 3],
  ["Logic label on its tint", "risk-logic", "risk-logic-bg", 4.5],
  ["Logic label on card", "risk-logic", "card", 4.5],
  ["Logic bar on background (non-text)", "risk-logic-solid", "background", 3],
  ["Logic bar on card (non-text)", "risk-logic-solid", "card", 3],
  ["Mechanical label on its tint", "risk-mechanical", "risk-mechanical-bg", 4.5],
  ["Mechanical label on card", "risk-mechanical", "card", 4.5],
  // hunk: review threads and drafts. Their 3px bar says the state, beside a word that says it too.
  ["Thread text", "foreground", "thread-bg", 4.5],
  ["Thread time and labels", "muted-foreground", "thread-bg", 4.5],
  ["Thread error", "destructive", "thread-bg", 4.5],
  ["Resolved label on thread", "review-approved", "thread-bg", 4.5],
  ["Suggested change title", "primary", "thread-bg", 4.5],
  ["Draft comment bar (non-text)", "review-pending", "thread-bg", 3],
  // hunk: Claude's points on the lines: a finding's card, a risk's note, a bug in the gutter.
  ["Finding label on its card", "review-changes", "thread-bg", 4.5],
  ["Risk label on its note", "risk-contract", "thread-bg", 4.5],
  // The rail of a point's mark on a line's number, on the mark's tint and on the row beside it.
  ...[
    ["Finding", "review-changes", "review-changes-bg"],
    ["Risk", "risk-contract-solid", "risk-contract-bg"],
  ].flatMap(([kind, rail, tint]) =>
    [tint, "diff-add-bg", "diff-del-bg", "background"].map((surface) => [
      `${kind} mark's rail on ${surface} (non-text)`,
      rail,
      surface,
      3,
    ]),
  ),
  ["Finding flag on added gutter (non-text)", "review-changes", "diff-add-gutter", 3],
  ["Finding flag on unchanged gutter (non-text)", "review-changes", "diff-gutter-bg", 3],
  ["Open thread bar (non-text)", "thread-marker", "thread-bg", 3],
  ["Resolved thread bar (non-text)", "review-approved", "thread-bg", 3],
  ["Outdated thread bar (non-text)", "muted-foreground", "thread-bg", 3],
  ["Severity minor chip", "severity-minor", "review-pending-bg", 4.5],
  ["Severity blocking chip", "severity-blocker", "review-changes-bg", 4.5],
  // The mechanical bar is decoration: mechanical changes are collapsed rows that say so in words,
  // and the grey is meant to recede. Its label and glyph carry the meaning.
];

// [label, fill token, surface token]: a fill that marks a row has to differ from what it sits on,
// or only its bar is left. In dark, the active row's fill once matched the page.
const FILLS = [
  ["Active tree row on background", "surface-row", "background"],
  ["Active tree row on card", "surface-row", "card"],
];

// Each activity level lies further from the card than the one before, so the shades read in order.
const LADDERS = [
  ["Review activity levels", ["card", "activity-1", "activity-2", "activity-3", "primary"]],
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
  for (const [label, steps] of LADDERS) {
    const distances = steps.map((token) => ratio(theme[token], theme[steps[0]]));
    if (distances.some((distance, index) => index > 0 && distance <= distances[index - 1])) {
      failed++;
      console.error(`FAIL ${name.padEnd(8)} ${label}: not in order of contrast with --${steps[0]}`);
    }
  }
  for (const [label, fill, surface] of FILLS) {
    if (!theme[fill] || !theme[surface])
      throw new Error(`Missing token ${fill} or ${surface} in ${name}`);
    if (theme[fill].toLowerCase() === theme[surface].toLowerCase()) {
      failed++;
      console.error(`FAIL ${name.padEnd(8)} ${label}: --${fill} is --${surface}'s color`);
    }
  }
}
if (failed) process.exit(1);
console.log(
  `All ${(PAIRS.length + FILLS.length + LADDERS.length) * 4} contrast checks pass (light, dark, color-blind light, color-blind dark).`,
);
