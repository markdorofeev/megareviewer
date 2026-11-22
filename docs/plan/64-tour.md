# Stage 64: A tour of the PR, behind a switch

**Status:** Done on `main`, but part 8's evals and the steps prompt's tuning, left for later (see the notes). It was built as stage 63 on branch claude/pr-guided-tour-2a84b6 while `main` took 63 for [a check instead of a fix](63-check-instead-of-fix.md), and renumbered when rebased onto it
**Depends on:** 27, 45, 50, 56, 61
**Owns:** `src/domain/review/step.ts`, the steps pass in `src/adapters/model/`, `runSteps` in `src/application/use-cases/`, `steps` on the analysis and in `contracts/`, the Understand layout in `web/src/pages/review/`, the switches of the Display menu in `web/src/lib/page-display.tsx` and `web/src/app/Header.tsx`, the tour's examples in `web/src/design-system/`, its pairs in `scripts/check-contrast.mjs`, `e2e/tour.spec.ts`, the steps' scoring in `evals/`, and the tour's paragraphs in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md

## Goal

In about two minutes a reviewer understands what a PR does and how, and sees whether anything is fundamentally wrong, without reading the files. Then they approve from the bar or go to the code. The tour is optional twice over: it's behind a switch in the Display menu, off by default, and with the switch on the page still opens on the code.

The tour is the second layout. With the switch on, Overview is named Understand: a strip of the changed directories with the tour's path lit, then the **steps**, then what the tour didn't show. A step is one sentence and the few lines that decide, real diff lines the reviewer can comment on. The model writes the steps in a fifth pass; everything else on the page is the code's.

Read first: DESIGN.md's decisions on files read whole, on each kind of point, and on the model being optional; ARCHITECTURE.md's Model passes and Review page; ENGINEERING.md's UI rules. The design is `/Users/markdorofeev/Downloads/hunk-tour`: `IMPLEMENTATION.md`, `reference/`, `prototype/` and `shots/`. Where this doc and the design differ, this doc wins. `git show ad4e956` removed the last tour pass and is a map of every file a pass touches.

## The switch

- Display menu, under Decisions: **Tour (preview)**, a checkbox, kept per browser, off by default. `PageDisplay.toggle` becomes a list of switches.
- **Off:** the page, its requests and the model's requests are what they are today, byte for byte. A test holds the four passes' request to its hash from before, as the guidance test holds the prompt's.
- **On:** the layout's second option reads Understand; the stored value stays `overview`. Request AI review, Re-run and Try again ask for the tour with the run (`RunModelRequest.tour`).

## Not taken from the design

| Design | Here | Why |
|---|---|---|
| Not in the tour lists files without a step | The ledger counts changed lines, and its first group is the rest of the steps' files | Step 4 shows 8 of `keychain.py`'s 164 added lines; the other 156 were in no list |
| Without a tour, a flat row of boxes that can't be clicked | Today's Overview, unchanged, with one line under the bar's row saying why there's no tour | The page has to be as good without the model as it is today |
| "4 of 8 directories read", Read / Reading / Waiting per box | Today's Overview and "The tour is being written", `role="status"` | The passes read the whole PR at once; only passes done is known |
| A Display button in a 40 px row under the bar, on both layouts | Display stays in the header. The row shows in the Map only after arriving from the tour, as the bar's second row, with Back to tour and a button to dismiss it | An empty row costs a line of code on every screen |
| Esc in the tour leaves for the code | Esc keeps today's direction: in the Map it goes back to the step the Map was opened from | Both together bounce between the layouts |
| The steps list is the only scroller; the header and the diagram collapse after 30 px | The window scrolls. The strip is sticky under the bar, full at the top and compact once stuck | The bar, the cards' headers and `scroll-padding-top` all rest on the window scrolling |
| The model returns boxes, the path, the ledger, the points' texts and the suggested depth | The model returns only steps. Boxes are the Overview's directories, the ledger is counted from the diff, the chips are the analysis's points, and the depth is a rule | Each of them is known to the code, and a second wording of a finding is one more thing to be wrong |
| 1 to 3 points on every step | The points whose lines an excerpt shows, which can be none | Points aren't written for steps |
| Landing lines tinted | Landing lines marked on their numbers with a primary rail, as a finding's are in red | A tint under code needs a contrast pair for every syntax color |
| `--tour-*` tokens, `--code-font` | The existing utilities; no aliases | They'd be names for tokens we have |
| A tour out of date after new commits | Nothing | An analysis is one head commit's |
| Code / Understand | Map / Understand | Map is the page's word everywhere else |

