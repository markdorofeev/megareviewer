# Stage 43: Triage and findings from Claude, landed in the code

**Status:** In progress (on main): built, `pnpm check` and `pnpm e2e` pass; the live reading of the findings on delphi-code #2 and the real recording are left (see **Open issues**)
**Depends on:** 42
**Owns:** the findings pass in `src/adapters/claude/`, `src/domain/review/point.ts`, the model run in `src/application/use-cases/`, point routes in `contracts/`, the header's Claude element, point cards and tree marks in `web/src/pages/review/` and `web/src/review/`, the replayed model in `src/cli/dev/`, `web/dev/`

## Goal

Stage 42 put the model behind a button. What comes back is still the first slice's four passes, built when the model was always on, and the page shows little of it: a sentence in the header, a higher contract count, decision cards, and tour titles nobody sees.

A reviewer who presses the button has one question: what should I worry about here? This stage makes the answer one ranked list of **points**, each tied to its code:

- a **finding**: something looks wrong;
- a **risk**: behavior that deserves a hard look, with the model's reason;
- a **decision**: a choice the code makes, to agree with or not.

The model's job is triage and findings. Decisions stay in the list to see how they feel on real reviews.

It also redesigns the wait and the moment the answer arrives, and adds a replayed model so all of it can be worked on and tested without spending the plan.

## Decisions

- **One list, two actions.** Every point has Raise and Dismiss. Raise opens a comment on the point's lines, prefilled with its text for the reviewer to edit, and it posts with the review under their name. Dismiss folds the card to one line. Silence means fine. Approve and reject on each decision was the version before: seven clicks to say "fine", and one skipped silently turned an approval into a comment.
- **The reviewer picks the verdict at publish:** comment (the default), approve or request changes. It no longer follows from counts of clicks. Choosing was removed from the dialog once, when there was nothing to base it on without decisions; now a raised finding is the base.
- **Intent mismatches are findings.** "Asked for, not done" and "done, not asked for" join the list as findings, and the header's mismatch chip goes.
- **Only the model's risk is a point.** A hunk a path rule marks contract stays a count in its file's header. A hunk the model raises is a point, because it comes with a reason about behavior.
- **A findings pass, beside risk and decisions.** High effort, in parallel with them after intent, reading the same cached PR data. Each finding is a title of at most 80 characters, an explanation of at most 300, and the hunk and lines it rests on. The server validates that the hunk exists and the lines are in it; a finding that fails after the retry is dropped and logged, as decisions are.
- **The tour pass is left alone.** Its titles label the overview. Whether it earns its cost is a question for after this stage.
- **Order is kind, then the model's own.** Findings, then risks, then decisions. No severity yet: the model's sense of it is unmeasured.

## The wait

In the header, where the button was:

- **A hairline on the header's bottom edge,** an accent bar that runs while the model does. It replaces the strip of six stages for the model run; the strip stays for the code's own stages.
- **A line of words beside it:** "Claude is reading this PR" and the time since the click.
- **The intent rewrites itself.** When the intent pass finishes, the description's sentence fades out and Claude's fades in. It's the first result, seconds in.
- **The code doesn't change** until everything that will land has arrived.

## The moment it's ready

In this order, about a second in all:

1. **The receipt.** The hairline stops, and chips appear one by one with their counts rolling up from zero: "⚠ 2 findings", "▲ 1 risk", "◇ 2 decisions". "All 5" opens the full list in the header, a row per point that goes to its card; Next steps through them.
2. **Marks drop into the tree,** row by row from the top: each file's counts by kind. The file holding the current point is highlighted.
3. **Lines light up, then cards unfold.** A point's lines take its kind's tint and an edge bar, and its card grows out from under them. Only cards in view animate; the others are in place when the reviewer gets there. The line at the top of the window is held where it is while cards above it open.

With `prefers-reduced-motion`, every step is an instant change. Durations and easing come from the motion tokens. A kind is never told by color alone: each has its glyph and its word.

When a pass fails, what finished still lands. The receipt says what's missing and why, with Try again; for the plan's limit, when it resets.

When the tab is hidden, the document title says the analysis is ready.

## Mocks: the real scenario without spend

- **Record one real run.** `evals/record-model-run.ts` runs the passes on delphi-code #2 through the real transport, once, and writes each pass's answer, duration and usage to `src/cli/dev/fixtures/model-run-delphi-code-2.json`. Recording again is by hand, when prompts change.
- **`ReplayAnalysisModel`** in `src/cli/dev/`, an `AnalysisModel` that answers from a recording with its real timing, times a speed factor. Never bundled.
- **Scenarios,** each a recording plus a script:

  | Scenario | What it plays |
  |---|---|
  | `ready` | The recorded run as it happened |
  | `slow` | The same, three times slower |
  | `nothing-found` | Every list empty |
  | `many` | 40 points, to test the list, Next and the tree |
  | `limit-after-findings` | Findings arrive, then the plan's limit with a reset time |
  | `refusal` | The findings pass declines |
  | `invalid-then-ok` | A pass answers badly once, then well |
  | `not-signed-in` | Claude Code isn't signed in |

- **Three places to play them:**
  - `pnpm dev:replay --scenario <name>`: the real server, host, checkout and store with the model replayed, for delphi-code #2 at the recorded head. Another PR's button says the recording doesn't cover it.
  - `pnpm dev:fake --scenario <name>`: fake mode's fixture PR, for end-to-end tests.
  - `pnpm dev:web:mock`, with `?scenario=<name>`: the mock API steps the analysis through the same states.
