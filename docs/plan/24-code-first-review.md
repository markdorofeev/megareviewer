# Stage 24: Code-first review page

**Status:** Done (pushed to main without a PR)
**Depends on:** 22, 23
**Unblocks:** —
**Owns:** `web/src/pages/review/`, `web/src/diff/`, `web/dev/fixtures/`, `src/domain/diff/call-graph.ts`, `src/application/use-cases/pipeline-version.ts`, the "Review page" part of ARCHITECTURE.md "UI"

## Goal

The review page opens on the code. Today the reviewer meets an intent panel, a tour sidebar and a decisions sidebar before the first hunk, and reads one tour step at a time. After this stage, the code fills the page from the first paint and navigation does the explaining. The reviewer picks one of two layouts with a toggle:

- **Map** (the default): every hunk in one scroll, in tour order, with a risk map beside it. A call in the code opens the hunk it calls inline.
- **Call tree:** the changed hunks as a tree from the entry points, one hunk at a time, with a call in the code linking to the hunk it calls.

Both have a jump palette (`⌘K`) and show decisions next to the hunks they rest on. The design is on the [Review page redesign](https://claude.ai/artifact/YQfPAHQvsmm59w47wNyceE) canvas, boards 1, 2, 3 and 5.

## Read first

- [DESIGN.md](../../DESIGN.md) principles 2–4, and "Decisions" on the model being optional
- [21-risk-weighted-ui.md](21-risk-weighted-ui.md), [22-navigation.md](22-navigation.md) and [23-hunk-comments.md](23-hunk-comments.md), including their notes: this stage keeps what they built and moves it
- `web/src/pages/review/ReviewPage.tsx`, `model.ts`, `MainArea.tsx`, `FileFinder.tsx`, `shortcuts.ts`
- `web/src/diff/HunkCard.tsx`, `DiffView.tsx`
- `src/domain/diff/call-graph.ts`

## Contract change

`CallGraphHint` gains `line`: the new-side line number of the reference in the calling hunk. The inline calls and the call tree's links sit on that line; today a hint only knows the two hunks and the symbol.

- `buildCallGraphHints` keeps one hint per calling hunk, called hunk and symbol, at the first reference's line.
- `PIPELINE_VERSION` goes from 2 to 3, so stored analyses without `line` are analyzed again instead of failing to parse.
- The fakes and the dev fixtures get lines.

A separate PR, with a line in stage 02's **Change log**.

## Tasks

1. **Intent in one line.** The header holds the intent where the intent panel was:
   - With the model: its one-sentence summary.
   - Without it: the PR title and the first line of the description.

   When the intent has mismatches, a red chip after it names the first one and its count ("Doesn't check the owner · 1 of 2"). Clicking the chip scrolls to the hunks the mismatch rests on. A "Details" button opens the current intent panel, or the stated intent without the model, in a dialog. The page no longer shows either panel above the code.

2. **Map layout.** The main area shows every tour step in one scroll:
   - Each step has a heading, then its hunk cards as today.
   - The trailing mechanical group comes last.
   - Before the tour exists, the hunks show in path order, as the `files` view does now.

   On the right, a rail replaces the tour and decisions sidebars:
   - The rail lists each step with one bar per hunk. A bar's height follows the hunk's line count, with a minimum and a cap. Its color follows the risk class, and it carries a mark for each decision that rests on the hunk, plus one for a contract rule's reason.
   - Reviewed hunks are dimmed and ticked.
   - The hunks in view are outlined, tracked with an `IntersectionObserver`.
   - Clicking a bar or a step scrolls there.
   - The stage 21 contract-only toggle moves to the rail.
   - The rail scrolls on its own when the PR is long.

   A page with hundreds of hunks has to stay responsive. Hunk cards far from the viewport skip layout and syntax highlighting until they come near it (`content-visibility`, plus lazy highlighting).

3. **Decisions next to the code.** The decisions sidebar goes away.
   - Each decision shows as a card under the header of the first hunk it rests on, in tour order. The card has today's approve, reject and comment controls.
   - The other hunks it rests on show one line linking back to the card.
   - Selecting a decision scrolls to its card, which replaces today's decision focus view.
   - Nothing about verdicts or storage changes.

4. **Calls open inline (map layout).** A line that holds a hint's reference gets a chip under it: the symbol, the called hunk's file and its risk class.
   - Clicking the chip opens the called hunk's card right there, indented, with one rule per level of nesting. The opened card can open its own calls too.
   - A hunk that's already open higher up the same chain shows "open above" instead of opening again.
   - A mechanical hunk opens collapsed, with its proof.
   - Opened chains are kept in component state, not storage.
   - The hunk also stays at its own place in the scroll. Marking it reviewed in either place marks both, since the reviewed mark is per hunk ID.
   - The "called by" links stay in the hunk header. The "calls" links move into the code as these chips.

5. **Call tree layout.** A pure `callTree` function, in `web/src/pages/review/call-tree.ts`, builds the tree from the hints:
   - The nodes are the hunks that aren't mechanical.
   - The roots are the hunks no other hunk calls, steps with contract hunks first and then tour order. In a cycle with no root, the first hunk in tour order becomes the root.
   - It walks depth first. Each hunk appears once. A later mention is a reference row that jumps to it.
   - Hunks no hint links go under "Not on a call path", grouped by file.
   - Every hunk to review is in the tree exactly once. Hints are heuristics, so a link can be wrong or missing, but a hunk can never be left out.

   The page shows the tree on the left: each node's symbol, or `file:line` for a root, a risk dot, and a tick once reviewed. The main area shows the selected hunk's card with:
   - a breadcrumb from its root;
   - "Called from" links;
   - its calls as links in the code, which select the called hunk;
   - "Next hunk in the tree" at the bottom.

   The proved-mechanical changes are listed under the tree.

6. **Layout toggle.**
   - A "Map | Call tree" switch sits in the header, with `v` as its shortcut.
   - The choice is kept in local storage under `review-layout`, for every PR.
   - Switching keeps the hunk in view selected: the tree selects it, and the map scrolls to it.
   - Reviewed marks, comments, verdicts and the contract-only toggle are shared by both layouts.

7. **Jump palette.** `⌘K`, `Ctrl+K` and `t` open one search that replaces the file finder. It groups:
   - decisions;
   - mismatches;
   - contract hunks, by their reason;
   - symbols, from the hints;
   - steps;
   - files.

   Typed words filter every group, as `findFiles` does for paths. `!` limits the search to decisions, mismatches and contract hunks, `@` to symbols and `/` to files. Arrows move, Enter opens. Opening an item scrolls to it in the map, or selects it in the tree.

8. **Shortcuts.**
   - The map keeps `j`/`k`, `n`/`p` (now scrolling to the next or previous step heading), `x`, `]`/`[`, `a`/`r`/`c` and `Esc`.
   - In the map, `o` opens or closes the first call chip of the focused hunk.
   - In the tree, `j`/`k` follow the tree's order, `→` goes to the first hunk this one calls, and `←` goes to the caller it was reached from.
   - The shortcuts dialog lists each layout's keys, and none fire while typing.

9. **Docs.** In the same PR, rewrite ARCHITECTURE.md "UI", "Review page", for both layouts, with the reason and the alternatives:
   - The page opens on the code because an intro in front of it was what reviewers skipped.
   - The question-per-concern path on the canvas was rejected because it put the intent and a question before every piece of code.
   - The step-at-a-time sidebar was replaced because it split the reader's attention across three panels.

## Not in this stage

- **Unchanged functions on a call path.** Example: `renderReceipt` between `cachedReceipt` and `loadTaxLines`. They aren't in the analysis, so the tree and the inline chips skip straight from one changed hunk to the next. Showing them needs head-file symbols in the view.
- **Symbol names for roots**, which need the parser's definitions in the analysis.
- **Decisions anchored on lines** rather than hunks, which needs a model output change.

## Tests

- `callTree`:
  - a chain;
  - a diamond, where the shared hunk appears once and as a reference;
  - a cycle with no root;
  - unlinked hunks;
  - a property test that every hunk to review appears exactly once.
- `buildCallGraphHints` puts each hint on the first reference's line.
- Rail bars: the height cap and minimum, decision and contract marks, the in-view outline, and that clicking a bar scrolls to it.
- An inline call opens and closes, nests twice, shows "open above" for a cycle, and a reviewed mark set in the nested card shows at the hunk's own place.
- A decision card sits on its first hunk in tour order. The other hunks link to it, and a verdict given there is saved.
- The palette:
  - filters each group;
  - each prefix limits it to its groups;
  - Enter on a decision scrolls to its card in the map and selects its hunk in the tree.
- Switching layouts keeps the selected hunk, and the choice survives a reload.
- The page without the model: the intent line shows the PR title, the rail shows rule marks only, and there are no decision cards.

## Definition of done

- [x] Contract change PR, with the stage 02 change log line.
- [x] Tasks above, with unit and component tests.
- [x] Playwright, against the fake host:
  - open a PR without the model;
  - in the map, open a call inline and mark it reviewed;
  - switch to the call tree and see the mark;
  - jump to a contract hunk with `⌘K`;
  - publish.
- [x] Checked in the browser on the dev fixtures and on a PR with at least 200 hunks, in both layouts.
- [x] ARCHITECTURE.md "Review page" rewritten.

## Open issues

- **Progress measure.** The header keeps "N of M hunks reviewed" as the one count, and decision verdicts are counted in the publish dialog. If reviewers stop at the hunk count with decisions still pending, show both.

## Notes for later stages

- **No PRs.** Like stages 20 to 23, this went to main as commits: the contract change (`CallGraphHint.line`, pipeline version 3) is its own commit, with its line in stage 02's change log.
- **Map cards redraw only when their signature changes.** `signatureOf` in `ReviewPage.tsx` lists what a hunk's place in the map shows: its reviewed mark, highlight, comments, the decisions on it and the calls opened from it. Anything new a card shows has to go into the signature, and its handlers have to call the latest state, as `stable.follow` does, or the card goes stale. Without it, a key took 300 to 500 ms on a 240-hunk PR in development; with it, about 60.
- **A decision's card sits on its first non-mechanical hunk** in the map's order, because mechanical hunks show collapsed. A decision that rests only on mechanical hunks, or on none the page knows, shows as a card before the first step.
- **Rail bars** are one pixel per line of the hunk, between 4 and 40.
- **Gone with the sidebars:** visited steps, the intent panel's collapsed state and the "cut the description after the first visit" behavior. The intent panel and the stated intent now only show in the Details dialog, where there's nothing to collapse.
- **The palette** shows results as buttons, not a listbox: arrows and Enter work in the search field, and Tab reaches the results.
- **The model's input is unchanged.** Hints reach the model without their line, so the prompts and the evals didn't change.
- **Outside this stage's paths:** `web/dev/mock-routes.ts` serves a 240-hunk analysis without the model (`web/dev/fixtures/large.ts`) for PR number 900 (`MOCK_LARGE_PR_NUMBER`), for checking a long PR in the browser. `e2e/fake-server.ts` takes an `ai` option: `test.use({ ai: false })` runs fake mode with `--no-ai`. Without Playwright's own browser installed, `PLAYWRIGHT_CHANNEL=chrome pnpm e2e` uses the installed Chrome.