## The step

A new term, added to ENGINEERING.md first: **Step**, a place on the page's tour, one sentence and the lines of one or two hunks that decide, in call order; the model writes it and the server checks it. The code's own steps from the call graph, its flows (`Flows` and `Flow`, which were `Tour` and `TourStep`), keep their job, ordering and labelling the Overview.

```ts
// src/domain/review/step.ts
StepId        // "t1", "t2", … in tour order
Step          { id, sentence, excerpts: PointLines[] }   // 1 or 2 excerpts
Analysis.steps: Step[] | null                            // null: no run asked for the tour
```

An excerpt is `PointLines`, either side, so a step can show a removed check.

### The pass

- Named `steps`, as a pass and as a stage. `tour` is taken: stored analyses from the old tour pass have that name stripped on load.
- It reads only the PR, from the prompt cache, and starts with risk and decisions. Medium effort.
- A run that asks for the tour sends every pass the five-variant union, so they share one cache; a run that doesn't sends today's four. **Check first** that Claude Code and the API accept the five-variant union. ARCHITECTURE.md says the union is near what a provider's grammar takes. If one refuses it, step and record what it said in the notes.
- It's optional to the run: the review's four stages decide `modelRunnable`, `inProgress` and the run's error as today. A steps pass that fails is its stage's `failed`, a model call in Run details and the reason on the Understand page, never `modelError`. The bar counts "of 5" only when the tour was asked for.
- Remove AI review clears `steps`.

### What the task asks for

- Follow the change the way a request or a user action runs through it, from where it's reached to what it ends in, callers before callees.
- 3 to 7 steps. Fewer than 3 real hops: answer with none. More: merge neighbors.
- A sentence of at most 20 words, present tense, behavior a caller notices, code names in backticks, no period.
- One excerpt, 4 to 14 lines, the lines that decide. Two only when one hop crosses into another process, such as a client call and its route.
- No step on a test, a generated file or docs. Nothing that looks wrong, and no risk: those are other passes'.
- The system prompt's rules on PR content and guidance stand; the task says nothing more about guidance.

### What the server checks

`validateSteps` in the domain, pure, with adversarial tests:

1. Each excerpt's hunk exists, has no mechanical proof, and shows its lines on its side.
2. A step's two excerpts are in different files.
3. No step comes before a step whose code calls its own, by the call graph's direct hints between their parts.
4. At most 7 steps.

A problem is told to one retry. After it: a bad excerpt is dropped, a step with none left is dropped, steps past the seventh are dropped and logged, an order still wrong is kept and logged, and fewer than 3 steps left is no tour, with why. An excerpt longer than asked is kept as written and never retried.

## The page

`tourOf()` in `web/src/pages/review/tour.ts` is the pure function from the analysis, the Overview and the points to everything Understand draws. Its tests hold the ledger's invariant: the changed lines the steps show plus the ledger's lines are the PR's changed lines.

### Entry

- The brief's status line ends with "Tour · 5 steps", a link, once a run has steps and the switch is on.
- The Display menu's layout, and `v`.

### Understand, with a tour

