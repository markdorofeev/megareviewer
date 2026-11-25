# Stage 68: A type on every finding

**Status:** Done (branch claude/risk-findings-severity-type-b3302c, no PR)
**Depends on:** 30, 66, 67
**Owns:** `FindingType` and a finding's `type` in `src/domain/review/`; the unchanged callers in the model's input, in `AnalysisInput`, `model-input.ts` and `src/adapters/model/shared/render-input.ts`; the findings task in `src/adapters/model/shared/prompts/`; the order of points in `pointsOf`; a finding's type and severity on its card, its lines' marks, the bar's chips and the stepper's list, in `web/src/`, with their tokens and contrast pairs; the fake server's fixtures in `src/cli/dev/`; the findings' labels, cases and metrics in `evals/`; `PIPELINE_VERSION`; the feature's text in DESIGN.md, ARCHITECTURE.md, ENGINEERING.md and `evals/README.md`

## Goal

After stage 67 an AI review's points are findings: what looks wrong in the code's behavior. Two things a reviewer is there for aren't looked for at all. DESIGN.md's review is for catching defects and for guarding the design, and its second principle sends human attention to contract changes.

This stage has the findings pass look for all three, and say which each finding is:

- **Logic:** the code does the wrong thing. What the pass finds today.
- **Contract:** the change breaks or exposes something outside the PR: a caller, stored data, a security boundary, a dependency or configuration.
- **Architecture:** the change is built in the wrong place or the wrong way for the codebase the PR shows.

The page ranks findings by severity and labels each with its type. A contract or an architecture finding is held to the bar a logic finding is: it says what's wrong, shown by code the model read, and asks for a change. Without that bar the risks stage 67 removed come back as minor contract findings.

Read first: [67-findings-only.md](67-findings-only.md) and its notes, [43-triage-and-findings.md](43-triage-and-findings.md), [30-unchanged-callers.md](30-unchanged-callers.md), ARCHITECTURE.md's Model passes section, `evals/README.md`.

## Decisions

This stage writes these into DESIGN.md and ARCHITECTURE.md, each with its alternatives, in the documents' own voice.

- **A type is a label, not a group.** A run has at most 10 findings and usually a few, so a heading per type would often sit over one finding. A finding's card says its type in a word, and the bar's chips count each type and narrow the stepper to it. Sections by type were the alternative.
- **Severity ranks.** The stepper and its list go blocking first, then major, then minor, the model's own order within each. The model's order alone was the version before.
- **Severity takes the colors.** A finding's marks and its chip are its severity's: blocking red, major orange, minor amber, each with its word. A finding red, a risk amber and a decision grey was the ladder before, by kind. A color per type was rejected: three more hues that mean nothing until learned, on a page where red, orange and amber already read as levels.
- **A contract finding names who breaks, and shows it.** It says which caller, stored data, user or service outside the PR breaks or is exposed, and how, from code in the data: an unchanged caller, a migration, a route's check. "This changes the response shape" is not a finding; "`listOrders` in `billing/export.ts` still reads `total`, which this removes" is. A change that only could break something stays out, and is the Watch line's if it's anything.
- **The model reads the unchanged callers.** They're where a contract break shows, megareviewer already has them when a checkout or a copy was read, and until now only the page showed them. A run started before they arrive reads the PR without them, as it does today.
- **An architecture finding rests on what the PR shows.** The model reads the PR and its callers, not the codebase, so "this belongs elsewhere" is a guess unless the data shows the elsewhere. It's limited to: a dependency that points the wrong way among the files in the data, a layer the PR's other code goes through and this code skips, and logic the PR duplicates from code in the data. Naming, style and "consider" stay out.
- **Wrong findings decide whether a type stays.** A wrong finding costs the reviewer more than a missed one, and the pass has none on the evals today. If architecture findings can't be kept at that after the prompt work this doc allows, the type ships as logic and contract alone, and the notes say why.
- **An intent mismatch no finding names has no type** and no severity, as now. It's in the stepper after the findings and under no type's chip.
- **The names are shared with the risk class on purpose.** A hunk's class and a finding's type both say logic and contract, and mean the same boundary: inside the PR or outside it. They're two types in the code, `RiskClass` and `FindingType`.
- **Not in this stage:** a checking test on a finding, findings that span files, a preference for which types to look for, and reading more of the repository than the unchanged callers.

## Contract

Names here are the ones other code will use; where the code makes a better one obvious, take it and say so in the notes.

### Domain

- **`FindingType`** is `logic`, `contract` or `architecture`.
- **`Finding.type: FindingType`,** default `logic`, so a stored finding and a transport's recorded answer parse. `Point.type` is a finding's, null for a mismatch no finding names.
- **`pointsOf`** returns the findings by severity, blocking first, in the model's order within one, then the mismatches. A finding's ID is still its place in the model's answer.

### The model's input

