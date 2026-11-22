# Stage 63: A tour of the PR, behind a switch

**Status:** In progress
**Depends on:** 27, 45, 50, 56, 61
**Owns:** `src/domain/review/stop.ts`, the stops pass in `src/adapters/model/`, `runStops` in `src/application/use-cases/`, `stops` on the analysis and in `contracts/`, the Understand layout in `web/src/pages/review/`, the switches of the Display menu in `web/src/lib/page-display.tsx` and `web/src/app/Header.tsx`, the tour's examples in `web/src/design-system/`, its pairs in `scripts/check-contrast.mjs`, `e2e/tour.spec.ts`, the stops' scoring in `evals/`, and the tour's paragraphs in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md

## Goal

In about two minutes a reviewer understands what a PR does and how, and sees whether anything is fundamentally wrong, without reading the files. Then they approve from the bar or go to the code. The tour is optional twice over: it's behind a switch in the Display menu, off by default, and with the switch on the page still opens on the code.

The tour is the second layout. With the switch on, Overview is named Understand: a strip of the changed directories with the tour's path lit, then the **stops**, then what the tour didn't show. A stop is one sentence and the few lines that decide, real diff lines the reviewer can comment on. The model writes the stops in a fifth pass; everything else on the page is the code's.

Read first: DESIGN.md's decisions on files read whole, on each kind of point, and on the model being optional; ARCHITECTURE.md's Model passes and Review page; ENGINEERING.md's UI rules. The design is `/Users/markdorofeev/Downloads/hunk-tour`: `IMPLEMENTATION.md`, `reference/`, `prototype/` and `shots/`. Where this doc and the design differ, this doc wins. `git show ad4e956` removed the last tour pass and is a map of every file a pass touches.

## The switch

- Display menu, under Decisions: **Tour (preview)**, a checkbox, kept per browser, off by default. `PageDisplay.toggle` becomes a list of switches.
- **Off:** the page, its requests and the model's requests are what they are today, byte for byte. A test holds the four passes' request to its hash from before, as the guidance test holds the prompt's.
- **On:** the layout's second option reads Understand; the stored value stays `overview`. Request AI review, Re-run and Try again ask for the tour with the run (`RunModelRequest.tour`).

## Not taken from the design

| Design | Here | Why |
|---|---|---|
| Not in the tour lists files without a stop | The ledger counts changed lines, and its first group is the rest of the stops' files | Stop 4 shows 8 of `keychain.py`'s 164 added lines; the other 156 were in no list |
| Without a tour, a flat row of boxes that can't be clicked | Today's Overview, unchanged, with one line under the bar's row saying why there's no tour | The page has to be as good without the model as it is today |
| "4 of 8 directories read", Read / Reading / Waiting per box | Today's Overview and "The tour is being written", `role="status"` | The passes read the whole PR at once; only passes done is known |
| A Display button in a 40 px row under the bar, on both layouts | Display stays in the header. The row shows in the Map only after arriving from the tour, as the bar's second row, with Back to tour and a button to dismiss it | An empty row costs a line of code on every screen |
| Esc in the tour leaves for the code | Esc keeps today's direction: in the Map it goes back to the stop the Map was opened from | Both together bounce between the layouts |
| The stops list is the only scroller; the header and the diagram collapse after 30 px | The window scrolls. The strip is sticky under the bar, full at the top and compact once stuck | The bar, the cards' headers and `scroll-padding-top` all rest on the window scrolling |
| The model returns boxes, the path, the ledger, the points' texts and the suggested depth | The model returns only stops. Boxes are the Overview's directories, the ledger is counted from the diff, the chips are the analysis's points, and the depth is a rule | Each of them is known to the code, and a second wording of a finding is one more thing to be wrong |
| 1 to 3 points on every stop | The points whose lines an excerpt shows, which can be none | Points aren't written for stops |
| Landing lines tinted | Landing lines marked on their numbers with a primary rail, as a finding's are in red | A tint under code needs a contrast pair for every syntax color |
| `--tour-*` tokens, `--code-font` | The existing utilities; no aliases | They'd be names for tokens we have |
| A tour out of date after new commits | Nothing | An analysis is one head commit's |
| Code / Understand | Map / Understand | Map is the page's word everywhere else |

## The stop

A new term, added to ENGINEERING.md first: **Stop**, a place on the page's tour, one sentence and the lines of one or two hunks that decide, in call order; the model writes it and the server checks it. The code's `Tour` and its steps keep their names and their job, ordering and labelling the Overview.

```ts
// src/domain/review/stop.ts
StopId        // "t1", "t2", … in tour order
Stop          { id, sentence, excerpts: PointLines[] }   // 1 or 2 excerpts
Analysis.stops: Stop[] | null                            // null: no run asked for the tour
```

An excerpt is `PointLines`, either side, so a stop can show a removed check.

### The pass