- **Strip.** One box per directory the steps reach, in the order they first reach it, by the Overview's own grouping and labels; the other directories after a divider, dashed, "No step". A box on the tour has its steps' numbers; the current step's box has the stronger border, the filled number and "Current step". Two neighboring boxes one step spans sit in a dashed group. A click on a lit box goes to its lowest step; on a no-step box, to its group in the ledger. Sticky under the bar; compact once stuck and at less than 1180 px.
- **Steps.** Number, sentence, chips, one card per excerpt. The current step is the last whose top has passed the strip.
- **Chips** are the analysis's points whose lines overlap an excerpt: finding, risk, then decision, each with its glyph and its word, as text. A click opens the point's card in the Map. Decisions show here with the Decisions switch off: the tour is where a choice is accepted. A dismissed point is struck through; one a preference left out isn't shown.
- **Card.** The file, "lines 28–35 · 8 of 164 changed lines", Open in code, then the excerpt's rows drawn by the diff view a part uses, with its comment box and the reviewer's drafts. No point cards inside it.
- **After the tour.**
  - *Not in the tour*, a group each, empty ones left out: the rest of the steps' files, tests, generated and proved mechanical, other files. A file's row has its lines not shown and opens it in the Map.
  - *Findings and risks outside the steps*, each opening its card in the Map. Never decisions.
  - *Suggested depth*, from a rule: the steps with an open finding or a risk no test checks are the ones to read in the code, and it says how many findings and risks are outside the steps. With none of either, it says so.

### Understand, without a tour

Today's Overview, and one line saying why: no AI review yet, the review ran without the tour ("Re-run to get it"), the tour is being written, the change is too small for one, or the pass's error.

### Between the layouts

- **Open in code** opens the Map on the excerpt's lines, marked on their numbers, under a label, "Tour step 3 · A token is verified against the host before saving". The bar gets its second row, "← Back to tour · Step 3".
- **Back to tour**, and Esc in the Map, return to that step. `v` from the Map lands on the step last current, kept per analysis in `sessionStorage`; from Understand it lands on the current step's lines.
- The stepper's points and threads open the Map from Understand, as from the Overview today.
- Drafts and point states are the analysis's, so both layouts show the same ones.

### Not in this stage

- Today's layered diagram while a tour is shown. With the switch on and a tour, it's reached by turning the switch off.
- Dismiss and Add to review on a chip.
- A step's own keys.

## Work

Each part is one commit that passes `pnpm check`.

1. **Domain.** `Step`, `validateSteps`, `steps` on the analysis with its default, the `steps` stage and pass with their defaults for stored analyses, and the helpers that must not count it as one of the review's four. The term in ENGINEERING.md.
2. **Pass.** The union's fifth variant, used only by a run that asks; the task prompt; `steps()` on `AnalysisModel`, its contract suite and fake; every transport and its fixtures; `RunModelRequest.tour`; `runSteps` in the run with its retry, and Remove AI review. The hash test for a run without the tour.
3. **Switch.** The Display menu's list of switches, "Tour (preview)", and the run's request carrying it. Nothing else changes on the page yet.
4. **Understand.** `tourOf()` with tests, the strip, the steps, the cards, After the tour, and the line for each state without a tour.
5. **Between the layouts.** The brief's link, Open in code and its landing, the bar's second row, Esc, `v`, the remembered step.
6. **Checks and examples.** The fake server's PR with steps, added as a variant and not by changing `small-feature`; `e2e/tour.spec.ts`; the design system's examples and baselines; the contrast pairs for the lit box, the current pill and the three chips.
7. **Docs.** DESIGN.md's decision, with the alternatives this slice rejected: a third layout, a spotlight over the Map, the tour as the first screen, and the rows of the table above. ARCHITECTURE.md's pass, its checks and the Understand layout. This doc's notes.
8. **Live check and evals.** Both spend the reviewer's plan, so ask before running either. One run on delphi-code #2 with the tour: the steps, their order, the ledger's invariant, the time and cost against a run without. Then the evals with the tour off, to show nothing moved, and structural scores for the steps: cases with a valid tour first time, steps out of call order, excerpts over 14 lines.

## Done when

- `pnpm check` passes, and the e2e and design-system specs with their baselines.
- With the switch off, the review page's e2e specs pass unchanged and the four passes' request has the hash it had.
- With it on, on the fake server's PR, in light and dark: the brief's link opens the tour; a box goes to its step; a comment added on a step's line is in the Map and in Publish; Open in code lands on the lines and Esc comes back to the step; the ledger's lines and the steps' add up to the PR's.
- Understand without a tour is today's Overview, for each of its five reasons.