- **`AnalysisInput.unchangedCallers`:** for each changed definition that has them, its name, the part that changes it, and each use outside the PR: file, line, and the excerpt megareviewer keeps. Empty without a checkout.
- **Rendered** as an `<unchanged_callers>` block inside `<pull_request_data>`, after the call graph, escaped as PR content is, and described in the system prompt's data section in one bullet. With none, nothing is written and the text is byte for byte what it was after stage 67, which a test holds. It's in the size check.
- A use is code megareviewer read from the repository at the PR's head commit, so it's untrusted in the way the PR is.

### The findings task

Rewritten around the three types, keeping its rules on wording, lines, severity, suggestion, mismatch and guidance:

- What to look for, by type, with the bars in Decisions above, each with one example of what counts and one of what doesn't.
- `type` on every finding. A finding that's both is contract: outside the PR wins.
- Still only what the code in the data shows, still "prefer no finding over a speculative one", still at most 10.
- "Not style, not naming, not missing tests" stays, for every type.
- A removed or weakened check on a security boundary is a contract finding, blocking when it exposes data.

The intent's and the steps' tasks aren't touched.

### The page

- **A finding's card:** its type as a chip with a glyph and a word, before its severity. The severity chip is as it is.
- **Its lines' marks** on their numbers, and the rail beside them, in the severity's color. Each severity's pairs on every line tint go into `pnpm check:contrast`.
- **The bar:** a chip per type that has findings, glyph, count and word, "◆ 1 contract", in place of the one findings chip; pressed, it narrows the stepper. No chip pressed is all of them. Below 1280px a chip keeps its glyph and count.
- **The stepper's list** shows each finding's type and severity.
- **The tree's dot** for a file's findings is unchanged.
- Tokens only, a glyph or a word beside every color, 24 px targets, and no new key.

## Order of work

One agent, in this order, each step its own commits with `pnpm check` passing:

1. **Status,** in a first commit.
2. **The contract:** `FindingType`, the fields, `pointsOf`'s order, `AnalysisInput.unchangedCallers` and its fakes.
3. **The input and the prompt:** the callers rendered, the findings task, the fingerprints and versions, `PIPELINE_VERSION` 22.
4. **The evals,** up to the limit below. The prompt is settled here, before the page.
5. **The page,** the fake server's fixtures and the end-to-end test.
6. **The documents** and this doc's notes.

## Evals

- **Labels:** every expected finding gains a `type`. The contract labels stage 67 removed are a guide to where a contract finding may be; one is labeled only where the case's code shows who breaks.
- **Cases:** at least two with a must-have contract finding, one of them shown by an unchanged caller, which needs the harness to give a case its callers; at least two with a must-have architecture finding, one for each of a skipped layer and duplicated logic; and at least two labeled with no finding, where a hunk touches an API or a credential and nothing breaks, the stage 67 risks that must not come back.
- **Metrics:** `typeRight`, found labeled findings whose type is the label's, target ≥ 85%. `findingNoise` is also reported per type.
- **The bar to pass:** against stage 67's baseline, `findingNoise` no higher than it by more than one finding over the cases that baseline had, `findingRecall` on logic findings no lower, and no finding at all on the cases labeled with none.
- **The limit:** at most three full runs. If the bar isn't met by the third, drop the type that carries the noise from the prompt, run once more, and say so in the notes. If it still isn't met, stop before the page and leave it as an open issue.
- A new baseline and a report in `evals/reports/<date>/`.
- They spend the reviewer's Claude plan: if Claude Code isn't signed in or the run is refused, leave it as an open issue here rather than work around it.

## Definition of done

- [x] `Finding.type` with its default, and a stored finding without one parses as logic.
- [x] `pointsOf` orders by severity, with a test, and mismatches come last.
- [x] The model's input holds the unchanged callers when the analysis has them, on every transport, and without them the text is what it was after stage 67.
- [x] The findings task asks for the three types with their bars, and each transport's tests and fingerprint are updated.
- [x] The evals met the bar within the limit, with their report and a new baseline, or the notes say what was dropped and why.
- [x] The card's type chip, the severity's color on the marks with its contrast pairs, the type chips on the bar narrowing the stepper, and the list, with component tests and an end-to-end test on the fake server. The small-feature fixture gains no file.
- [x] One AI review on delphi-code #2 through the real server, with its checkout, its findings by type and severity recorded in the notes beside the 6 risks and 1 finding of the run stage 63 records.
- [x] DESIGN.md, ARCHITECTURE.md, ENGINEERING.md and `evals/README.md` say it, with the alternatives.
- [x] `pnpm check` and `pnpm e2e` pass.

### Ubiquitous language (ENGINEERING.md)

