# Stage 44: A bar that stays, with a stepper through Claude's points

**Status:** Done (branch `claude/stage-45-8e010e`): `pnpm check` and `pnpm e2e` pass; the live check of Claude's points on delphi-code #2 waits for `dev:replay` (see **Notes for later stages**)
**Depends on:** 43
**Owns:** the header, the bar, the stepper, Claude's element and the Publish button in `web/src/pages/review/`; sticky offsets in `MapLayout.tsx` and `Rail.tsx`; their examples in `web/src/design-system/`; `e2e/review.spec.ts`

## Goal

Claude's points are stepped through with one button, Next, at the end of the intent line. The header scrolls away with the first screen of code, and Next goes with it: after one step the reviewer is on a point's card with no way to the following one but scrolling back up. Next also doesn't say where it is (which point, of how many), and there's no way back.

This stage starts from the PR header design (a full header at the top of the page, a compact one after scrolling) and puts the stepper in it:

- the header gains what the design shows and the analysis already has: author, branches, when it was updated, files and lines changed, threads;
- its last row is a **bar** that stays at the top of the window while the code scrolls, with Claude's chips, the stepper, the layout switch and Publish;
- the stepper goes both ways and names the point it's on: `‹ 2 of 5 ›`, the point's kind and its title.

No contract, domain or server change, and no `PIPELINE_VERSION` bump.

## Decisions

- **One bar, not two headers.** The design draws a full header and a separate compact one. Here the full header's last row is the compact one: it sticks, and when stuck it also shows the PR's title. Two headers was the alternative: the stepper's buttons would exist twice, and the one the reviewer pressed would scroll away under their focus on the first step, which is today's problem again.
- **Publish moves into the bar,** at its end, and the floating button goes, with the room the page left under its end for it. The design has Submit review in the title row and again in the compact header; one button in the row that stays is both. Its look doesn't change: the primary button with the count of what it posts and its key hint.
- **The bar costs a row of code, and that's accepted.** ARCHITECTURE.md rejected a header that stays on top for that reason, when all it would hold was Publish. It holds the stepper now, which has to be in reach from every point's card. Rewrite that paragraph: the floating button becomes the version before.
- **The stepper replaces Next and All N.** Previous and Next wrap around. The position, "2 of 5", is a button that opens the list of all points, which All N opened. The current point's kind glyph and title follow it, and a click on the title scrolls back to that point's card. Before the first step it reads "5 points" with no title; Next goes to the first and Previous to the last.
- **A chip narrows the stepper to its kind.** The chips are toggle buttons: with "2 findings" pressed, the stepper walks the findings only and reads "1 of 2". Pressing it again, or another chip, changes the set; if the current point isn't in the new set, the stepper moves to the set's first. A chip with a count of zero isn't shown, as today.
- **Every point is a step, dismissed ones too,** with the title struck through as in the list. Skipping them would make the position jump when a point is dismissed.
- **The current point is the one last gone to,** by the stepper, the list, a mention or Raise, as today. It doesn't follow the scroll.
- **No key for it.** Stepping by key was removed in 23b9321 for the button; this stage keeps that.
- **Left out of the design: Checkout and Unified/Split,** by decision, and the "2 / 4 viewed" bar and the contract, logic and mechanical chips, which the page dropped before (reviewed marks) or shows elsewhere (contract counts in file headers). The stepper's position and Claude's chips take their places. The Map and Overview switch keeps the corner Unified/Split had.

## Layout

```
acme / scheduler #482 ↗                                  7 threads · 2 unresolved
Add exponential backoff to job retries
mark wants to merge feat/retry-backoff → main · updated 40m ago · 4 files +22 −8
✓ Does what was asked: failed jobs retry with a doubling delay…  ⓘ
[stale banner, warnings]
────────────────────────────────────────────────────────────── the bar (sticky)
[title, when stuck]  ⚠ 2 findings  ▲ 1 risk  ◇ 2 decisions │ ‹ 2 of 5 › ⚠ Delay overflows after 31…   [Map|Overview]  [Publish review… 3]
```

**Header (scrolls away).**

- The repository and number, a link to the PR on the host, as today; at the row's other end the PR's threads, "7 threads · 2 unresolved", from the list `useThreads` already reads. Nothing is shown while threads haven't loaded or when there are none.
- The title, alone on its row.
- One muted line: author, source and target branch in mono, "updated 40m ago", the count of changed files and the lines added and removed. All from `analysis.pullRequest` and the page's `files`. Use the relative time the threads already format, not a new one. The line isn't shown while the pull request is still being collected.
- The intent line with Details, unchanged, but without Claude's element at its end.
- The stale banner and the warnings, unchanged.