## Notes for later stages

- **The union check (part 2), 2026-11-22.** Claude Code 2.1.303 on Haiku 5.5 took the five-variant schema with `--json-schema` and answered `{"answer":{"pass":"steps","steps":[]}}`. The Anthropic API refused it with 400 `invalid_request_error`: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." It refuses today's four-variant schema the same way, on Haiku 5.5 and Sonnet 5.5, and so it refuses the real `passRequest` for the intent pass on small-feature without the tour (4,437 bytes of schema; the five are 5,003). So the API transport couldn't run any pass, with or without the tour, and the steps variant isn't what broke it. `evals/union-check.ts` repeats the check on Claude Code. Fixed since: the API transport sends no output format and ends each pass's task with the schema of its own answer, the steps pass's too, as opencode does (ARCHITECTURE.md, Model passes), so its requests are the same with the tour or without, `passRequest` takes no `tour`, and `TOUR_FINGERPRINT` covers the steps pass's request alone, as opencode's does.
- **Where the build differs from this doc, and why.**
  - The steps stage keeps the analysis in progress while it runs (`inProgress`), unlike "the review's four decide `inProgress`". Without it the page's event stream ended when the four did and missed the tour, and a server stopped mid-tour would leave the stage running forever. The four still decide `modelRunnable` and the run's error; `recoverInterruptedAnalyses` fails only the tour, as `stepsError`, when only the steps pass was running.
  - `ModelPass` gained `steps` in part 2, not part 1: the pass-keyed tables in the adapters (efforts, prompts, the fake's scripts) would otherwise have needed a placeholder task.
  - Part 2 is one commit, as the doc's parts are, though it holds the port's contract change (`AnalysisModel.steps`, `PassOptions.tour`, `RunModelRequest.tour`) with the transports that use it: they don't compile apart.
  - The model versions weren't bumped. A run without the tour sends what it did, which the existing fingerprints hold; each transport has a second fingerprint for a run with the tour (`*_TOUR_FINGERPRINT`). The model version isn't in the analysis cache key, so a bump would only relabel runs.
  - An excerpt's rows run from the first row of its side's first line to the last of its last line, so the other side's lines between them show too; its "changed lines" count both. A row two steps show counts once, which is what makes the ledger add up.
  - The ledger's groups are four: the rest of the steps' files, tests, generated and mechanical as one group, and other files. A file no step touches is listed even with no lines (a rename, a binary file), so nothing in the PR is missing from Understand.
  - A decision's chip opens its lines in the map while the Decisions switch is off, since the map has no card for it then; turning the switch on for the reviewer was the alternative.
  - The landing label sits under the header of the part that holds the excerpt's first row, which can start a few lines above the excerpt; the marks are on the excerpt's lines themselves.
  - `SuggestPreferencesRequest` was `RunModelRequest`; it has its own schema now, so the suggestion call doesn't take `tour`.
  - The mock API (`pnpm dev:web:mock`) answers a run that asks for the tour with `fixtureSteps`, and the design system has a Tour section of its own, with baselines, built from them.
- **Not done here.** Part 8, the live run on delphi-code #2 and the evals with the tour off and on, spends the reviewer's plan and waits for their go-ahead. `evals/` doesn't score steps yet: the structural scores (valid tour first time, steps out of call order, excerpts over 14 lines) belong with that run.
- **Found on the way, outside this stage.** `e2e/review.spec.ts`'s "publishes exactly what the preview shows" waited for a "Published" status the bar no longer shows since 2e35f4f made it say the reviewer's verdict; this branch's fix, which checked the verdict instead, was dropped in the rebase for `main`'s f7273b2, which fixes the same test. The Anthropic API's grammar limit above broke every pass on that transport, until it stopped sending a format.
- **The planning session's review, fixed in 2322cf3.** Open in code scrolled to the excerpt's part, and the cards above the excerpt then took their size and pushed it out of the window; it scrolls to the step's label now and holds it there (`holdInView`) until the reader moves. Going back to a step landed short of it with the previous step still current; the strip compacts before the scroll now, and the step stays current until the reader moves. Suggested depth said "0 findings"; a zero count is left out.
- **The live run (part 8), 2026-11-22.** One Request AI review with the tour on delphi-code #2 at c07d2c5f, the checkout read, Sonnet 5.5 through Claude Code 2.1.303 on the reviewer's plan. The shared `~/.megareviewer` database was at schema 8 from a newer main, which this branch (7, before the rebase) couldn't open, so the server ran on a fresh `MEGAREVIEWER_HOME`; its first collect failed on GitHub's answer for 3 files ("expected object, received undefined") and a retry went through. The eval run over the eval cases hasn't been run.
  - **Steps, as kept:** 7.
    1. "The setup page's `ConnectionsSection` loads account connections and sends a pasted token with `PUT` to the token route": `web/src/setup/ConnectionsSection.tsx` 101–113.
    2. "The same-origin `PUT` and `DELETE` token routes call `connect_account` and `forget_saved_token`, and `GET` lists connections": `delphi_code/http_api/routes/hosting_services.py` 24–38.
    3. "`connect_account` requires a token and email if needed, verifies the token with the service, then saves it": `delphi_code/services/remote_repositories.py` 37–54.
    4. "`account_connections` reports each host's credential source and asks the service who the account is, recording any refusal as a problem": the same file, 133–146.
    5. "The account lookup runs in the child process via `_run_in_child_process`, so the server process stays offline": `delphi_code/infrastructure/hosts.py` 16–23.
    6. "`GitHub` checks the environment, then the saved keychain token, then `gh` and git credentials": the same file, 343–353.
    7. "`save_secret` writes the token to the macOS keychain through stdin, or `secret-tool` on Linux, then reads it back": `delphi_code/infrastructure/keychain.py` 27–41.
  - **Checks:** the first answer had two steps with both excerpts in one file; the retry still had one; that step's second excerpt was dropped. No excerpt outside its hunk, none on a proved hunk, no step out of call order, before or after. Excerpts 3 and 2 are 18 and 15 lines, over the 14 asked, kept as written.
  - **Ledger:** the steps show 81 changed lines; the ledger lists 1,227 in 21 files: the rest of the steps' files 386 in 5, tests 306 in 6, generated and mechanical 185 in 1, other files 350 in 9. 81 + 1,227 = 1,308, the PR's changed lines. Outside the steps: 3 risks, Bitbucket's credential order, its clone credentials and the keychain's JSON. Suggested depth: read step 7.
  - **Time and cost:** the steps pass started with risk and decisions, 5.7 s in, and its two calls took 7.3 and 6.6 s, done 19.6 s in, before findings (40.0 s), so it added no time to the run. Each call read 129,491 tokens from cache, wrote 1,092 and 1,185, and wrote 807 and 733 out: $0.025 each at API prices, $0.050 in all. The run took 40.0 s and $0.741 at API prices. The comparison is the stored run without the tour on the same commit and option (`a_3e251108fa689e6b`, 2026-11-21), which read no checkout: 34.5 s and $0.671. Of the $0.070 between them, the steps are $0.050 and the rest is the checkout's callers in the input (the intent wrote 131,045 tokens to cache against 128,299); the 5.5 s is the findings pass, 34.3 s against 29.6.
  - **How good the steps are.** They follow the PR from the setup page through the routes and the service down to the infrastructure, and none is a code name alone. Weak: (a) the tour runs two paths in one line, saving a token (1, 2, 3, then 7) and listing connections (4, 5, 6), so the keychain comes last, after GitHub's credential order, instead of after `connect_account` saves; (b) step 5's excerpt is imports and constants, 3 of its 8 lines changed, not the lines that run the lookup in the child process; (c) only GitHub's credential order is a step, Bitbucket's is a risk outside the steps; (d) the model gave two excerpts in one file to three steps and kept doing it after the retry, so the rule for two excerpts isn't followed; (e) four sentences start with a code name and read as a function's summary rather than what a caller notices; (f) two excerpts are over 14 lines.
  - **Found on the page:** with eight directories off the tour, the strip's column of them took the row and stacked the four on the tour one per line; and a box's click landed its step about 30 px short, as Open in code did, both fixed in fc35ada. The map's landing label sits over the part that holds the excerpt, which on step 6 starts 88 lines above it; the excerpt is in view below it, not under it. Screenshots: `.claude/tour-shots/` in this worktree.
- **The code's tour is now its flows.** `Tour`, `TourStep` and `TourStepId` are `Flows`, `Flow` and `FlowId`, `codeTour` is `codeFlows`, `validateTour` and `TourProblem` are `validateFlows` and `FlowsProblem`, and the analysis's `tour` is `flows`, so "tour" means only the page's tour of steps. Analyses stored with `tour` read it into `flows` on load, and `FlowId` keeps the `s1` format; `PIPELINE_VERSION` wasn't bumped. Left as they are, though nothing new uses them: a flow's `merged`, always empty since the tour pass went; its `codeTitle`, null on everything the code makes and read only by the overview for analyses the tour pass titled; `builtBy: "model"`, which only those analyses have; and its `explanation`, which `codeFlows` still writes ("Reads routes.py, service.py and store.py.") and no page reads. Removing them is a schema change of its own.
- **What was left of the old tour is gone.** A flow is its title, parts, kind and entries, and the analysis's `flows` is the array of them. The tour pass's fields went with nothing reading them: `explanation` (written by the code, read by nothing), `merged`, `builtBy`, each flow's `FlowId`, and `via`, which only the explanation used; `codeTitle` is read into `title` when an analysis the tour pass titled loads, so its overview keeps its entry labels. `validateFlows`, `FlowsProblem` and `partsOfHunks` went with their tests; codeFlows' tests check every part is placed once themselves. `fileOverview` reads the flows from the analysis, and a part no flow lists keeps its place after the flows' parts, in path order, which `flowSteps` used to add as a step nothing showed. The overview's rows, labels, entries, order and Through line are byte for byte what they were on the web fixtures and on delphi-code #2's stored analysis, and `overview-record.json` holds five fixtures to it. On an analysis the tour pass titled, the overview's hover now lists the code's flow titles instead of the model's.
- **The rebase onto `main`, 2026-11-22.** `main` had taken stage 63 for a check instead of a fix, so this stage is 64, in a seventeenth slice of its own. Where both sides changed the same code, both are kept:
  - The guardrail call's `following` and the steps stage live side by side. The guardrail call isn't a stage, so `inProgress` doesn't wait for it, and the steps stage is, so it does; a run started with the tour sets `steps` pending beside the four and `guardrails` null, and `recoverInterruptedAnalyses` fails a running guardrail call and a running steps pass each on its own.
  - `runModel` takes `main`'s guardrail advisor with the tour's flag in one `run` argument; the steps pass needs no change for the call, since the call reads only findings and risks.
  - `ModelCallName` is the four passes, `guardrails` and `steps`, so Run details and the usage line name both.
  - The fake server's wrappers chain `withTour` after `main`'s `withGuardrails`, and `receiptsChecked`'s model forwards `steps`.
  - `SuggestPreferencesRequest` was already `main`'s; this branch's copy went.
  - opencode's prompt version is `main`'s 10, with its four-pass fingerprint; the tour fingerprints of every transport were unchanged, since `main` didn't change the four passes' requests and opencode's tour fingerprint covers only the steps request.
  - `main`'s new overview tests used the overview's old helpers; they use `overviewOf` and `flowOf` now, in the cleanup's commit.
  - `main`'s overview labels a directory as the tree does, without a Java module's repeat of its name, and the strip takes the same labels. The strip cuts its muted parent line at its end and shows the last directory whole on a line of its own; the middle cut of `main`'s overview boxes (`shownLabel`) isn't applied to it, which a module path wider than a box would want.
  - `main`'s database is at schema 8; this branch adds no migration, so nothing was renumbered.
