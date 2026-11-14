# Stage 50: A risk as a note under its lines, in amber

**Status:** Done (branch `claude/risk-ui-visual-design-6b8a36`): `pnpm check`, `pnpm check:contrast` and `pnpm e2e` pass, checked in the browser and on delphi-code #2; see **Notes for later stages**
**Depends on:** 45
**Owns:** the risk's component in `web/src/pages/review/PointCard.tsx`, point placement in `ReviewPage.tsx`, the point marks in `web/src/review/diff/diff-line.tsx` and `hunk-card.tsx`, the risk tokens and landing rules in `web/src/styles/globals.css`, their pairs in `scripts/check-contrast.mjs`, the design-system samples of them

## Goal

Stage 45 drew a risk as a magenta band over the first of its lines, edge to edge, with a 3 px bar at the card's left edge down the lines. On delphi-code #2 it didn't read as part of the page, and the bar was almost never seen:

- **The weight was inverted.** A risk says "read this closely"; a finding says "this looks wrong". The band was louder than a finding's card.
- **The emphasis was on the note.** With a risk the code is what's checked and the note is the lens. The note got a tinted band and the code a 3 px tick.
- **A third shape.** Findings, threads and drafts are bordered cards in the code's column; the band was flat, tinted and full width.
- **Magenta is outside any scale.** It was picked for being unused, so it reads as another category, not a level, and pink beside green rows clashes.
- **The bar was far from the code,** about 115 px left of it, where it merged with the card's border and the focus bar. On the usual range of 1 to 3 lines it was a tick that read as the band's own border.
- **The band cut code apart.** Over the first line of its range, it sat between `def save_token(...)` and its body, or inside a statement.
- **"Risk · contract"** showed a word DESIGN.md says the page never shows.

The reviewer chose, from four mock-ups, a risk as a note card under its lines with the lines marked on their numbers, in amber.

## Decisions

- **Finding, risk, decision are red, amber, grey.** The error, warning, info ladder says the level without being learned. Amber is shared with the Draft chip and the minor severity; each has its word.
- **A risk is a card of the finding's family, lighter.** Same shell (border, `bg-thread-bg`, the kind's 3 px bar inside, in the code's column, `max-w-3xl`); one sentence, Comment and Dismiss as ghost buttons, no title, chips or primary button. Its label is "Risk".
- **Under the last of its lines,** as a finding, a thread and a draft are. The marked numbers lead into it and the code above stays whole. It also lands as a finding does: a card above its lines pushes them down as it opens, which ARCHITECTURE.md already records against.
- **A point's lines are marked on their numbers.** The number cell beside the code takes the kind's tint, its number the kind's color in medium weight, and a 3 px rail in the kind's solid color on the cell's code side. One line is a 48 px tab, not a tick. Findings get the same mark in red. The bar at the row's left edge is left to the focus and the open comment box.
- **No new tint under code.** The tint is on the number cell only, so the contrast check gains pairs for one number color and one rail per kind, not for every syntax color.

Rejected, beside the band:

- **A caption line with a rail and no card:** a fourth shape, and quieter than something the reviewer is asked to check.
- **The lines themselves tinted, the note as their header:** it replaces the diff's green or red on those lines and needs a pair for every syntax color on the tint.
- **Violet instead of amber:** closer to the primary's indigo, which is the focus and selection color.

## Start from

The working tree on `claude/risk-ui-visual-design-6b8a36` has an uncommitted prototype in `PointCard.tsx`, `ReviewPage.tsx`, `diff-line.tsx` and `globals.css`; `git diff` shows it. It has the tokens, the card, the placement and the mark as plain background classes. It doesn't have the landing, the tests, the contrast pairs, the design-system samples or the docs, and it leaves `pointsOver`, `overLine` and `firstLineShown` dead. Without it, the tasks below are enough.

## Tasks

