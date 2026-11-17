# Stage 58: The preferences page, and guidance on the review page

**Status:** Not started
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

- [ ] The page, in light, dark and the color-blind diff, at 1440, 1024 and 375 px, with component tests for each state above.
- [ ] The point card's menu and form, the guidance line, the folded left-out point and Show, the stepper and chip counts, with tests.
- [ ] The usage line and Run details.
- [ ] Examples on the design-system page, with its checks passing and screenshots updated only where they changed.
- [ ] `e2e/preferences.spec.ts`: add a preference, accept a suggestion, switch a guideline file, save a rule from a point, show a left-out point.
- [ ] `pnpm check` and `pnpm e2e` pass.

## Notes for later stages

