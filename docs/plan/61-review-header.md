# Stage 61: The review header after its final design

**Status:** Done (main)
**Depends on:** 15, 41, 47
**Owns:** `web/src/pages/review/ReviewHeader.tsx`, `IntentLine.tsx`'s status line, `ReviewBar.tsx`, `ClaudeElement.tsx`, the model menu's trigger in `ModelMenu.tsx`, `header-buttons.ts`, `RerunModel.tsx`, the bar's wiring in `ReviewPage.tsx`, the AI and Approve variants in `web/src/ui/button.tsx`, their tokens in `web/src/styles/globals.css` and pairs in `scripts/check-contrast.mjs`, the bar's examples in `web/src/design-system/`, the review page's header and bar paragraphs in ARCHITECTURE.md and the verdict decision in DESIGN.md

## Goal

Redraw the review page's header and bar as the `hunk-header` design has them: the header cleaned up, the AI review's status at the top of the brief, the AI review's controls in the bar, an Approve button beside Publish, and one meaning per color: indigo tint for AI, solid indigo to commit a review, green to approve, red for a finding, amber for a risk, grey for everything else.

Read first: ARCHITECTURE.md's Review page section, DESIGN.md's decisions on the model and the verdict, ENGINEERING.md's UI rules. The design is `IMPLEMENTATION.md`, `tokens.css`, `reference/` and `shots/` in the archive. Where this doc and the design differ, this doc wins: the design was drawn without some of the product's rules.

## What changes

| Element | Today | Now |
|---|---|---|
| Repository and number | A line of their own above the title, linked | `#N` after the title, muted, the link to the PR; the repository starts the byline |
| Threads | "9 threads · 8 unresolved" at the top right | Gone: the bar's thread chip and stepper say it |
| CI, reviewers, status unavailable | Top right, over the title | Right end of the title row |
| State badge | Open in its own color | Open neutral; the other states keep theirs |
| Byline | Author, branches, updated, files, lines | Repository, author in medium weight, branches, updated, lines; no file count (the tree says it), a zero count left out |
| Brief | Leads muted; "✓ Does what was asked" green | A status line first; leads semibold in the text's color; only the check green; at most 980 px wide |
| Status line | None | "✦ AI review · Sonnet 5.5 through Claude Code · latest commit", or "· new commits since"; while it runs, "AI review running · … · 2 of 4 passes" and a bar. None before a run |
| Details (ⓘ) | End of the brief's first line | Stays: it's the only way to the stated intent, sources and behavior changes |
| New commits | A warning with Re-analyze under the brief | The AI split's main action, "Re-analyze · new commits", tinted strong |
| Bar | 44 px, the stuck title up to 288 px | 52 px, the stuck title up to 384 px with a divider after it |
| Before a run | Request AI review, filled | "No AI review yet · Find bugs, risks and decisions across N files" and Request AI review tinted, with the arrow |
| While it runs | "Claude is reading this PR 0:42" | The stepper, then a small split "Reviewing · 2 of 4", not clickable, with a spinner; the hairline stays |
| After a run | Chips and the stepper; Remove AI review in the footer | Chips, the stepper, then a small "Re-run" split: it asks, removes the run and runs the chosen model again. Remove AI review stays in the footer |
| A run that didn't finish | Try again beside the reason | The split's main action is Try again |
| Approve | In the Publish dialog only | A button beside Publish that approves at once, with no dialog |
| Publish | Filled always | Filled only when it's the main action |

### Which button is filled

`barButtons()`, a pure function in `web/src/pages/review/header-buttons.ts`, decides it, with at most one filled button:

- Comments pending: Publish filled, with their count; Approve outline.
- None pending, after a finished AI run: Approve filled green and rightmost; Publish outline.
- Otherwise, before a run, while it runs or after one that failed: nothing filled; the AI tint is the strongest thing on the row.
- The reviewer's own PR: Approve disabled, focusable, with why in a tooltip, as the dialog's verdict is.
- New commits since the analysis: Approve outline, still approving at once. It was disabled with why first; whether a push needs another analysis is the reviewer's call.

AI controls are never filled: tint before a run, outline after, strong tint on new commits.

### Approve

Approve publishes a review with the approve verdict and nothing else: no summary, no line comments. Drafts that are pending stay pending for the next review, since nothing is posted that the reviewer hasn't seen in the Publish dialog. Its ID is kept until the host answers, as the dialog's is, so a retry after a lost answer doesn't approve twice. Once it's posted the page reads the threads and the PR's status again, and the bar says Published. A failure says why under the bar, with Dismiss.

The design blocked Approve while a finding was open. That's left out: on a point, saying nothing means fine (DESIGN.md), so an open finding is no reason not to approve.

### Not taken from the design

- The model menu's Scope group: a run can't cover only the changes since the last one.
- "Reviewing · step 3 of 5, reading RepositoryHost": the passes run at once and say nothing of what they read, so the progress is passes done of four.
- "Re-run · 2 new commits": new commits need a new analysis, so it's Re-analyze, without a count, which the status read would have to learn.
- Its dark values: they were measured on `#0B0B0F`; ours are mixed over `#1F1F1F`, the tint at 8% rather than 14% so its hover keeps 4.5:1.
- Its 12.5 px and 13 px sizes: the type scale's `caption` and `ui` stand in.
- "Publish review" without the ellipsis when comments are pending: the button always opens a dialog.

## Work

1. **Tokens.** `--ai-soft-bg`, `--ai-soft-bd`, `--ai-soft-bd-strong` in both themes; `ai-soft-hover`, `ai-soft-active`, `review-approved-hover` and `review-approved-active` as mixes in `@theme`; their pairs in the contrast check.
2. **Buttons.** `ai`, `ai-strong`, `ai-quiet` and `approve` variants on the Button primitive, marked `hunk:`.
3. **Header.** The title row, byline and status line; the stale warning goes.
4. **Bar.** 52 px, the stuck title, `barButtons()` with tests, Approve, Publish's emphasis.
5. **AI split.** The prompt, the three states, Re-run with its dialog, Re-analyze, the menu's trigger matching its button.
6. **Following a seeded run.** `useAnalysisView` keeps a seed of the same analysis on screen while it follows it, so Re-run lands without the skeleton.
7. **Docs and examples.** ARCHITECTURE.md's header and bar, DESIGN.md's verdict, the design system's bar states, tests and baselines.

## Done when

- `pnpm check` passes, and the e2e and design-system specs with updated baselines.
- On delphi-code #2, in light and dark: each state of the table above shows the buttons it lists, with at most one filled.
