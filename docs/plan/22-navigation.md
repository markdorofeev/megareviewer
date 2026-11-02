# Stage 22: Navigation and review progress

**Status:** Done (pushed to main without a PR)
**Depends on:** 19, 21
**Unblocks:** —
**Owns:** `web/src/pages/review/` except stage 21's files

## Goal

Moving through a review is fast and the reviewer always knows what's left: jump along the call graph, mark hunks reviewed, and see the stated intent without the model.

## Read first

- [DESIGN.md](../../DESIGN.md) principles 1 and 3
- `web/src/pages/review/ReviewPage.tsx`, `shortcuts.ts`, `storage.ts`, `IntentPanel.tsx`
- `src/domain/diff/hunk-id.ts`: IDs are hashes of a hunk's content

## Tasks

1. **Stated intent.** Without model intent, the intent panel shows the PR description (rendered as text, not HTML), the linked tickets and the commit list. Collapsed to its first lines after the first visit to the analysis.
2. **Call-graph links.** A hunk with hints shows "calls `x()` ↓" for each hunk it points to and "called by `y()` ↑" for each that points to it. A link scrolls to and focuses the hunk, switching steps if needed; `Esc` and the browser's back button return.
3. **Reviewed hunks.** Each hunk card has a "Reviewed" checkbox. A step is checked in the sidebar when all its hunks are; the header shows "9 of 31 hunks reviewed". Kept in local storage by hunk ID, not by analysis, so a hunk unchanged by a new push stays reviewed.
4. **Shortcuts.** `x` toggles reviewed on the focused hunk and moves to the next; `]` and `[` go to the next and previous unreviewed hunk across steps; `t` opens a file finder that jumps to a file's first hunk. Listed in the shortcuts dialog.
5. **Decisions panel.** Hidden when the decisions stage is skipped, instead of saying none were found.

## Tests

- Stated intent shows the description as text; a description holding HTML is shown literally.
- A call-graph link moves to the target hunk in another step and back.
- Reviewed state survives a new analysis of the same hunks and resets for a changed hunk.
- Each new shortcut, and that none fire while typing in a field.

## Definition of done

- [x] Tasks above, with component tests.
- [ ] Playwright: open a PR without the model, follow a call-graph link, mark every hunk reviewed. Checked by hand in the browser against `fake-main --no-ai`; the end-to-end test isn't written.

## Open issues

_None yet._

## Notes for later stages

- **Back is Esc only.** Following a link keeps a trail of where it came from, and Esc walks it back once no decision or mismatch is in focus. The browser's back button doesn't, because the page doesn't put views in the history.
- **Reviewed marks** are kept under one key, `reviewed-hunks`, the 5,000 most recent. Only hunks to review count; mechanical ones have no checkbox. A step's sidebar mark is ✓ when all its hunks are reviewed and • once visited.
- **Stated intent** shows whenever there's no model intent and the model isn't still working on it, so an analysis whose intent pass failed shows it too. The description is cut to three lines from the second visit, by `intent-seen:<id>`.
- **Placeholders** ("Working out the intent…", "Finding the decisions…") show only when the status says the model is on.
