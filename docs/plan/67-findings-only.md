# Stage 67: Findings only

**Status:** Done (branch claude/risk-findings-severity-type-b3302c, no PR)
**Depends on:** 45, 50, 56, 58, 59, 63, 64
**Owns:** the risk and decisions passes, to remove them: `risk` and `decisions` on `AnalysisModel` with their fakes and contract suite, their prompts, schemas, fixtures and tests on every transport in `src/adapters/model/`, their stages and validation in `src/application/use-cases/` and `src/domain/review/`, `decision.ts` and `checking-test.ts`; the kinds of a point in `src/domain/review/point.ts`; the guardrail call's and the guidance's handling of risks; the risk note, the decision chip and footnote, the Decisions switch, the kinds' chips, the tree's risk ring and Risks filter, and the tour's use of risks, in `web/src/`; their demos on the design-system page; the fake server's fixtures in `src/cli/dev/`; the risk and decision labels, metrics and judge ratings in `evals/`; `PIPELINE_VERSION`; the feature's text in DESIGN.md, ARCHITECTURE.md, ENGINEERING.md and `evals/README.md`

## Goal

An AI review returns three kinds of point, and two of them don't earn their place.

- **A risk is a classifier's output shown as a point.** The risk pass classifies every hunk, and every hunk it marks contract becomes a card that says nothing is wrong and still asks the reviewer to stop. Tightening the prompt took delphi-code #2 from 25 risks to 8; it's still read as noise, because a classifier can't triage.
- **A decision is a footnote nobody opens.** Decisions are off until the reviewer turns them on, and on delphi-code #2 six of eight repeated the description.

This stage removes both: the two passes, everything they return, and everything on the page that shows it. A model run is then the intent and the findings, with the tour's steps and the guardrail call as they are. Nothing is added: stage 68 gives findings a type and widens what they look for. Between the two stages, a change that breaks something outside the PR shows only in the brief's Watch line.

Read first: ARCHITECTURE.md's Model passes, Preferences and Guardrails sections, DESIGN.md's decisions on points, a risk's checking test and the tour, `evals/README.md`, and [45-points-on-the-lines.md](45-points-on-the-lines.md), [50-risk-note.md](50-risk-note.md), [63-check-instead-of-fix.md](63-check-instead-of-fix.md) and [64-tour.md](64-tour.md) for what's being taken out.

## Decisions

This stage writes these into DESIGN.md and ARCHITECTURE.md, each with its alternatives, in the documents' own voice. What they say today about risks and decisions moves among the alternatives, shortened: it's the version before.

- **A point is a finding.** What the model asks the reviewer to look at is what looks wrong, as a draft comment, or an intent mismatch no finding names. Risks and decisions were the other two kinds; the two paragraphs of Goal above are why they went.
- **Nothing moves into findings.** A finding still says something looks wrong and asks for a change. A choice that's intended but has a consequence isn't one, and making it one would end the findings pass's triage. What was worth keeping has a place already: what nobody asked for is an intent mismatch, and what changes for existing code, users or data is the brief's Watch line.
- **Contract is the rules' alone.** A hunk's risk class comes from a mechanical proof or a path rule, and is internal: it orders the flows. The model no longer classifies hunks, so a run changes no hunk's class.
- **The checking test goes with the risk.** It answered "should I stop here?" for a risk, and there's no risk to ask it of. It was the page's one piece of evidence that a test covers something; stage 68 may bring it back on a finding.
- **A Look for preference raises a finding or a line of the brief, never a card of its own.** "Any change to billing" used to make a hunk a risk. Now the Watch line says first that the change touches it, as the intent task already asks, and a finding carries the mark when something there looks wrong.
- **The thesis is rewritten.** DESIGN.md's thesis and its fourth principle rest on approving decisions. They become: understand the change from its brief and its tour, check what the machine found, and read the code where it matters.
- **Stored analyses still open.** An analysis stored with risks and decisions parses, and shows its findings and its brief; its risks and decisions aren't shown. Review signals recorded on a risk or a decision keep their kind, since suggestions still read them.
- **Not in this stage:** types on findings, findings about architecture or contracts, any change to the findings or intent prompts, and renaming `Point` to something else.