- Named `stops`, as a pass and as a stage. `tour` is taken: stored analyses from the old tour pass have that name stripped on load.
- It reads only the PR, from the prompt cache, and starts with risk and decisions. Medium effort.
- A run that asks for the tour sends every pass the five-variant union, so they share one cache; a run that doesn't sends today's four. **Check first** that Claude Code and the API accept the five-variant union. ARCHITECTURE.md says the union is near what a provider's grammar takes. If one refuses it, stop and record what it said in the notes.
- It's optional to the run: the review's four stages decide `modelRunnable`, `inProgress` and the run's error as today. A stops pass that fails is its stage's `failed`, a model call in Run details and the reason on the Understand page, never `modelError`. The bar counts "of 5" only when the tour was asked for.
- Remove AI review clears `stops`.

### What the task asks for

- Follow the change the way a request or a user action runs through it, from where it's reached to what it ends in, callers before callees.
- 3 to 7 stops. Fewer than 3 real hops: answer with none. More: merge neighbors.
- A sentence of at most 20 words, present tense, behavior a caller notices, code names in backticks, no period.
- One excerpt, 4 to 14 lines, the lines that decide. Two only when one hop crosses into another process, such as a client call and its route.
- No stop on a test, a generated file or docs. Nothing that looks wrong, and no risk: those are other passes'.
- The system prompt's rules on PR content and guidance stand; the task says nothing more about guidance.

### What the server checks

`validateStops` in the domain, pure, with adversarial tests:

1. Each excerpt's hunk exists, has no mechanical proof, and shows its lines on its side.
2. A stop's two excerpts are in different files.
3. No stop comes before a stop whose code calls its own, by the call graph's direct hints between their parts.
4. At most 7 stops.

A problem is told to one retry. After it: a bad excerpt is dropped, a stop with none left is dropped, stops past the seventh are dropped and logged, an order still wrong is kept and logged, and fewer than 3 stops left is no tour, with why. An excerpt longer than asked is kept as written and never retried.

## The page

`tourOf()` in `web/src/pages/review/tour.ts` is the pure function from the analysis, the Overview and the points to everything Understand draws. Its tests hold the ledger's invariant: the changed lines the stops show plus the ledger's lines are the PR's changed lines.

### Entry

- The brief's status line ends with "Tour · 5 stops", a link, once a run has stops and the switch is on.
- The Display menu's layout, and `v`.

### Understand, with a tour

- **Strip.** One box per directory the stops reach, in the order they first reach it, by the Overview's own grouping and labels; the other directories after a divider, dashed, "No stop". A box on the tour has its stops' numbers; the current stop's box has the stronger border, the filled number and "Current stop". Two neighboring boxes one stop spans sit in a dashed group. A click on a lit box goes to its lowest stop; on a no-stop box, to its group in the ledger. Sticky under the bar; compact once stuck and at less than 1180 px.
- **Stops.** Number, sentence, chips, one card per excerpt. The current stop is the last whose top has passed the strip.
- **Chips** are the analysis's points whose lines overlap an excerpt: finding, risk, then decision, each with its glyph and its word, as text. A click opens the point's card in the Map. Decisions show here with the Decisions switch off: the tour is where a choice is accepted. A dismissed point is struck through; one a preference left out isn't shown.
- **Card.** The file, "lines 28–35 · 8 of 164 changed lines", Open in code, then the excerpt's rows drawn by the diff view a part uses, with its comment box and the reviewer's drafts. No point cards inside it.
- **After the tour.**
  - *Not in the tour*, a group each, empty ones left out: the rest of the stops' files, tests, generated and proved mechanical, other files. A file's row has its lines not shown and opens it in the Map.
  - *Findings and risks outside the stops*, each opening its card in the Map. Never decisions.
  - *Suggested depth*, from a rule: the stops with an open finding or a risk no test checks are the ones to read in the code, and it says how many findings and risks are outside the stops. With none of either, it says so.

### Understand, without a tour

Today's Overview, and one line saying why: no AI review yet, the review ran without the tour ("Re-run to get it"), the tour is being written, the change is too small for one, or the pass's error.

### Between the layouts

- **Open in code** opens the Map on the excerpt's lines, marked on their numbers, under a label, "Tour stop 3 · A token is verified against the host before saving". The bar gets its second row, "← Back to tour · Stop 3".
- **Back to tour**, and Esc in the Map, return to that stop. `v` from the Map lands on the stop last current, kept per analysis in `sessionStorage`; from Understand it lands on the current stop's lines.
- The stepper's points and threads open the Map from Understand, as from the Overview today.
- Drafts and point states are the analysis's, so both layouts show the same ones.

### Not in this stage

- Today's layered diagram while a tour is shown. With the switch on and a tour, it's reached by turning the switch off.
- Dismiss and Add to review on a chip.
- A stop's own keys.

## Work

Each part is one commit that passes `pnpm check`.

