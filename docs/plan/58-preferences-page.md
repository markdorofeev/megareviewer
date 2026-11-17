# Stage 58: The preferences page, and guidance on the review page

**Status:** Done (branch worktree-agent-ac4271c8efd9bbe22, no PR). `pnpm check` passes: 3293 tests; `pnpm e2e` passes: 74 tests, 11 of them `e2e/preferences.spec.ts`, and the design-system project with its four new baselines. Seen in Chromium on `pnpm dev:fake` in light and dark at 1440, 1024 and 375 px
**Depends on:** 55
**Owns:** `web/src/pages/preferences/`, the route and the header's link in `web/src/app/`, the client's preference calls in `web/src/api/`, the guidance on a point in `web/src/pages/review/` (`PointCard.tsx`, the usage line and Run details, the stepper's counts), their examples in `web/src/design-system/`, a variant PR in `src/cli/dev/`, `e2e/preferences.spec.ts`

## Goal

The reviewer's side of the slice: a page to write, accept and switch preferences, and on the review page the two places guidance shows, a point that says which preference shaped it and a rule saved from a point.

Read first: [55-preferences-core.md](55-preferences-core.md), ARCHITECTURE.md's UI and Design system, ENGINEERING.md's UI rules, [45-points-on-the-lines.md](45-points-on-the-lines.md), [54-main-page.md](54-main-page.md) for a page built on the design system. Build against `pnpm dev:fake`, whose server stage 55 gives preferences, a fake suggester and a fake history.

## The preferences page

`/preferences`, from a Preferences link in the header beside Connections, on every page. A page, not a popover: it holds lists the reviewer edits, and the model's choice was kept off a settings page only because it was one field.

```
Preferences
What you want an AI review to look for and to leave out. Used by Request AI review.

┌ Suggested  2 ──────────────────────────────────────────────────────────────┐
│ Don't flag   Missing JSDoc on internal helpers             this repository │
│ Based on: Dismissed "Missing JSDoc on parseConfig", acme/api #12 · …       │
│                                                   [Reject] [Edit] [Accept] │
└────────────────────────────────────────────────────────────────────────────┘
[✦ Suggest from my reviews]  14 actions recorded since the last suggestions

Everywhere                                                  [Add preference]
  Look for    Tenant isolation: every query filters by tenant ID   written  ◉
  Don't flag  Naming                                               learned  ◉

acme/api
  Look for    Migrations that lock a table                         imported ◉
  Guideline files, read at the base commit of the pull request
    REVIEW.md   1.2 KB   ◉      CLAUDE.md   48 KB   too large to send
  [Import from my past reviews]
```

- **Suggested** shows only with pending proposals. Accept adds it as it reads; Edit opens it in the form first; Reject removes it, and megareviewer won't propose it again.
- **A preference row:** its kind as a word chip with a glyph (never color alone), its text, its source, a switch, Edit and Delete behind a menu. Delete asks first.
- **Add preference:** the kind, the text (300 characters, counted), the scope. The same form edits one.
- **Suggest from my reviews** runs on the model option chosen for Request AI review (the same per-browser choice, the default without one), and its tooltip says which and who pays, as that button's does. While it runs it says so and how long; it can't run twice at once. With no signals recorded it's disabled but focusable, and says what's recorded: the points dismissed and raised and the comments posted. A failure shows the reason beside it with Try again.
- **A repository's section:** its preferences, its guideline files with size and switch, one too large named as such with no switch, and Import from my past reviews, which says what it read ("92 comments from 30 pull requests") and that its proposals are above. A repository with no guideline files read says why.
- Empty: a short line of what a preference is, with two examples, and the form.
- Loading is a skeleton; a failed read is a banner with Try again.

## On the review page

- **Dismiss on a finding and a risk** gains a menu beside it with "Don't flag things like this…". It opens a small form in place: the kind fixed to Don't flag, the text prefilled with the point's title for the reviewer to turn into a rule, the scope, this repository by default. Save adds the preference (source `learned`) and dismisses the point; Cancel does neither.
- **A point from guidance** has a line on its card, as a risk's "Checked by" line is: a glyph and "From your preference: Tenant isolation…", or "From REVIEW.md", the text a link to `/preferences`.
- **A point left out** is folded to one line where its card would be, in the shape a dismissed point folds to: "Left out by your preference: Naming", with Show. Shown, it's the point's card with the same line on it, and behaves as any point. It isn't a step of the stepper and isn't in the chips' counts until it's shown or raised; its lines carry no mark while it's folded.
- **The usage line** names what the run used, "with 6 preferences and REVIEW.md", and Run details lists them, with how many points were left out. A run without guidance says nothing new.
- No keys for any of it.

## A PR to demo it on

A variant PR in `src/cli/dev/`, listed in `fakeFixtures` (small-feature's own files and answers stay as they are): its fake model answers one finding raised from a preference, one left out, and a risk from a guideline file, on an analysis whose guidance has those entries.

## Definition of done

- [x] The page, in light, dark and the color-blind diff, at 1440, 1024 and 375 px, with component tests for each state above.
- [x] The point card's menu and form, the guidance line, the folded left-out point and Show, the stepper and chip counts, with tests.
- [x] The usage line and Run details.
- [x] Examples on the design-system page, with its checks passing and screenshots updated only where they changed.
- [x] `e2e/preferences.spec.ts`: add a preference, accept a suggestion, switch a guideline file, save a rule from a point, show a left-out point.
- [x] `pnpm check` and `pnpm e2e` pass.

## Notes for later stages

Everything above is built as written except where **Deviations** says otherwise. The product docs weren't touched: the decisions below are for DESIGN.md and ARCHITECTURE.md's UI section, each with what was rejected.

### Where things are

- **The page:** `web/src/pages/preferences/`. `PreferencesPage.tsx` reads the view once (`usePreferences` in `web/src/api/hooks.ts`) and then changes it in place from each answer of the API, with the pure functions of `view.ts`; nothing is read twice. `PreferenceForm.tsx` is the one form: add, edit, accept a proposal with changes, and the rule saved from a point. `ModelAction.tsx` is the button for the two model calls, Suggest and Import. `rule.tsx` has the kinds' chip and the scopes the form offers.
- **The route:** `/preferences`, `PREFERENCES_PATH` in `web/src/app/router.ts`; `PreferencesLink` in `Header.tsx`.
- **On the review page:** `PointCard.tsx` has the guidance line, the folded left-out line, the Dismiss menu and the rule's form; `ReviewPage.tsx` decides which points are folded (`folded`) and which the stepper walks (`walked`); `UsageFooter.tsx` has `guidanceRead` and `runLine`; `ModelCalls.tsx` lists what the run read.
- **The variant PR:** `src/cli/dev/receipts-guided.ts`, `https://github.com/acme/storefront/pull/7` on the fake server.
- **The mock:** `web/dev/mock-routes.ts` keeps preferences in memory, starting from `web/dev/fixtures/preferences.ts` or from the view a test gives `createMockApi({ preferences })`. PR 904 there is the fixture PR after a run that read guidance (`web/dev/fixtures/guidance.ts`).

### Decisions

- **A scope's card adds to that scope.** Every card, everywhere's and each repository's, has Add preference, which opens the form in the card with its scope chosen; the form still offers every scope. One button on everywhere's card, as the sketch has it, was the alternative: a preference for a repository then starts with a trip to the scope's menu, from the top of the page.
- **Enter saves, and the rule is one line.** A preference is one sentence, so the text takes no line break: Enter submits the form, as in any single-line field, and a pasted break becomes a space. It's a textarea only so 300 characters wrap. ⌘↵ as in the comment box was the alternative, a shortcut to learn on a form that has one field.
- **The form says what's wrong on saving, never by a disabled button.** An empty rule and one over 300 characters are refused with the reason under the text, as the link field does; the counter turns to "312/300, 12 too many". A disabled Save was the alternative, which doesn't say why.
- **A proposal too long to be a preference opens in the form.** Accept on one over 300 characters opens it with the count, without asking the server, which would answer the `bad-request` stage 55 describes.
- **Suggest is disabled when nothing was recorded since the last suggestions.** The view carries one number, `signalsSinceSuggestion`, so the page can't tell "nothing ever recorded" from "nothing since": both read "Nothing new to suggest from: megareviewer records the points you dismiss and raise and the comments you post", beside the button and as its description. Running it again on the same signals would propose nothing the reviewer hasn't decided on. It says what's recorded in words, not a count of each kind, for the same reason.
- **What a run of Suggest or Import came to is said beside its button** and stays until the next run: "2 suggestions from 14 actions, above.", "Read 92 comments from 30 pull requests: nothing new to suggest.", "Found no comment of yours on its last 30 pull requests." A failure is there too, in the server's words, with Try again. A toast was the alternative: gone before the reviewer has looked up at the card it points to.
- **A decided proposal hands the focus on.** Accept and Reject leave the page with their proposal, so the focus goes to the Suggested card, or to the page's heading when the card goes with its last proposal. Closing the form gives the focus back to the button that opened it.
- **Shown is the page's, not stored.** A left-out point the reviewer shows stays shown while the page is open, through Dismiss and Undo; a reload folds it again unless it was raised or dismissed, which the server has. Keeping it per browser was the alternative: a new run reuses `f1`, and a stored "shown" would open a point the reviewer never saw.
- **Going to a left-out point shows it.** A link to it from another hunk, or from a mismatch in Details, shows it first: a link that scrolls to a folded line would look broken.
- **The tree's marks count what the chips count.** A folded point isn't in its file's counts either; the stage named only the chips and the stepper.
- **When every point was left out, the bar says so:** "Claude found nothing to raise, and left out 2 by your preferences". Without it the bar said nothing was found while folded lines sat in the code, out of sight until scrolled to.
- **The rule's form is on the card, in place of its actions.** It says in one line what saving does. Saved, the dismissed line reads "Dismissed, and saved to your preferences", the word a link; that's the card's own memory, so after a reload it reads "Dismissed". The rule's scope is the pull request's repository first, then everywhere.
- **A guidance line links to the page, not to its preference.** The run's record keeps the preference's text as it was; the preference may have been edited or deleted since, so there may be nothing to point at.
- **The usage line says it after the model:** "Sonnet 5.5 through Claude Code with 2 preferences and REVIEW.md · Usage: …". Three or more read "2 preferences, REVIEW.md, and AGENTS.md". Run details has a section under the calls, "Read beside the code", with each preference as the run had it, each guideline file with its size, and "1 point was left out by them, folded where its card would be."
- **On a phone the header's link is an icon.** "megareviewer", Connections, Preferences and Display don't fit 375 px, so under 640 px the link is its sliders icon with the word for screen readers, and the header's gaps and Display's padding are tighter.
- **The fake server starts with the guided PR's two preferences,** saved in `fake-main.ts`, so `pnpm dev:fake` shows guidance on the first run with no setup; they're for `acme/storefront` only, so no other fixture's run reads them. `createFakeApp` itself still starts empty, as its test says. Seeding in a test was the alternative, and would leave `pnpm dev:fake` with nothing to show.
- **The guided PR is in a repository of its own.** small-feature's repository has no guideline files, and a `REVIEW.md` at its base commit would be read by every PR of `acme/shop`. Its fake model finds its marks by the preference's text and the file's path in `input.guidance`, not by a fixed `p1`, so they hold when the reviewer adds a preference before the run, and a point is left unmarked when its preference is switched off.

### Deviations from this doc

- "With no signals recorded it's disabled" is "with none recorded since the last suggestions", as above.
- Add preference is on every card, not on everywhere's alone.
- Empty is "no preference at all": everywhere's card then holds the line and the form, without a button to open it or Cancel. Repositories analyzed before still have their cards under it.
- No toast, and no keys.

### Not done, or only partly

- **The page isn't read again when the tab comes back.** The count of recorded actions is as of the page's load; a point dismissed in another tab shows after a reload.
- **Import offers Try again after any failure,** one a retry can't fix among them, such as a host megareviewer can't read past reviews from. Stage 57's hosts answer with their own message, which shows as "The git host returned an error: …".
- **The rule's form on a point card is checked for accessibility as a component and on the design-system page's form examples,** not on a live review page: the review page has no accessibility pass in `e2e/`.
- **The design-system page's focus walk is longer.** The Preferences section adds its tab stops to the walk of `e2e/design-system.spec.ts`, which took 1.8 minutes of its 3 with every project running at once on a loaded machine, and 52 seconds alone. If it times out, raise the timeout before cutting examples.
- **At 375 px a point's card is as wide as the code column,** which scrolls sideways, as before this stage; the rule's form inherits that.

### Edits outside this stage's paths

- `src/cli/dev/fake-app.ts`: `receiptsGuided` in `fakeFixtures`, and the model wrapped with `withGuidance`.
- `src/cli/dev/fake-main.ts`: saves the guided PR's preferences before serving.
- `src/cli/dev/receipts-tested.ts`: `hunkWith` and `lineOf` exported, for the guided PR's answers.
- `e2e/fake-server.ts`: `PR.receiptsGuided`. `e2e/playwright.config.ts`: `preferences.spec.ts` in the chromium project. `e2e/design-system.spec.ts`: the Preferences section among the screenshots, with four new baselines; the others didn't change.
- `web/src/pages/review/usePoints.ts`: the states are one memoized map, so the folded points can be derived from them. `ClaudeElement.tsx`: `leftOut`.
- `web/src/pages/preferences/ModelAction.tsx` takes `initial`, for the design system's examples, as `UrlForm` does.