- **The design system page** shows the header element in each state and a point card of each kind, with a Play button for the landing.

## Contract change

In its own PR first, with a line in stage 02's change log:

- `Finding` and `Point` in the domain, and in ENGINEERING.md's language table: a point is a finding, a risk or a decision, with the hunk and lines it rests on.
- `Analysis.findings`, and a `findings` stage and model pass.
- Verdicts become point states: `open`, `raised` or `dismissed`. `decision_reviews` migrates to `point_reviews`; approved and rejected decisions from before map to open and raised.
- The publish request carries the verdict the reviewer picked.
- `PIPELINE_VERSION` 18; the prompt version and its fingerprint change with the new pass.

## Tasks

1. The contract PR above, with the fakes and the contract suite's new pass.
2. The findings pass: prompt, its variant in the one output schema, validation, the retry. Both transports get it from `pass-model.ts`.
3. The model run: findings beside risk and decisions; mismatches into findings; points assembled and ordered in the domain, as a pure function of the analysis.
4. The recorder, `ReplayAnalysisModel`, the scenarios and the three ways to play them. Before any page work, so the page is built against them.
5. The header's Claude element: button, hairline and words, receipt, the open list, Next.
6. The intent line's rewrite.
7. The point card, replacing the decision card: its kinds, Raise into the comment box, Dismiss.
8. The landing: its order, tints, unfolding, the held scroll position, reduced motion.
9. The tree's marks and the current point's file.
10. Publish: raised points as comments, the verdict choice.
11. Docs: DESIGN.md (principles 4 and 6, the decisions on verdicts), ARCHITECTURE.md (the pass table, the review page, publish), README.md.

## Not in this stage

- Stopping a run.
- A marker ribbon beside the scrollbar.
- Changing or removing the tour pass.
- Severity on findings.
- Evals that score findings. They need a golden set of PRs with known defects; see Open issues.

## Tests

- **Domain:** points from an analysis: order, mismatches as findings, path-rule contract left out, a finding whose lines aren't in its hunk.
- **Contract:** every `AnalysisModel` passes the suite with the findings pass; the replayed model does too.
- **Use case:** each scenario, to the analysis it leaves: partial results kept, the error and what's missing.
- **Page:** the header element's states; a card of each kind; Raise prefills the comment; Dismiss folds; Next and the list reach every point; the tree's marks.
- **End to end,** on `dev:fake` scenarios: `ready` lands every point in place; `limit-after-findings` lands findings and says the rest is missing; the scroll position holds when cards open above it; reduced motion.
- **Design system:** the new states in all four theme and palette combinations, with their contrast pairs in `pnpm check:contrast`.

## Definition of done

- [ ] `pnpm check` and `pnpm e2e` pass.
- [ ] Every scenario plays in all three places.
- [ ] On delphi-code #2 with the real model: the points, read by a person, with how many were worth the look written under **Measurements**.
- [ ] The time from the click to ready there, under **Measurements**.
- [ ] DESIGN.md, ARCHITECTURE.md and README.md updated as in task 11.

## Open issues

- **No real recording yet.** `evals/record-model-run.ts` records one through the reviewer's Claude Code; the committed recording is the fake model's, marked synthetic, so the scenarios and the page can be worked on without spend. A real one of delphi-code #2 also unlocks `pnpm dev:replay` and the measurements above.
- **How good the findings are is unknown.** No eval scores them, and a list of wrong findings is worse than none. The definition of done asks for one honest reading on a real PR; a golden set is the stage after.
- **The recording holds delphi-code #2's code** in the repository. It's the PR every stage measures on; check it's fine to commit before recording.
- **Accountability.** DESIGN.md's fourth goal leaned on a verdict per decision. With silence meaning fine, the record is the published review alone.

## Measurements

Not taken yet: both need a real run on delphi-code #2 (see **Open issues**).

## Notes for later stages

- **Next has no key.** The stage asked for one in the keymap; the button is the way through the points, and a key per button is noise to learn. The page's keys are the ones that were already there.
- **The mismatch chip went with the chip, not with the mismatch.** Mismatches are findings now, so the header has no chip; Details still goes to one, which scrolls to its point's card (`point-m1`, `point-m2`, …).
- **A point's lines take a bar, not a tint.** The design asked for the kind's tint on the lines; a tint under code would need a contrast pair for every syntax color on three more surfaces, for what the bar and the card beside it already say. The bar is the kind's color at the lines' edge, and the strongest kind wins where points overlap.
- **The landing is cards growing in and the intent fading over, with the scroll held.** The receipt's chips roll their counts up from zero; the tree's marks and the cards appear with the motion tokens, which `prefers-reduced-motion` sets to 0 ms, rather than row by row on a timeline. `useHeldScroll` holds the first card in view while cards open above it.
- **Publish is offered on any complete analysis.** The verdict is the reviewer's own, so an approval with nothing to say is a review in itself. The count on the button is the comments it will post.
- **`hunkHasLine` moved to `src/domain/diff/`.** Points and comments both ask it, and leaving it in `publication.ts` made a cycle with `analysis.ts`.
- **`dev:replay` isn't there yet.** `pnpm dev:fake --scenario <name>` plays every scenario through the real pipeline, and `pnpm dev:web:mock` with `?scenario=<name>` plays them in the browser against the mock API. Both read `src/cli/dev/fixtures/model-run-small-feature.synthetic.json`, recorded from the fake model with `node evals/record-model-run.ts --synthetic`. The real server's replay waits for a recording of delphi-code #2, which the same script makes without `--synthetic`.
