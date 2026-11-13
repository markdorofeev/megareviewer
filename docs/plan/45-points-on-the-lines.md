# Stage 45: Claude's points on the lines, each kind its own weight

**Status:** In progress (branch claude/ai-comments-clarity-3dc02b): built, `pnpm check` and `pnpm e2e` pass; the prompts' real run is left (see **Open issues**)
**Depends on:** 44
**Owns:** the findings and decisions prompts in `src/adapters/claude/prompts/`, `Finding` and `Decision` in `src/domain/review/`, `pointsOf`, the point components in `web/src/pages/review/`, line slots in `web/src/review/diff/hunk-card.tsx` and `diff-line.tsx`, the decisions button in the bar

## Goal

Stages 43 and 44 landed Claude's points as cards of one shape, under the last of their lines, with a stepper through them in the bar. On the fixture PR, five cards sat on the receipt route: two findings, a risk and two decisions, all one shape. The reviewer couldn't tell what to stop on from what could be left alone, and three of the five said the same thing: the finding, the SHOP-142 mismatch and a decision all said any signed-in user can read any receipt.

This stage gives each kind its own job, weight and place, after a design the designer drew and the reviewer chose a variant of:

| Kind | Its job | Where | Weight |
|---|---|---|---|
| Finding | What's wrong, as a draft comment ready to add to the review | Under the line it rests on, as a thread is | Loudest: a card with the kind's bar, its severity and Draft chips, a suggested change, "Add to review" as the primary button |
| Risk | A contract change that deserves a look, and why | A band above the first line of its range, with a bar down the range | Medium: a tint, quiet buttons |
| Decision | Why the code does something. Never a request | A chip at the end of its line, opened into a footnote | Quietest: muted text, hidden with one switch |

The repetition is fixed where it's made, in the prompts: a finding names the intent mismatch it shows, and that mismatch isn't a point of its own; a decision explains a choice, so "looks the order up without checking its owner" is a finding, not a decision.

## Decisions

- **A finding is a draft comment.** The model writes a severity (minor, major, blocking) and, when the fix is a few lines, a suggested change for the lines it rests on. "Add to review" saves it as the reviewer's draft on those lines, with the severity and suggestion, and it posts with the review; Edit opens the draft in the comment box first. Raise, a prefilled box to fill in, was the version before: every finding took a box to open and a button to close it.
- **One finding per concern.** The findings pass reads the intent's mismatches by ID and names the one a finding shows. That mismatch isn't a point of its own: its sentence is a line in the finding. A mismatch no finding names is still a finding.
- **Decisions say why.** The decisions pass explains the choices the code makes that a reader would wonder about, each titled as the question it answers ("Why cache rendered receipts"), on the lines that make it. A decision the reviewer disagrees with is a comment; it's never phrased as one.
- **Placement says the kind.** Under a line is a comment, a band above a range is a section note, a chip at the end of a line is a footnote. The kind's icon and word go with every one, so none is told by color alone: a bug for a finding, a scan for a risk, a signpost for a decision.
- **Only the model's contract risk is a band.** As in stage 43, a hunk a path rule marks contract stays a count in its file's header, and logic code shows nothing. The designer's teal logic band and the ◆ ƒ ≡ glyphs are left out: ARCHITECTURE.md records why a bar on every part said little.
- **Saying nothing still means fine.** No Mark reviewed, no viewed counts and no new keys: the designer's `n`, `p` and ⇧R are already next file, previous file and Publish. Stage 44's stepper goes through every point, and opens a decision's footnote, showing the decisions again if they were hidden, when it reaches one.
- **Decisions show inline or not at all.** An eye beside the decisions chip in the bar, kept per browser; the chip itself narrows the stepper, as stage 44 made it. The designer's margin rail costs the width the code needs and has no room at 1024px or less.

## Contract change