1. **Tokens,** in `globals.css`, with the comment above them rewritten for amber and why:

   | Token | Light | Dark |
   |---|---|---|
   | `--risk-contract` | `#8A5300` | `#F0B95A` |
   | `--risk-contract-bg` | `#FCEFC9` | `#45330F` |
   | `--risk-contract-border` | `#EBCF8B` | `#72561E` |
   | `--risk-contract-solid` | `#B26A00` | `#D99A2B` |

   The tree's risk count, the bar's chip and the stepper's glyph follow the token. A decision's landing wash is `--review-pending`, amber too: move it to `--muted-foreground`, since a decision takes no hue.

2. **The mark,** in `diff-line.tsx`. On a row with `pointKind` finding or risk, the number cell beside the code (the new side's, or the old side's in `split-old`) gets `data-point-mark={kind}` and the mark as its `::before`: `absolute inset-0`, behind the number (`isolate` on the cell, `-z-1` on the pseudo), the kind's `-bg` as fill and `inset -3px 0 0` of the kind's solid as the rail (`--review-changes` for a finding, `--risk-contract-solid` for a risk). The cell's text takes the kind's color and `font-medium`. A pseudo-element rather than the cell's own background so the landing can draw it. Remove `POINT_BAR` and the `after:` bar for points; `focused` and `marked` keep theirs. The number button's hover fill and the finding's bug still show over the mark. A decision's lines get nothing, as now.

3. **The note,** in `PointCard.tsx`. `RiskBand` becomes `RiskNote`, the prototype's shape: the shell above with `py-1.5 pr-2 pl-5`; a header row of the kind's icon and "Risk", the `RefChip`, "✓ Commented" when raised, then Comment and Dismiss at the right; the reason under it as the `h3`, regular weight. It takes `linesAbove` and the finding card's `scroll-mt`, so going to it keeps its lines in view. Dismissed, it folds like a dismissed finding (`max-w-3xl rounded-lg border bg-thread-bg px-3 py-1.5`). Share the shell's classes with `FindingCard` rather than spelling them twice. `aria-label`s and `data-slot`, `data-kind`, `data-state` stay as they are.

4. **Placement,** in `ReviewPage.tsx`. In `cardPlaces`, a risk goes to `underLine` at `last.key` with its `rowsAbove`, as a finding; `pointsAt` renders each point there by its kind, findings before risks when they end on one line. Remove `overLine`, `pointsOver` and `firstLineShown`, and the `pointsOver` prop from `hunk-card.tsx`, `HunkView.tsx` and `LandingDemo.tsx`. `flaggedOf` counts only findings, so a risk's line gets no bug.

5. **The landing,** in `globals.css`. What drew the bar down a point's lines draws the mark instead: the selector `[role="row"][data-point-line]::after` becomes the marked cell's `::before` inside such a row, with the same `landing-bar` keyframes, origin, duration and delay. The wash and the unfold are unchanged; a risk's note now unfolds from under its lines through the same fold as a finding. Under reduced motion everything is still instant.

6. **Contrast pairs,** in `scripts/check-contrast.mjs`. Remove "Risk band text" and "Risk band muted text". Add, as non-text at 3:1, each rail on what it touches: `risk-contract-solid` and `review-changes` on their own `-bg`, on `diff-add-bg`, `diff-del-bg` and `background`; and the risk's label on `thread-bg` at 4.5:1. The numbers on their tints are already there ("Contract label on its tint", "Changes requested badge"). Measured with the values above, in light, dark, color-blind light and color-blind dark:

   | Pair | Ratios |
   |---|---|
   | `risk-contract-solid` on `diff-add-bg` | 3.84, 5.10, 3.76, 5.81 |
   | `risk-contract-solid` on `diff-del-bg` | 3.76, 6.06, 3.82, 5.43 |
   | `risk-contract-solid` on `risk-contract-bg` | 3.70, 4.97, 3.70, 4.97 |
   | `review-changes` on `diff-add-bg` | 5.94, 4.50, 5.81, 5.13 |
   | `review-changes` on `diff-del-bg` | 5.82, 5.35, 5.90, 4.79 |
   | `risk-contract` on `thread-bg` | 6.33, 9.26, 6.33, 9.26 |

7. **Design-system page.** `DomainComponents.tsx` shows the note open and dismissed, and a few lines with each kind's mark; `LandingDemo.tsx` places the risk under its lines. Update the screenshots on macOS with `--update-snapshots=all`.