**Bar (stays).**

- Claude's slot, in the three states `ClaudeElement` has today: Analyze with Claude; "Claude is reading this PR" and the time since; the chips and the stepper. What a run didn't finish, and Try again, stay in this slot. "Claude found nothing to raise" too.
- The accent hairline of a running model moves from the header's bottom edge to the bar's, since the bar is what stays in view.
- The layout switch, and Show files at 1024px or less.
- Publish, or "✓ Published" with its link once the review is published.
- When stuck, the PR's title first, truncated, `aria-hidden` (the `h1` above still names the page).

**Sticking.**

- The bar must be a sibling of `<header>` in the page's column, not inside it: a sticky element stays only within its parent's box. `ReviewHeader` renders the title block; a new `ReviewBar` renders the row.
- "Stuck" comes from an `IntersectionObserver` on a zero-height sentinel just above the bar, not from a scroll listener.
- The bar's height is one CSS variable on the page's root (`--review-bar-h`), and everything that sticks or scrolls under it reads that:
  - the file card header in `MapLayout.tsx` (`sticky top-0`) sticks below the bar;
  - `Rail.tsx` (`sticky top-0 h-screen`) starts below it and is shorter by it;
  - `scroll-mt-2` on file cards becomes the bar's height plus the same gap, and the `scroll-mt-24` on parts, point cards and hunk cards is checked against the bar plus a file's sticky header;
  - `scroll-padding-top` on the scroll root, so an element that takes the focus by Tab isn't hidden under the bar (WCAG 2.4.11).
- `bg-background`, opaque, with a bottom border, above the file headers (`z-20`) and below dialogs. No blur or shadow: on the page's own surface the chips keep the contrast pairs they already have.
- The bar never wraps, so it's always one row. As the width shrinks it gives up, in order: the stuck title (below `lg`), the chips' words, leaving glyph and count (below `lg`), the stepper's title (below `sm`). The buttons and the position stay.

## Accessibility

- Previous and Next are icon buttons of at least 24 px with `aria-label` "Previous point" and "Next point".
- The position button's name says what it opens: "Point 2 of 5, show all".
- The stepper's position, kind and title are one `aria-live="polite"` region, so a step announces "Finding 2 of 5: Delay overflows after 31 attempts". Kind is a word for screen readers and a glyph on screen, never color alone.
- A chip is a button with `aria-pressed`, and a pressed one is told by a 3:1 border as well as its fill, as the design system's toggles are.
- Going to a point moves the focus as today; the stepper's buttons keep their place in the DOM, so pressing Next again needs no Tab.

## Tasks

1. **Totals.** Pure functions in `model.ts`: files changed, lines added and removed, threads and unresolved threads. Unit tests.
2. **`PointStepper.tsx`.** Props: the points, the current point's ID, `stateOf`, the kind the chips narrowed to, and `onGo`, `onOpenList`. The stepping (set by kind, next and previous with wrap, position) is a pure function beside it with its own tests; `goToNextPoint` in `ReviewPage.tsx` goes.
3. **`ClaudeElement.tsx`.** Chips become toggles; All N and Next are replaced by the stepper. The run's states and Try again stay.
4. **`ReviewHeader.tsx`.** The threads count, the author line with the totals; the `tools` slot and the hairline leave it.
5. **`ReviewBar.tsx`.** The row: stuck title, Claude's slot, tools, Publish or Published. The sentinel and the `--review-bar-h` variable.
6. **`ReviewPage.tsx`.** Render the bar after the header; remove the floating button and `pb-20`; keep `data-slot="publish-button"`, the name "Publish review…", the count and the `openReview` key hint, so the publish tests and `e2e/review.spec.ts` change only where they place the button.
7. **Offsets** in `MapLayout.tsx`, `Rail.tsx` and the `scroll-mt-*` classes, as listed under Sticking.
8. **Design system page.** The stepper in its states (before the first step, mid-list, narrowed to a kind, on a dismissed point, one point), and the bar stuck and not. Update the snapshots with `--update-snapshots=all`.
9. **Docs.** ARCHITECTURE.md's Review page paragraph (Claude's element, where the header's controls are, the 1024px rule) and its Publish paragraph, with the floating button and the rejected thin bar recorded as the versions before and why this one replaced them. README.md if it mentions the floating button.