1. **Domain.** `Stop`, `validateStops`, `stops` on the analysis with its default, the `stops` stage and pass with their defaults for stored analyses, and the helpers that must not count it as one of the review's four. The term in ENGINEERING.md.
2. **Pass.** The union's fifth variant, used only by a run that asks; the task prompt; `stops()` on `AnalysisModel`, its contract suite and fake; every transport and its fixtures; `RunModelRequest.tour`; `runStops` in the run with its retry, and Remove AI review. The hash test for a run without the tour.
3. **Switch.** The Display menu's list of switches, "Tour (preview)", and the run's request carrying it. Nothing else changes on the page yet.
4. **Understand.** `tourOf()` with tests, the strip, the stops, the cards, After the tour, and the line for each state without a tour.
5. **Between the layouts.** The brief's link, Open in code and its landing, the bar's second row, Esc, `v`, the remembered stop.
6. **Checks and examples.** The fake server's PR with stops, added as a variant and not by changing `small-feature`; `e2e/tour.spec.ts`; the design system's examples and baselines; the contrast pairs for the lit box, the current pill and the three chips.
7. **Docs.** DESIGN.md's decision, with the alternatives this slice rejected: a third layout, a spotlight over the Map, the tour as the first screen, and the rows of the table above. ARCHITECTURE.md's pass, its checks and the Understand layout. This doc's notes.
8. **Live check and evals.** Both spend the reviewer's plan, so ask before running either. One run on delphi-code #2 with the tour: the stops, their order, the ledger's invariant, the time and cost against a run without. Then the evals with the tour off, to show nothing moved, and structural scores for the stops: cases with a valid tour first time, stops out of call order, excerpts over 14 lines.

## Done when

- `pnpm check` passes, and the e2e and design-system specs with their baselines.
- With the switch off, the review page's e2e specs pass unchanged and the four passes' request has the hash it had.
- With it on, on the fake server's PR, in light and dark: the brief's link opens the tour; a box goes to its stop; a comment added on a stop's line is in the Map and in Publish; Open in code lands on the lines and Esc comes back to the stop; the ledger's lines and the stops' add up to the PR's.
- Understand without a tour is today's Overview, for each of its five reasons.

## Notes for later stages

- **The union check (part 2), 2026-11-22.** Claude Code 2.1.303 on Haiku 5.5 took the five-variant schema with `--json-schema` and answered `{"answer":{"pass":"stops","stops":[]}}`. The Anthropic API refused it with 400 `invalid_request_error`: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." It refuses today's four-variant schema the same way, on Haiku 5.5 and Sonnet 5.5, and so it refuses the real `passRequest` for the intent pass on small-feature without the tour (4,437 bytes of schema; the five are 5,003). So the API transport can't run any pass now, with or without the tour, and the stops variant isn't what broke it. `evals/union-check.ts` repeats the check.
- **Where the build differs from this doc, and why.**
  - The stops stage keeps the analysis in progress while it runs (`inProgress`), unlike "the review's four decide `inProgress`". Without it the page's event stream ended when the four did and missed the tour, and a server stopped mid-tour would leave the stage running forever. The four still decide `modelRunnable` and the run's error; `recoverInterruptedAnalyses` fails only the tour, as `stopsError`, when only the stops pass was running.
  - `ModelPass` gained `stops` in part 2, not part 1: the pass-keyed tables in the adapters (efforts, prompts, the fake's scripts) would otherwise have needed a placeholder task.
  - Part 2 is one commit, as the doc's parts are, though it holds the port's contract change (`AnalysisModel.stops`, `PassOptions.tour`, `RunModelRequest.tour`) with the transports that use it: they don't compile apart.
  - The model versions weren't bumped. A run without the tour sends what it did, which the existing fingerprints hold; each transport has a second fingerprint for a run with the tour (`*_TOUR_FINGERPRINT`). The model version isn't in the analysis cache key, so a bump would only relabel runs.
  - An excerpt's rows run from the first row of its side's first line to the last of its last line, so the other side's lines between them show too; its "changed lines" count both. A row two stops show counts once, which is what makes the ledger add up.
  - The ledger's groups are four: the rest of the stops' files, tests, generated and mechanical as one group, and other files. A file no stop touches is listed even with no lines (a rename, a binary file), so nothing in the PR is missing from Understand.
  - A decision's chip opens its lines in the map while the Decisions switch is off, since the map has no card for it then; turning the switch on for the reviewer was the alternative.
  - The landing label sits under the header of the part that holds the excerpt's first row, which can start a few lines above the excerpt; the marks are on the excerpt's lines themselves.
  - `SuggestPreferencesRequest` was `RunModelRequest`; it has its own schema now, so the suggestion call doesn't take `tour`.
  - The mock API (`pnpm dev:web:mock`) answers a run that asks for the tour with `fixtureStops`, and the design system has a Tour section of its own, with baselines, built from them.
- **Not done here.** Part 8, the live run on delphi-code #2 and the evals with the tour off and on, spends the reviewer's plan and waits for their go-ahead. `evals/` doesn't score stops yet: the structural scores (valid tour first time, stops out of call order, excerpts over 14 lines) belong with that run.
- **Found on the way, outside this stage.** `e2e/review.spec.ts`'s "publishes exactly what the preview shows" waits for a "Published" status the bar no longer shows since 2e35f4f made it say the reviewer's verdict; the spec wasn't updated with it, and the test fails on this branch for that reason, not the tour. The Anthropic API's grammar limit above breaks every pass on that transport.