## Contract

Names here are the ones other code will use; where the code makes a better one obvious, take it and say so in the notes. Removal is the rule: when something exists only for risks or decisions, delete it, don't leave it unused.

### Domain

- **`ModelPass`** is `intent`, `findings` and `steps`. `StageName` loses `risk` and `decisions`; `currentStages` leaves them out of a stored analysis's stages, as it does `tour`. `MODEL_STAGES` is the intent and the findings.
- **`ModelCallName`** still parses `risk` and `decisions`, so a stored run's usage and calls read, and Run details still lists them for such a run.
- **`Analysis.decisions` goes.** A stored one is dropped on parse. `decision.ts` goes with it.
- **`Analysis.risk` stays,** holding proofs and rules. `RiskAssessment` loses `lines`, `checkedBy`, `guidance` and `guardrail`; its `source` still parses `model` and `fallback` for stored analyses, and nothing writes them. `checking-test.ts` goes. `beforeModel` keeps the warnings; its `risk` is read only to put back an analysis whose run was stored with a model's risk.
- **`Point`** loses `kind` and `checkedBy`; `PointId` still parses a risk's and a decision's ID, so a stored point review reads. `pointsOf` returns the findings, then the mismatches no finding names. `PointKind` stays where a review signal names it, and a new signal's is always `finding`.
- **`Guidance`:** a mark is a finding's alone.

### Ports

- **`AnalysisModel`** loses `risk` and `decisions`, with `ModelRisk`, `ModelCheckingTest` and `DecisionDraft`. The fakes, the replayed model and the contract suite follow.
- **`GuardrailAdvisor`:** `AdviceInput.points` are findings, so `kind` goes and every ref is `f1`….

### Use cases

- **A model run** (`run-pipeline.ts`, `model-passes.ts`): the intent starts first; the steps pass starts as soon as the intent's answer begins, as risk and decisions did; the findings start when the intent ends. `raiseByRules`, the risk pass's coverage check and fallbacks, the checking test's checks and the decisions' hunk check go.
- **The guardrail call** runs when the run has a finding, and reads findings only.
- **Remove AI review** puts back the warnings; the code's risk is no longer changed by a run.

### The model

- **The intent's, the findings' and the steps' tasks keep their words,** but for a mention of the risk or decisions task, which is reworded in as few words as it takes. The system prompt's sentence on where attention goes drops "the decisions it makes". Record the diff of the prompts in the notes.
- **The union** is the intent's and the findings' variants, with the steps' for a run that asks for the tour. Every transport's prompt fingerprint and version move; bump each as its test asks.
- **The guardrail call's prompt** says findings where it said findings and risks.
- Every lockdown stands as it is.

### The page

- **Gone:** the risk's note and its "Checked by" line; a decision's chip and footnote; the Decisions switch in the Display menu; the marks on a risk's lines; the tree's ring and its Risks filter; a risk's and a decision's chips on a tour step; the risks in the tour's ledger.
- **The bar:** one chip, "⚠ 2 findings", then the threads' chip. The stepper goes round the findings and the mismatches. A run counts three passes with the tour and two without, on the bar, in the status line and for a screen reader.
- **The tour's depth:** the steps with an open finding, and how many findings are outside the steps.
- **A point a preference left out** is a finding. "Don't flag things like this" stays on a finding's Dismiss.
- **Tokens:** a risk token nothing uses any more goes, with its pairs in `pnpm check:contrast`. The landing's wash for a risk goes.
- **The design-system page** loses the demos of what's gone. Its snapshots are compared on macOS only.

### Storage and API

- No migration: `decision_reviews` is already unused and stays, as dropping a table needs one.
- `contracts/api.ts` loses whatever names a risk or a decision; the analysis view changes with the domain.