- `Finding` gains `severity` (the domain's `Severity`, default `major`), `suggestion` (the new-side lines that replace the ones it rests on, or null) and `mismatch` (the ID of the intent mismatch it shows, `m1`…, or null). Defaults keep stored analyses parsing.
- `Decision` gains `lines` (the `PointLines` its chip goes on, or null), default null.
- `Point` gains `severity`, `suggestion` and `mismatch` (the mismatch's kind and sentence), null for kinds that have none.
- The prompt version goes up with both prompts and the output schema; the pipeline version doesn't, since the model isn't in it.

## Tasks

1. The contract change above, with the fake model, the contract suite and fixtures.
2. Prompts: the findings pass gets severity, suggestion and the mismatch it shows, and reads mismatches by ID; the decisions pass explains instead of asking. Validation: a suggestion only on new-side lines, a mismatch that exists, a decision's lines in one of its hunks; each is stripped, not the point, when still wrong after the retry.
3. `pointsOf`: a mismatch a finding names joins that finding; the rest as before.
4. Line slots on the hunk card: rows above and below a line, and something at its end.
5. The finding's card under its line, the risk's band above its range, the decision's chip and footnote; dismissed ones folded in place; Next and the list reach each.
6. The bar: icons on the chips and the stepper, the decisions eye.
7. The synthetic recording again, and the mock fixture's points as the new prompts would write them.
8. DESIGN.md and ARCHITECTURE.md.

## Not in this stage

- Confidence on findings, and hiding the ones the model is unsure of.
- The impact line on a risk from its unchanged callers: the divider under the part's header already says it.
- Mark reviewed, viewed files, the margin rail, the designer's keys and top bar (CI, avatars, Checkout).

## Tests

- **Domain:** `pointsOf` folds a named mismatch into its finding and keeps an unnamed one; severity and suggestion carry through; finding validation strips a suggestion on old-side lines and an unknown mismatch.
- **Use case:** a finding still wrong only in its suggestion keeps its place without it; a decision's lines outside its hunks are dropped to null.
- **Page:** a finding sits under its line and Add to review leaves a draft with its severity and suggestion; a risk's band sits above its range; a decision's chip opens its footnote, the eye hides them all, and the stepper opens one; Dismiss folds each in place.
- **End to end:** raise and dismiss persist across a reload; publish posts a finding added to the review.

## Definition of done

- [x] `pnpm check` and `pnpm e2e` pass.
- [x] The mock review shows the three kinds on the receipt route as the stage describes, checked in the browser in light and dark.
- [x] DESIGN.md and ARCHITECTURE.md updated.

## Open issues

- **The prompts are unmeasured.** The synthetic recording comes from the fake model; whether Haiku writes useful severities, suggestions and "why" decisions needs a real run on delphi-code #2, as stage 43's measurements do.
- **The eval labels expect the old decisions.** Resolved: the labels list findings apart from decisions, every labeled decision that described a defect or a request is a finding now, with the mismatch it shows, and the decisions left are "why" questions. Each labeled finding names the hunks and lines that show it; severity isn't labeled or scored, since it's leaving the product. The judge (version 2) matches and rates findings too, and the scores add `findingRecall`, `findingNoise`, `findingPlaced` (on the labeled lines), `decisionRecall` (was `mustHaveRecall`) and `mismatchNamed`. No paid run has measured them yet, and there's no baseline to compare with: the next run writes one.

## Notes for later stages

- **Built on stage 44's landing.** Findings go through its `pointsAt` and land as its cards did; a risk's band goes through `pointsOver`, folded the same way; a decision's chip through `pointsAtEnd`, and its footnote in a `LineRow` under the line. `cardPlaces` in `ReviewPage.tsx` decides which line of its part each point sits on, by kind, and the hunk card takes `flagged` for the bug in a number cell.
- **A point on its own lines isn't linked from the other parts of its hunk.** They're around it; stage 43 linked them, and on the fixture PR the retry part linked to the finding just above it.
- **Decisions take no hue.** `POINT_STATUS.decision` is muted grey, the tree's decision count too, and a decision's lines take no bar.
