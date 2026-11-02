# Stage 21: Risk-weighted review page

**Status:** Not started
**Depends on:** 18
**Unblocks:** 22
**Owns:** `web/src/diff/`, `web/src/pages/review/TourNav.tsx`, `web/src/pages/review/MainArea.tsx`, `web/dev/fixtures/`

## Goal

The reviewer's eye goes to risk first. Contract hunks stand out, logic hunks read normally, and mechanical hunks shrink to one dimmed line, while staying a click away. Built against the dev fixtures, so it doesn't wait for stage 20.

## Read first

- [DESIGN.md](../../DESIGN.md) principles 2 and 9
- [ENGINEERING.md](../../ENGINEERING.md) §6 "Fail safe toward the reviewer": collapsed, never hidden
- `web/src/diff/HunkCard.tsx`, `RiskBadge.tsx`, `MechanicalGroup.tsx`, `diff.css`; `web/src/pages/review/TourNav.tsx`, `MainArea.tsx`

## Tasks

1. **Contract hunks.** Tinted header and a red left bar (the bar exists). The reason is shown in the header, not only in the tooltip. Never collapsed.
2. **Logic hunks.** Unchanged.
3. **Mechanical hunks in a step.** A mechanical hunk in a file the step shows appears in place, in file order, as one dimmed row: path, line range and proof ("whitespace only, verified"). It expands to the full card on click or Enter, and isn't syntax-highlighted until it does.
4. **Mechanical-only files** (lockfiles, generated files, pure renames) stay in the last tour entry, as now, renamed "Generated and mechanical (N)".
5. **Sidebar.** Each step shows its contract hunk count when non-zero, and a thin bar with its share of contract, logic and mechanical changed lines. Above the steps, totals for the PR: "3 contract · 21 logic · 9 mechanical".
6. **Contract only.** A toggle above the steps shows only contract hunks in every step and dims steps without one. It's per page, kept in local storage like visited steps.
7. **Dev fixtures.** Add a fixture analysis with rule risk, a code tour, and mechanical hunks inside steps, so the page can be built and tested before stage 20.

Colors come from the existing `--risk-*` tokens. Contrast stays AA in both themes, including the dimmed rows.

## Tests

- Component: a contract hunk shows its reason in the header; a mechanical hunk in a step renders as a collapsed row and expands to its card; a mechanical hunk is never absent from the page.
- Sidebar counts and bar shares for a fixture.
- "Contract only" hides logic and mechanical hunks, and turning it off restores them.

## Definition of done

- [ ] Tasks above, with component tests.
- [ ] Screenshot of light and dark in the PR.

## Open issues

_None yet._

## Notes for later stages

_None yet._