8. **Docs,** in the same PR, each with the band as the version before and why it went:
   - DESIGN.md, "Each kind of point its own weight and place": the risk's sentence, and the band and magenta among the versions before.
   - ARCHITECTURE.md: the paragraph "In the map, each point is on the part…" (the note, the mark on the numbers, the rejected caption and tinted range); the landing paragraphs (the mark draws, not a bar; "the reason for a bar rather than a tint" becomes the reason for a mark on the number); the design-system paragraph's "only contract has a hue, magenta".
   - README.md's sentence "as a band over their lines".

## Not in this stage

- **Ranges that start mid-statement.** The risk pass names the lines where something is decided, which can start inside a statement; the note under the last line hides most of it. Widening a range to whole statements needs the parser or the prompt.
- **"Checked" for a dismissed risk.** It touches "saying nothing means fine".
- **Risk tokens of their own for the color-blind palette** (see **Open issues**).
- **The kind's icon in a risk's number cell,** and any change to the finding's card.

## Tests

- **Line:** a row with a point's kind marks the number cell beside the code and no other; a focused or marked row keeps its edge bar; a decision's row has no mark; `split-old` marks the old number.
- **Page:** the test at "sit where their kind goes" expects the risk after the last of its lines and before the next line; a finding and a risk ending on one line share a fold, the finding first; Dismiss folds the note and Undo brings it back; Comment opens the box prefilled, as now; going to a risk from the stepper keeps its lines in view (`--lines-above` is its rows); a risk's line has no bug.
- **Landing:** the hook's tests still pass; the design-system spec's Play test still sees `landing` then `done`, and neither under reduced motion.
- **End to end:** `pnpm e2e`, with the design-system screenshots updated.

## Definition of done

- [x] `pnpm check`, `pnpm check:contrast` and `pnpm e2e` pass.
- [x] No `pointsOver`, `overLine`, `firstLineShown`, `RiskBand` or "Risk · contract" left in `web/` or `e2e/`.
- [x] The mock review and the design-system page checked in the browser in light, dark and both with the color-blind diff: the note, its dismissed fold, the marks of a finding and a risk on added, deleted and unchanged lines, and Play.
- [x] DESIGN.md, ARCHITECTURE.md and README.md updated.

## Open issues

- **Amber beside the color-blind palette's orange.** A risk's tint on a deleted line's number is the same lightness as the orange gutter beside it (1.06:1) and close in hue; the rail (3.82:1 on the row) and the number's weight carry the mark there. Checked in the browser on the design-system sample, in color-blind light and dark: the tint alone is hard to tell from the gutter, the rail at the code's edge isn't, so the risk tokens have no color-blind values. Worth a look again on a real PR with a risk on deleted lines; the mock PR has none.

## Notes for later stages

- **The decision's wash is gone, not moved.** No row has `data-point="decision"`: a decision marks no line, so the wash rule task 1 moved to `--muted-foreground` never matched, and it was removed.
- **In the unified layout a mark on a deleted line is on the new number's cell,** which is empty there: it's the cell beside the code, as task 2 says, so the tint and rail show without a number. `split-old` marks the old number.
- **`Kind` lost its `label` prop:** "Risk · contract" was its only use.
- **The finding and the risk share their shell, scroll margin, bar and fold** as `SHELL`, `SCROLL_UNDER_LINES`, `KindBar` and `FOLDED` in `PointCard.tsx`.
- **Findings come before risks in a fold** by sorting each line's points in `cardPlaces`, so the fold's first point, which the landing measures, is the finding.
- **The page's contrast check reads a `::before` that fills its element,** in `e2e/a11y.ts`, outside what this stage owns: it walked only elements' own backgrounds, so in dark it read a finding's number against the green gutter under its mark (3.22:1) rather than the mark's tint. The planted test in `design-system.spec.ts` proves a filled `::before` is read and a failing one still caught.
- **Contrast pairs:** "Risk label on its note" and eight "mark's rail" pairs replace the two band pairs; all 496 checks pass with the doc's values.