`PrHeader` in `web/src/review/pr/` isn't used by the page and isn't touched here.

## Not in this stage

- **Open and Changes requested badges, CI checks, reviewers.** Each needs a new read from both hosts and a contract change. Stage 46 adds them.
- **A current point that follows the scroll.**
- **Skipping or filtering by state** (only open points).
- **A key for stepping.**

## Tests

- **Unit:** the stepping function: wrap in both directions, a set narrowed by kind, the current point outside the new set, no points, one point; the totals.
- **Component (`ReviewPage.test.tsx`):**
  - Next and Previous go through the points in order and wrap, and the position and title follow;
  - before the first step the stepper reads the count and Next goes to the first point;
  - a pressed chip narrows the steps and the position; pressing it again restores them;
  - the position button opens the list, and a row there sets the stepper's point;
  - a dismissed point is still a step, struck through;
  - the bar shows Analyze with Claude, the running line and the missing-passes note in the states `ClaudeElement` had them;
  - Publish is in the bar, with its count, and is replaced by Published;
  - the header shows author, branches, totals and threads, and neither while their data is missing.
- **End to end (`e2e/review.spec.ts`):** with the `many` scenario, scroll to the last file: the bar is in view, Next scrolls a point's card into view below the bar and not under it, and Publish opens the dialog from there. At 1024px the bar is one row and the page doesn't scroll sideways.
- **Design system (`e2e/design-system.spec.ts`):** its checks pass on the new examples in all four theme and palette combinations.

## Definition of done

- [x] From any scroll position, one click goes to the next or the previous point, and the bar says which point of how many.
- [x] No floating Publish button; publishing works from the bar at the top of the page and after scrolling.
- [x] A file's sticky header sits under the bar, the tree rail isn't cut off by it, and a card scrolled to isn't hidden under either.
- [x] Tab never lands on an element hidden under the bar.
- [x] The page doesn't shift when the bar sticks or lets go.
- [ ] Checked live on delphi-code #2 with `pnpm dev:replay --scenario ready` and `--scenario many`, in light, dark and at 1024px. Partly: see **Notes for later stages**.
- [x] ARCHITECTURE.md says what the header and the bar are, and why the floating button went.
- [x] `pnpm check` and `pnpm e2e` pass.

## Notes for later stages

- **Checked live without `dev:replay`,** which stage 43 left unbuilt. delphi-code #2 was checked on the real server without Claude (the header's line and threads, the bar stuck and not, the rail and file headers under it, in light, dark and at 1024px), and Claude's states and the stepper with `pnpm dev:web:mock` and `?scenario=many`. The end-to-end test plays `--scenario many` in fake mode, at the recording's pace, about 20 seconds; the fixture gained a `scenario` option for it.
- **Stuck is observed on the bar itself,** not on a sentinel above it: an `IntersectionObserver` with the window's top edge moved down a pixel cuts the bar only while it sits at the top. A sentinel is a flex item of its own in the page's column, which adds the column's gap, and needs a negative margin to take it back wherever the bar is used.
- **`scroll-padding-top` is the bar's height, and the `scroll-mt-*` classes stayed.** `scrollIntoView` honors the scroll root's padding as well as an element's margin, so the margins that cleared a file's sticky header still do, now counted from under the bar; adding the bar to them as well would have put cards a bar lower. The variable is set on `:root` while the page is there (`:root:has([data-slot=review-page])`), since the scroll root is what reads it; the rail and the file headers fall back to 0 elsewhere, as in the design system.
- **The bar gives up its words below 1280px, not 1024px.** At 1024px with the stuck title and the chips' words, the stepper's title was cut to its first letter. The stuck title and the words go below `xl`; the stepper's title still goes below `sm`.
- **The stepper's live region is its own `sr-only` status,** "Finding 2 of 5: …", rather than the visible position and title, which are buttons whose names ("Point 2 of 5, show all") would read oddly as an announcement.
- **The header's count of files waits for the diff,** which prep reads; before it, the line read "0 files +0 −0".
- **The design system's bar section** replaces the header's Claude element: every state of the slot, the stepper's states, stuck and published, each stepping on its own. The snapshotted sections (foundations, screens) don't include it, so no baseline changed. `PrHeader`'s examples stay as the design's.
- **Publish has no key hint in the bar.** The doc kept it; the two key caps took room from the stepper's title. ⇧R still opens the dialog and is in the `?` dialog.
- **New contrast pairs:** the kind glyphs on the page's background and a pressed chip's border on its tint, all 3:1 non-text.