| Term | Meaning |
|---|---|
| Finding | Something that looks wrong, on the lines of a hunk that show it, with a type and a severity |
| Finding type | What a finding is about: *logic*, the code does the wrong thing; *contract*, the change breaks or exposes something outside the PR; *architecture*, it's built in the wrong place or way for the code the PR shows |
| Severity | How much Claude thinks a finding matters: *minor*, *major* or *blocking*. It ranks the findings and colors their marks. Comments carry none |

## Notes for later stages

### The evals, against stage 67's baseline

One run of 24 cases, the 18 of stage 67 and six new ones, p16, pipeline 22, judge 7: the first of the three allowed met the bar, on the first prompt tried, so it's the only one, and the new baseline. Nothing was dropped. [The report](../../evals/reports/2026-11-25/finding-types.md) has the rest.

| Metric | Stage 67, 18 cases | Stage 68, the same 18 | Stage 68, all 24 | Target |
|---|---|---|---|---|
| findingRecall | 14/17 | 14/17 | 18/21 | ≥ 90% |
| … on logic findings | 8/11 | 8/11 | 8/11 | the bar: no lower |
| findingNoise | 1/25 | 0/23 | 0/27 | the bar: at most one more than 1 |
| typeRight | | 17/17 | 21/21 | ≥ 85% |
| unwantedFindings, on the two cases with nothing wrong | | | 0 | the bar: 0 |
| mismatchFalsePositives | 4 | 3 | 6 | ≤ 1 |

The three missed must-haves are delphi-account-connections', as in every run. Three of the six false-positive mismatches are on the new cases, where the intent names the finding's problem as a mismatch, and the finding names it back, so it's read once.

### A real run, on delphi-code #2

Through the real server on Sonnet 5.5 through Claude Code, with the reviewer's checkout of delphi-code read and a home of its own (`MEGAREVIEWER_HOME`), so no preference or guideline file. The analysis had the unchanged callers of `create_app` (3 uses), `clone_credentials`, `FakeHost` and `CredentialsGuide` (1 each), and the passes read them.

- **No finding,** where stage 63's run had 6 risks and 1 finding. The eval runs on the same PR found none either, in this stage and the one before it, so the three must-haves on its credentials are still missed. Nothing raised the token routes, the keychain or `create_app`'s callers as a contract finding: what the risks said is now the brief's, whose watch line was "Tokens are now stored in the OS keychain, a new secret store" and "`configured_hosts()` replaced by `known_hosts()`, returning every service".
- **No mismatch.** No guardrail call, since there was no finding.
- **35 seconds** for the run: the intent 4.1 s, reading 130,713 tokens from the cache, the findings 30.8 s; $0.08 at API prices, on the plan.
- The first try ran across the Mac's sleep, with its lid closed, and the intent was cut off at Claude Code's 10 minutes; Remove AI review and a run while awake gave the above.

So the page's type chips and the severity's colors were seen on the fake server only (the end-to-end test on `receiptsTyped`), not on real data.

### How the checks were run

The Mac slept with its lid closed for most of the session, waking for about a minute every 15, which times tests out at random. `pnpm check` passed whole, 3904 tests, in one wake; before that, each of its steps passed run apart, the tests in shards. `pnpm e2e` passed whole, 91 tests, on a port of its own (5180 can be another worktree's), with the design-system snapshots of the tour section updated, the only one that changed.

### What was decided

- The contract and the input are one commit: `type` in the output schema moves every transport's fingerprint.
- A model run reads the analysis's own `unchangedCallers`, and no longer looks the checkout up again. `AnalysisInput.unchangedCallers` names the hunk, not the part, since the model sees whole hunks.
- When even the hunks don't fit with the callers, the callers are left out with a warning, after the file contents: a PR that was analyzed before isn't refused because of them.
- `nothingWrong` marks the two cases where any finding is wrong. A case with no labeled finding isn't the same: on stage 67's baseline dependency-bump-signature and large-retry-after had two each the judge rates valid.
- A mismatch no finding names is grey: it has no severity to take a color from.
- Going to a point of another type than the pressed chip's lets go of the chip, as going to a point lets go of the threads'.
- The bar's order is logic, contract, architecture. Glyphs: `ƒ`, `◆`, `≡`.
- `with-findings.ts` in `src/cli/dev/` replaces the two wrappers that each answered one fake PR's findings, now that a third, `receiptsTyped` (PR 108), needed one.
- The type's chip is grey and the severity has the color; `PointTone` in `web/src/lib/status.ts` is a severity or `mismatch`, and the line marks, the card's bar and label, the bug, the stepper's and list's glyph, the tour's chips and the landing's wash take it.
- The judge's prompt gains a section on the unchanged callers only for a case that has some, so the 18 cases without are judged by the prompt they were (`JUDGE_VERSION` 7).

### Left for later

- delphi-code #2's three must-have findings, missed in every run since the findings pass has been measured on it.
- `mismatchFalsePositives` is over its target, as it was before this stage.
- The design-system page's tour demo still suggests reading a step whose finding it dismissed, as stage 67's notes say.
