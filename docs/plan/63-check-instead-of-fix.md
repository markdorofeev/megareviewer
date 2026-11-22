# Stage 63: A check instead of a fix

**Status:** Done (third version, one commit on `main`). It was built as stage 61, in three versions, on branch claude/ai-guardrails-repeatable-comments-4a6582, while `main` took 61 and 62; that branch isn't merged, so the commits this doc names, but `34ee501`, are its own: the first version `c62aa00..687b98e`, the second `687b98e..fa13b99`
**Depends on:** 45, 55, 56, 58, 59
**Owns:** `src/domain/review/guardrail.ts`, the `guardrail` field of a finding and of a model's risk in `src/domain/review/`, and the `checks` field of a run's guidance in `preference.ts`; the `GuardrailAdvisor` port and its fakes; `src/application/use-cases/guardrails.ts` and the guardrail call of a model run in `run-pipeline.ts` and `model-passes.ts`; the guardrail call in `src/adapters/model/`, never the passes' prompts; the guardrail's line on a finding, a risk and a draft made from one, in `web/src/pages/review/` and `web/src/review/diff/`; the wiring in `src/cli/`; the guardrail call's cases and metrics in `evals/`; the feature's text in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md; and, to remove them, `src/domain/review/repeats.ts`, the repeated comments of `PreferenceStore` with their fakes, contract suite, table and migration, their routes in `contracts/api.ts` and `src/adapters/http/`, and the bar's chip

## Goal

A finding says what's wrong with this code, and the author fixes it there. When a check could catch that kind of problem in any code, a lint rule, a compiler option or an architecture rule, the better answer is the check: it ends the problem for the whole team before review, which is DESIGN.md's sixth principle.

This stage has megareviewer say so on the point. After an AI review's passes, one model call reads the run's findings and risks and marks each one a check could catch, with the check. It only names the check. It never changes the repository, and nothing here is applied for the reviewer.