## Order of work

One agent, in this order, each step its own commits with `pnpm check` passing:

1. **Status and this doc,** in a first commit.
2. **The page stops showing them:** the cards, chips, switch, marks, tree and tour, with their tests and the design-system demos. The analysis still carries risks and decisions.
3. **The passes go:** the domain, the ports with their fakes and contract suite, the use cases, every transport, the guardrail call's input, the fake server's fixtures, `PIPELINE_VERSION` 21. The evals' code changes here too, since `pnpm check` typechecks it.
4. **The evals run,** then the documents and this doc's notes.

Steps 2 and 3 may be one commit if `pnpm check` can't pass between them.

## Evals

- **Labels:** `risk`, `riskAt`, `checkedBy` and `decisions` go from `CaseLabels` and every case, and a guidance label's `risks`. A case that exists only for a risk or a decision goes; say which in the notes. The contract labels are in git at this stage's first commit, for stage 68 to draw on.
- **Metrics:** `contractRecall`, `riskAccuracy`, `riskNoise`, `riskPlaced`, `coverageWrong`, `coverageRecall`, `decisionRecall`, `decisionNoise`, `firstTryValid` and `fallbacksUsed` go. `injectionResistance` is the injection reported with the must-have findings as if it weren't there. The guidance metrics count findings.
- **The judge** no longer rates decisions: bump `JUDGE_VERSION`.
- **One run** of the cases on Sonnet 5.5 through Claude Code, written as the new baseline, with a report in `evals/reports/<date>/`. The findings' and the intent's prompts are what they were, so `findingRecall`, `findingNoise`, `findingPlaced` and the mismatch metrics should be about the old baseline's; say in the report where they aren't.
- **The guardrail call's cases** lose their risk; run them once.
- They spend the reviewer's Claude plan: if Claude Code isn't signed in or the run is refused, leave it as an open issue here rather than work around it.

## Definition of done

- [x] A model run makes the intent and the findings passes, the steps pass when asked, and the guardrail call when it has a finding. Its stages, progress count and Run details say so.
- [x] `AnalysisModel` has no `risk` or `decisions` on any transport, and each transport's tests and fingerprint are updated.
- [x] An analysis stored at pipeline version 20 with risks, a checking test, decisions and their stages parses and shows its findings; a test holds it with a stored fixture. A stored point review and a stored review signal on a risk or a decision read.
- [x] The page shows no risk and no decision, in the map, the bar, the tree, the tour or the Display menu, and no unused token is left.
- [x] The fake server's fixtures and the end-to-end tests are updated. The small-feature fixture gains no file.
- [x] The evals ran, with their report and a new baseline, or the open issue says why not.
- [x] DESIGN.md, ARCHITECTURE.md, ENGINEERING.md and `evals/README.md` say what the product does now, with risks and decisions among the alternatives.
- [x] `pnpm check` and `pnpm e2e` pass.

### Ubiquitous language (ENGINEERING.md)

Decision and Checking test leave the table. These rows change:

| Term | Meaning |
|---|---|
| Risk class | *mechanical*, *logic* or *contract*, from a mechanical proof or a path rule. Internal: it orders the flows and is never shown |
| Point | What the model asks the reviewer to look at: a finding, or an intent mismatch no finding names, with the hunk and lines it rests on |
| Guardrail | As it is, a mark on a finding |

Intent, Analysis, Step, Review signal, Preference, Guidance and Model call lose their mention of a risk or a decision where they have one.

## Notes for later stages

### What changed in the prompts

The findings task is byte for byte what it was; the rule on technical terms it shared with the risk and decisions tasks is now written in it. The intent task is unchanged. The rest:

| Where | Was | Is |
|---|---|---|
| System prompt | "The reviewer's attention should go to what the change does, the decisions it makes, and the places where a mistake would be expensive" | "… to what the change does and the places where a mistake would be expensive" |
| Steps, last bullet | "Nothing that looks wrong and no risk: those are other tasks'." | "Nothing that looks wrong: that's another task's." |
| Guardrail call, opening | "found points: findings (what looks wrong) and risks (where a mistake would break something outside the pull request)" | "found points: findings (what looks wrong)" |
| Guardrail call, data | `<point>` "with its ref ("f1" for a finding, "r1" for a risk), its kind and its file (path), then its title (a finding's only), what it says" | "with its ref ("f1") and its file (path), then its title, what it says" |
| Risk and decisions tasks | | gone |

The suggestion call's prompt is untouched: it still names risks and decisions, since signals recorded on one are still read. `risk` and `decisions` left the tags a PR's text is escaped for, with the block that held a risk's answer. Prompt versions: API 18, Claude Code 15, Codex 11, opencode 12.

### Where this doc was wrong about the code

- **`decision_reviews` doesn't exist.** A migration had already dropped it and made `point_reviews`; ARCHITECTURE.md's Storage table still listed it, and lists `point_reviews` now.
- **The `+checkout` key went with version 21.** `startFor` looked up an analysis stored under `20+checkout` before its own key. Version 21 has no such analysis, so the lookup and its tests are gone (`keysOf`, `findStored`).
- **No eval case exists only for a risk or a decision.** The cases with no labeled finding stay: a finding there is noise, which is what stage 68 measures against. `test-named-coverage` was made for the checking test and has findings of its own. Their `tests` descriptions say what they test now. Of the guardrail call's cases, `risk-credential-order` goes and `delphi-real-run` keeps its finding.

### Names and choices

- `PointKind` is in `point-kind.ts` and only review signals use it. A signal's `pointKind` is always `finding` when written.
- `AdvicePoint.text` is `explanation`, as a finding's is, and the point has no `kind`.
- `currentModelError` drops a stored error of a removed pass when the intent and the findings both finished, and otherwise keeps it under the first of them that didn't, so Try again still shows.
- `RiskAssessment` is `hunkId`, `riskClass`, `reason` and `source`. `web`'s `ShownRisk` is logic and mechanical: contract is never drawn, and its tokens are gone.
- Two filters are left in the tree, All and Findings, and one chip for points in the bar.
- `validateRiskCoverage`, `raiseByRules`, `pointLinesFit`, `checking-test.ts`, `decision.ts` and the fake server's `receipts-tested.ts` (its PR #105) are gone, and `hunks.ts` in `src/cli/dev/` has the two helpers the last one shared. The fake scenario `limit-after-findings` is `limit-after-intent`, since the intent is the pass before it now.
- `FakeAnalysisModel` derives a finding per file instead of one for the PR. The derived decisions were what gave a larger fixture several points to go round.
- `src/domain/review/fixtures/analysis-v20.json` is the stored analysis the parsing tests read, with point reviews and signals on a risk and a decision. Nothing else should read it.
- The API's output format wasn't tried again with the smaller union: ARCHITECTURE.md says why each pass asks for its answer in its prompt, and none of it rests on the risk and decisions variants.

### The evals

One run of the 18 cases, p15, judge 6, is the new baseline, with [its report](../../evals/reports/2026-11-25/findings-only.md): findingRecall 14 of 17, findingNoise 1 of 25, findingPlaced 17 of 17, mismatchRecall 10 of 10, mismatchFalsePositives 4. The findings and the intent are about the old baseline's. The guardrail call's nine cases ran once: guardrailRight 4 of 5, guardrailWrong none; java-layering's rule was answered in a sentence over the 160 characters the server takes.

For stage 68: the three missed must-haves are delphi-account-connections', where the run produced no finding; the one noisy finding is test-named-coverage's CSV escaping; and dependency-bump-signature and large-retry-after, labeled with no finding, produced two each that the judge rates valid.

### What's left

- The design-system page's tour demo dismisses the second step's finding and still suggests reading that step, since its tour is built with every point open. It was so before this stage.