The stage was built twice and is being built a third time. The second version is the code on this branch, described under [The second version, as built](#the-second-version-as-built). The third version is what the rest of this doc specifies, and it is mostly less code.

Read first: [55-preferences-core.md](55-preferences-core.md), [56-guidance-in-the-passes.md](56-guidance-in-the-passes.md), ARCHITECTURE.md's Model passes and Guardrails sections, `evals/README.md`, and this doc's notes on the second version.

## Why a third version

The second version asked what the reviewer keeps saying. Its faults, each found by using it:

- **Who said it doesn't matter.** It read only the reviewer's own comments and the points they raised. A problem a check could catch is one whether Claude found it or the reviewer wrote it, and the goal is the check, not the repetition.
- **It needed a history.** Nothing showed until megareviewer had recorded comments on three pull requests of the repository. The one real run needed 14 seeded comments to show anything.
- **A draft was still matched by words.** "Swallowing all errors like this makes failures look like the token is missing" matched no group, since `swallowing` isn't `swallow`. Comparing words is never right, and stemming only moves the misses.
- **It was a lot for one line.** Groups, a table, three routes, a chip and its list, and three places on the page.

## Decisions

This stage writes these into DESIGN.md and ARCHITECTURE.md, each with its alternatives, in the documents' own voice, replacing what the second version wrote there. The first and second versions go among the alternatives.

- **Every finding and risk of the run is asked about, once.** The guardrail call reads the run's own points and says, for each, whether a check could catch its kind. It needs no history, so it works on the first review of a repository. What the reviewer keeps saying, grouped by meaning, was the second version.
- **Nothing is kept between pull requests.** The mark is on the point, in the analysis, and goes with Remove AI review. Counting, per repository, how many pull requests each check would have caught something on is the alternative kept for later: it would rank the checks, by the check's own name, which is exact, and needs no comment compared with another.
- **A guardrail catches a kind of problem, not this one.** A lint rule, a compiler or type-checker option, a formatter, a pattern rule somebody writes, an architecture rule, a check in CI such as an API-compatibility check or a scanner. A test of this one behavior isn't one: "a test could catch this" is true of every bug, and would be on every finding. A matter of judgment gets none.
- **Marks are rare, and that's accepted.** The findings pass leaves out style, naming and missing tests, most of what a linter catches, and most of what it finds is a logic bug no check decides. The reviewer's own comments on the pull request and other people's threads aren't read in this version.
- **A rule the repository already has isn't said.** When the config names the rule, or the model says a preset turns it on, there's nothing to move to a check, and megareviewer can't tell a wrong rule from a file that isn't linted. Saying "this repository already has a rule for this" was the second version's.
- **Verified means the config, not the rule.** megareviewer checks that the config it read doesn't name the rule. That the rule exists in the tool and would report this is the model's word; the line claims only the first, and the evals count a rule no label lists with a target of none. A list of every tool's rules in megareviewer was the alternative: thousands of names that go stale with each release of each tool.
- **Root configs, at the base commit.** A nested config isn't read, so in a monorepo megareviewer can say a rule is off that a nested config turns on; the line names the file it read. A config the pull request itself changes verifies nothing: its rule is a suggestion, since the base commit's file no longer says what the repository will have.
- **Findings and risks, not decisions.** A decision never asks for a change. A risk a test already checks can still be marked: the test checks this code, a guardrail the kind.
- **The line is on the point's card, and on the draft made from it.** A draft a point's Add to review or Comment made knows its point, so it shows the point's guardrail with "Add to comment", and no words are compared. The bar's chip and its list go: nothing is kept that they'd list. megareviewer still writes nothing in a comment without a click; ending a raised finding's comment with the check by default is left for later.
- **The call starts when the passes have ended,** since it reads the risks too, and the review lands without it. Its marks come after, without the landing playing again and without moving the code being read.
- **The four passes are what they were before the stage,** as in the second version. The call can only add a mark to a point, never change, add or remove one, and its failure is a line in Run details.
- **Not in this stage:** the reviewer's own comments, the pull request's threads, anything kept or counted across pull requests, nested configs, applying a guardrail, and a list on the preferences page.

## Contract

The second version's code is the starting point: cut it down, don't build beside it. Names here are the ones other code will use; where the code makes a better one obvious, take it and say so in the notes.

### Domain

- **`Guardrail`** (`src/domain/review/guardrail.ts`) is a union of two:
  - `{ is: "rule", tool, rule, configPath }`: a named rule of a tool whose config megareviewer read, which the config doesn't name.
  - `{ is: "suggested", kind: GuardrailKind, engine, does }`: the model's word. `GuardrailKind`, the engine's pattern and the sentence's 160 characters stay as they are.
  - `configured` goes, from the type, the page and the stored analyses.
- **`guardrailOf(draft, configs, changedPaths)`**: the model's draft into a `Guardrail` or null.
  - A draft naming a `GuardrailTool` and a rule, whose tool has a config that the pull request doesn't change, goes through `ruleStanding`: unnamed and the model says off is `rule`; named, or the model says on, is null.
  - A named tool without a config, or whose config is among `changedPaths`, is `suggested` when the draft has a valid kind, engine and sentence, else null.
  - Anything else with a valid kind, engine and sentence is `suggested`, unless the model says the repository already has it, which is null.
- **`ruleStanding`**, the tools, `CHECK_CONFIG_PATHS` and `BUILD_FILE_PATHS` stay. The working tree's fix to Ruff's selectors stays with them.
- **`Finding.guardrail: Guardrail | null`**, default null, replaces `Finding.repeated`. A model's risk gains the same field, beside its checking test and its guidance mark, kept only on a contract hunk. `Point.guardrail` passes both through. An analysis the second version stored, which only this branch made, parses with `repeated` dropped.
- **`src/domain/review/repeats.ts` goes whole:** `RepeatedComment`, `repeatedCommentsOf`, `matchRepeatedComment`, `wordsOf`, `saysTheSame` and `MIN_REPEATED_PULL_REQUESTS`, unless something outside this stage uses one, which then stays where it's used and is named in the notes.
- `Guidance.checks` stays, the record of the configs and build files the call read.

### Ports

- **`GuardrailAdvisor.advise(input)`** changes its input and answer:
  - `AdviceInput`: `{ repo, points: { ref, kind: "finding" | "risk", path, title, text, code }[], configs: CheckConfig[], buildFiles: { path, content }[] }`. `ref` is `f1`… for findings and `r1`… for risks. `text` is a finding's explanation or a risk's reason, a risk's `title` empty. `code` is the lines the point rests on as its hunk shows them, at most 40, the rest counted in one line.
  - `AdviceDraft`, a Zod schema since it's model output: `{ marks: { point: string, guardrail: { kind, tool: GuardrailTool | null, engine, rule: string | null, on: boolean, does } }[] }`. A point without a mark has no guardrail. Loose on purpose: the use case checks everything.
- **`PreferenceStore`** loses `listRepeatedComments`, `getRepeatedComment` and `saveRepeatedComments`, from the port, the contract suite, the in-memory fake and SQLite. The `repeated_comments` table and its migration are deleted, not dropped by another migration: no released version has them, so the schema's version is main's again.
- `ModelCallName`, the call's usage and record, `Clock.wait` and the analysis's `guardrails` status stay.

### Use cases

- **In a model run** (`run-pipeline.ts`, `model-passes.ts`, `guardrails.ts`): when the four passes have ended and the run has at least one finding or one risk the model raised:
  1. Take the run's findings as the server's checks kept them, those a Don't flag preference left out among them, and its risks. The intent's mismatches no finding names aren't asked about.
  2. Read the check configs and build files at the PR's base commit, for the languages of the files the points are in, through the file cache.
  3. Call the advisor on the run's option.
  4. `guardrailOf` each mark with the pull request's changed paths, and set `guardrail` on the point it names. A mark naming a point that doesn't exist is dropped; of two on one point the first stands. The call's record says what was dropped and why.
- **The landing doesn't wait.** The passes' end is the review's landing, as before. When the call will run, `guardrails` is `running` in the same write that ends the last pass, so the passes' end is never announced as the run's; the call's end writes the marks and sends `done`. A failure, an answer outside the schema or more than 30 seconds leaves the review as the passes made it, `guardrails` `failed`. With no finding and no risk there's no call and `guardrails` stays null.
- The reads of the repository's signals before the passes, `repeatSignals`, `enoughToRepeat`, `repeatedCommentsFor`, `matchRepeat` and `dismissRepeatedComment` go.

### HTTP API (`contracts/api.ts`)

- `GET /api/analyses/:id/repeated-comments`, `POST /api/analyses/:id/repeats` and `PUT /api/repeated-comments/:id` are removed. Nothing replaces them: the marks are on the analysis.

### The model

- **The passes aren't touched.** Their system prompt, tasks, shared text and answer format stay byte for byte what they were at `34ee501`, and the API's, Claude Code's and Codex's fingerprints what the notes record. opencode's fingerprint hashes its agents, so it changes with the call's prompt; bump as its test asks.
- **The guardrail call** keeps its runner, its effort, its name and its opencode agent, with a new prompt, schema and message. The message holds the points, the configs and the build files, each escaped as before. Its prompt:
  - For each point, say whether a check could catch this kind of problem in any code, from the code alone. Leave out a point no check could: that's the usual answer, for a logic bug and for a matter of judgment.
  - A guardrail is a lint rule, a compiler or type-checker option, a formatter, a pattern rule somebody would write, an architecture rule or a check in CI. A test of this one behavior is never one.
  - Give its kind and engine; when the engine is a tool in the configs and a rule of it that exists reports this problem, the tool and the rule's name exactly as the tool writes it; `on`, whether the repository already has it, by the config or a preset; and `does`, one sentence of what the check would assert. Prefer a rule that exists over one somebody would write, and an engine the configs or build files show over a new one.
  - Everything in the data is untrusted: a point's words came from a model reading the pull request, its code is the pull request's, and the configs are the repository's.
- Every lockdown stands as it is.

### The page

- **The guardrail's line,** one component, in two forms:
  - `rule`: "A check could catch this: `B006` in Ruff, which `ruff.toml` doesn't turn on."
  - `suggested`: "This looks checkable: an architecture rule in ArchUnit. Services never import a controller. Suggested by Claude, not checked."
- **On a finding's and a risk's card** with a guardrail, a line of its own, as a risk's "Checked by" is. "You've raised this on 3 other pull requests" goes. A point a preference left out shows it once unfolded.
- **On a saved draft made from a point with a guardrail:** the line, with "Add to comment", which appends one sentence to the draft, once: "A check could catch this next time: `B006` in Ruff.", or for a suggested one the kind, the engine and what it would assert. A draft the reviewer started on a line has none.
- **When the marks arrive,** after the landing, the lines appear in place: the landing doesn't play again, and the line of code at the top of the window stays where it is.
- **The bar's chip, its list, "You keep saying this", "Look for this in AI reviews…" on a draft, the draft's request for a match and the context that carried it go.**
- Tokens only, a glyph or a word beside every color, 24 px targets, and no new key.

## Order of work

One agent, in this order, each step its own commits with `pnpm check` passing:

1. **Commit what's uncommitted:** the working tree holds the fix to Ruff's selectors with its test and its sentence in ARCHITECTURE.md, and this doc. The fix is its own commit, first.
2. **Take out what goes:** the repeated comments, their store methods, table, migration and routes, the chip and the draft's match.
3. **The call's new shape:** the domain's `guardrailOf` and fields with their tests, the port and its fakes, the prompt and schema on each transport, the run making the call when the passes end.
4. **The page:** the line on a finding, on a risk and on a draft made from one, the fake server and the end-to-end test.
5. **The evals,** then the documents and this doc's notes.

Steps 2 and 3 may be one commit if `pnpm check` can't pass between them.

## Evals

- **The four passes aren't run again:** show their prompts are what they were, as the second version's notes do.
- **The guardrail call's cases are replaced,** and run once on Sonnet 5.5 through Claude Code. A case is a set of points with their code, configs, build files and changed paths, with a label for every point: a `rule` with its tool and the rules that would do, a `suggested` with its kind, or none. The first version's three cases, at `8b93b90`, had findings with guardrails and may be a start. At least:
  - **TypeScript:** a dropped promise and a paging bug that's off by one, with a `biome.json` that doesn't have the rule. Expected: a `rule` on Biome for the first, none for the second.
  - **Python:** a broad `except` and a mutable default argument, with a `ruff.toml` that selects `"B"` and not `"BLE"`. Expected: `BLE001` as a `rule` for the first, none for the second, whose rule the config has.
  - **Java:** a service importing a controller, with a `checkstyle.xml` and a `pom.xml` with ArchUnit in it. Expected: `suggested`, an architecture rule.
  - **Judgment and tests:** a tenant filter lost on one path, and a wrong rounding a unit test would catch. Expected: none for both.
  - **A risk:** a changed order of credentials. Expected: none.
- Metrics, with targets: `guardrailRight`, labeled guardrails returned with the labeled form and kind, and the tool and a listed rule where the label has them, ≥ 90%; `guardrailWrong`, marks on points labeled none, and `rule`s naming a rule the label doesn't list, out of all marks, none. `repeatsFound` and `repeatsWrong` go.
- They spend the reviewer's Claude plan: if Claude Code isn't signed in or the run is refused, leave it as an open issue here rather than work around it.

## Definition of done

- [x] The Ruff fix is committed on its own.
- [x] The repeated comments are gone: the domain's file, the store's methods on the fake and on SQLite with the table and its migration, the three routes, the chip and the draft's match. The schema's version is main's.
- [x] `guardrailOf` with tests for each outcome: a `rule`; null for a rule the config names and for one the model says is on; `suggested` for a tool without a config and for one whose config the pull request changes; `suggested` and null for a draft without a tool.
- [x] A model run makes the call when its passes have ended, only with a finding or a risk, marks the points it names, drops a mark on a point that doesn't exist, and lists the call in Run details. The review lands before the call ends; a failed, invalid or slow call changes nothing else.
- [x] `GuardrailAdvisor` on Claude Code, the API, Codex and opencode, each with its transport's tests, and the passes' fingerprints unchanged on the first three.
- [x] The line on a finding, on a risk and on a draft made from one, with component tests for both forms, and an end-to-end test on the fake server: a run, the line on a finding, Add to review, Add to comment. The marks' arrival doesn't move the code in the window. The small-feature fixture stays as it is.
- [x] The call's eval cases ran, with their report, or the open issue says why not.
- [x] DESIGN.md, ARCHITECTURE.md and ENGINEERING.md say the third version, with the first two among the alternatives; the storage table and the count of preference tables are right again.
- [x] `pnpm check` and `pnpm e2e` pass.

### Ubiquitous language (ENGINEERING.md)

| Term | Meaning |
|---|---|
| Guardrail | A check that would catch a kind of problem before review, in any code: a named rule of a tool whose config megareviewer read, which the config doesn't turn on, or a kind of check and an engine the model suggests. A mark on a finding or a risk. megareviewer names it and never turns it on |
| Check config | A tool's configuration file at a repository's root, read at the PR's base commit to know which rules the repository has |

Repeated comment leaves the table, and Model call's and Guidance's rows keep their mention of the guardrail call.

## Notes for later stages

### The third version, as built

On that branch, before they became one commit on `main`: the Ruff fix in `a4b84c5`, the doc in `ae96bb0`, the removal and the call's new shape in `94a9f43`, the page in `ac7a866`, the evals in `72d2714`, the documents after.

#### The passes are what they were at `34ee501`

`git diff 34ee501 -- src/adapters/model/shared/prompts/system.ts src/adapters/model/shared/prompts/passes.ts src/adapters/model/shared/render-input.ts src/adapters/model/shared/output-schema.ts` is still empty, and the fingerprint tests still give that commit's values: the API `31e4322926af2bfe`, Claude Code `3772d089a53898a6`, Codex `ba5e6432db8f19a0`, at the second version's `p15`, `p13` and `p9`. opencode's hashes its agents too, so the call's new prompt moved it to `p9` (`18df12ee7a89cc9f`). `FindingDraft` omits `guardrail`, so the findings' schema is what it was; the risk pass's `ModelRisk` is a schema of its own and never had it.

#### Where the code differs from the Contract

- **`guardrail` is optional, not `| null`,** on `Finding` and `RiskAssessment`, parsed with `StoredGuardrail` (`Guardrail.optional().catch(undefined)`): a point the call didn't mark has none, and the many literals of findings and risks in fixtures and tests needed no new field. The catch is what makes an analysis an earlier version stored read: the first version's `{ tool, rule, configPath }` without `is`, and `configured`, read as none; the second's `repeated` is dropped as an unknown key.
- **The call's place in the run.** `runGuardrailCall` is in `guardrails.ts`, with `askable` and `codeOf`; `run-pipeline.ts` wraps each pass's stage patch so the last to end sets `guardrails: running` in the same write when the run has a finding or a model risk, then makes the call after `finishModel` from the tracker's current analysis. Nothing in `model-passes.ts` changed. A pass that failed still lets the call run on what the others found.
- **A mark the server drops is a problem in the call's record,** with why: no such point, an earlier mark on the point, or a rule the repository already has or no valid check. So the record's outcome is `problems` whenever the model said a rule is on; that isn't a fault of the answer, and it's what Run details shows.
- **The code a point rests on** carries each line's diff marker, `+`, `-` or a space, so the model reads what was removed.
- **The draft made from a point** is found without a field on the stored draft: the raised point with a guardrail whose card is on the draft's part and whose lines end on the draft's line (its hunk's first changed line when it has none), as Add to review and Comment put it. A draft the reviewer started on that same line of a raised point would show it too.
- **Holding the code in place.** `useMarksHeld` shows the analysis whose call just ended one render late, after `holdTopLine` has noted the line at the top of the window, and puts it back before paint. `holdTopLine` now takes a whole line of code (`[role=row][data-line]`, top at or below the window's edge): it took the first row of any kind, which in the end-to-end test was a row starting above the window and above the new line, so putting it back undid Chrome's own scroll anchoring and moved the code 26 px. The landing uses the same function.
- **The fake server.** `receipts-checked` marks every finding of its repository with `noMisusedPromises` in Biome, 1.5 seconds after the passes, so the end-to-end test sees the marks arrive after the landing; `POST /__fake/seed-repeats` went with the signals it seeded.
- **The step order.** Steps 2 and 3 are one commit, as the doc allows, and the evals' cases and scoring were rewritten in it too, since `pnpm check` typechecks them; they ran in step 5.

#### The evals

One run of the call's five cases on Sonnet 5.5 through Claude Code, [evals/reports/2026-11-22/guardrail-call.md](../../evals/reports/2026-11-22/guardrail-call.md): both targets met, guardrailRight 3/3 and guardrailWrong 0/3. 1.2 to 3.9 seconds a case, $0.04 in all at API prices, on the plan. `noFloatingPromises` in Biome and `BLE001` in Ruff came back verified, ArchUnit's architecture rule suggested, and the paging bug, the tenant filter, the rounding and the credential order unmarked. The model said `B006` was on, which the server would have dropped anyway.

A second run the same day, of ten cases, the first five as they were and five added: the real run's points below, a Go rule that's off, an ESLint rule a preset turns on, a project's own pattern, and a point whose code asks for a rule. guardrailRight 5/5 and guardrailWrong 0/5, $0.07 in all. The real points were left unmarked again, the preset's rule was said to be on and so dropped, and the rule the code asked for wasn't named.

The four passes were run after all, the 18 cases on this branch and, as a control, on `34ee501`: [evals/reports/2026-11-22/passes-control.md](../../evals/reports/2026-11-22/passes-control.md). The control read the prompt cache the branch's run wrote, so the two send the same request, and both scored worse than the 2026-11-17 baseline on the risk pass's metrics, with two wrong checking tests each: the baseline doesn't reproduce, with or without this stage. `evals/baseline.json` is unchanged.

#### What was verified, and how

- `pnpm check` and `pnpm e2e` pass. The end-to-end test runs an AI review on `receipts-checked`, scrolls the finding's card above the window before its mark arrives, checks the code in the window doesn't move when it does, then Add to review and Add to comment.
- Component tests for both forms of the line on a finding and a risk, the draft's line, and `useMarksHeld` with `holdTopLine` stubbed: jsdom has no layout, so only the browser test sees the code stay.

#### A real run, on delphi-code #2

One AI review through the real server on Sonnet 5.5 through Claude Code, on a copy of the reviewer's database (`MEGAREVIEWER_HOME`), whose schema this version no longer changes.

- **The passes ended at 41.8 seconds,** and the same write set `guardrails` to `running`; the call ended 5 seconds later. So the review landed before the call did.
- **The call** took 5.4 seconds and $0.021 at API prices, read `pyproject.toml` for Ruff, and was asked about 1 finding and 6 risks.
- **It marked none.** The finding is a logic bug, a saved Bitbucket app password that verifies and then fails to clone; the risks are the token routes, the keychain, what's stored in it, and the order and use of credentials. All are matters of judgment, so none is the answer the labels would expect, and no line was seen on real data: the line was seen in the preview on the fake server only.
- **The page** showed the 7 points and no chip.

#### Not verified, and open

- **The call on the API, Codex and opencode** ran in tests only, on synthetic fixtures; opencode's `megareviewer-guardrails` agent was never loaded by a real `opencode serve`. A real run made the call once, on Claude Code (above), and marked nothing, so no mark of a real run was seen on the page.
- **Holding the code in Safari,** which has no scroll anchoring: Chrome's anchoring did the work in the end-to-end test, where the held line didn't move; the hold is what keeps it there without anchoring, untried.
- **Ten cases decide the rates,** five labeled guardrails among them, and one case in a model's own words.
- **The design-system page** shows neither form of the line: `web/src/design-system/` isn't this stage's.

### The second version, as built

What still holds of it: the guardrail call as a call of its own on the one-call runner of every transport (`RunOneCall`, `shared/guardrail-call.ts`, `shared/prompts/guardrails.ts`, each transport's `*-guardrail-call.test.ts`, opencode's `megareviewer-guardrails` agent); `ModelCallName` naming the call's usage and record `guardrails`, and Run details showing it as "Guardrails"; `Clock.wait(ms)` for the 30-second limit, `FixedClock` resolving it on `advance`; the analysis's `guardrails` status, `following`, the passes' end announced as an update while the call runs, `finishGuardrails`, and a stopped call failed at the next start; `ruleStanding`, the tools with Checkstyle and PMD, the build files and `Guidance.checks`; `evals/guardrail-cases.ts`, `guardrail-score.ts` and `run-guardrails.ts` at the top of `evals/`, scored without a judge. Its repeated comments, their store, table, routes, chip and draft match, and the `configured` form went; its notes are in git at `ae96bb0`.

One real run of it, on delphi-code #2 on a copy of the reviewer's database, found the Ruff bug fixed in `a4b84c5`: `ruleStanding` read the selector `"B"` as naming `BLE001` by prefix. A selector now goes by its linter's letters: `"B"` and `"B0"` select `B006`, never `BLE001`; `"PL"` covers Pylint's `PLC`, `PLE`, `PLR` and `PLW`.
