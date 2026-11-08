# Stage 31: Flows as the model's tour

**Status:** Done (on main, no PR), with the evals left open (see **Open issues**)
**Depends on:** 28 (the flows the model gets are built from parts)
**Unblocks:** —
**Owns:** `src/adapters/claude/` (the tour pass's prompt and output schema), `src/application/use-cases/model-passes.ts` (`runTour`), `src/domain/review/validation.ts` (the tour's check), `evals/` (tour scoring), the tour pass rows of ARCHITECTURE.md "3. Model passes"

## Goal

With `--ai`, the model writes its own tour from scratch, and the flows the code builds are used only when its tour fails validation twice. So the reviewer who pays for the model gets a tour that can't follow the call graph as closely, and one that differs from the tour without the model.

After this stage the code's tour is the tour in both modes. The model's pass gets it as a skeleton and only writes:

- **a title and an explanation per step,** in plain language: "Save a host's token" instead of `PUT /api/account-connections/{domain}/token`;
- **merges of supporting steps,** such as docs into the flow they document, each with a reason.

It can't move a part between flows, drop one or add a step. Coverage holds by construction, so the pass can't fail validation on coverage any more, and the call-graph fallback becomes a fallback for titles only.

## Why, measured

- No analysis of delphi-code #2 with the model is cached: the two in `~/.megareviewer/db.sqlite` are pipeline versions `2+no-model` and `3+no-model`. The first task records one, at today's pipeline, as the baseline (a few cents at Haiku 5.5's prices).
- Without the model, the flows are the deterministic part reviewers can check: on delphi-code #2 after stage 28, each route is its own step and the DELETE flow is one chain through five files. A tour the model writes freely gives that up for prose.
- ARCHITECTURE.md caps the model's tour at 7 steps because a 12-step tour with steps for tests, generated files and docs was noisy. Flows already attach tests, generated types and docs to the code they belong to, so the noise the cap fought isn't there. Delphi-code #2 has 8 steps after stage 28.

## Read first

- [DESIGN.md](../../DESIGN.md) "Decisions", the model being optional
- [ARCHITECTURE.md](../../ARCHITECTURE.md) "3. Model passes", the shared prompt prefix and why every pass sends the same output schema
- [Stage 16](16-evals.md) and `evals/README.md`, for how a tour is scored
- `src/application/use-cases/model-passes.ts` (`runTour`), `src/adapters/claude/prompts/`, `output-schema.ts`, `render-input.ts`

## Contract change

A separate commit, with a line in stage 02's **Change log**:

- **`TourStepDraft` becomes `{ stepId, title, explanation }`,** keyed by the skeleton's step IDs, and the tour output gains `merges: { stepId, intoStepId, reason }[]`, for supporting steps only.
- **The tour pass's input** gains the skeleton: each step's kind, entries, parts (by hunk ID and lines) and `via`.
- `PIPELINE_VERSION` goes from 10 to 11, and the model's prompt version changes. Every pass shares one output schema, so the change invalidates the prompt cache once.

## Tasks

1. **Baseline.** Before any change, run `--ai` on delphi-code #2 and on the eval cases, and record for each: steps, the largest step's share of hunks, whether each route of delphi-code #2 has its own step, fallbacks used, and the tour pass's tokens and cost.
2. **Skeleton first.** The pipeline builds the code's tour in prep, with or without the model.
3. **The pass.** It gets the skeleton after the shared PR context and returns titles, explanations and merges. The prompt says what a flow is, that titles name behavior and not code, and that a merge needs a reason.
4. **Validation:**
   - every skeleton step has exactly one title;
   - a merge names a supporting step and an existing target, and no step is merged twice;
   - titles and explanations are text, at most 80 and 300 characters.

   On failure the pass retries once. On a second failure the skeleton's own titles stay, and a warning says so.
5. **The page** shows the model's title, with the flow's entry label under it ("Save a host's token · PUT /api/account-connections/{domain}/token"), so the reader can check one against the other.
6. **Evals.** The tour score measures titles (judged against the steps' code) and merges, not grouping, which the code now owns. The golden labels for tour grouping move to the code tour's tests.
7. **Docs.** ARCHITECTURE.md "3. Model passes": the tour row, why the model no longer groups (the measurements from task 1), and that the 7-step cap is gone with the reason. DESIGN.md's "The model is optional" says the model's tour annotates the code's.

## Not in this stage

- **Moving parts between steps.** If the evals show the code's grouping is wrong where the model would be right, a later stage can let the model propose moves the code checks.
- **Ordering flows.** The code's order (contract first) stays.
- **Model titles without `--ai`.** Without the model, titles stay the entry labels.

## Tests

- Validation: a missing title, a title for an unknown step, a merge of a flow, a merge into an unknown step, a step merged twice, an overlong title.
- `runTour`: a valid answer, a retry, the fallback to the skeleton's titles with its warning.
- The Claude adapter's contract suite, with a recorded response for the new schema.
- The page: the model's title with the entry label under it.
- Evals: the tour scorer on a case with a known good and a known bad title.

## Definition of done

- [x] Baseline recorded in this doc's **Notes for later stages**, before the first change.
- [x] Contract change commit, with the stage 02 change log line.
- [x] Tasks above, with the tests, except task 6 (evals).
- [ ] Evals run before and after; the summary is in the PR description, and no non-tour score drops. Run before only.
- [x] On delphi-code #2 with `--ai`, the steps are the code's, each route has its own step, and the titles read as behavior. The cost of the tour pass is written next to the baseline's.
- [x] ARCHITECTURE.md and DESIGN.md updated as in task 7.

## Open issues

- **Evals (task 6) not done, at the user's request.** The tour score still counts only fallbacks and first-try validity: nothing judges titles or merges yet, and the "after" run wasn't made. When it's picked up, the judge rates each step's title against its code and each merge against the step it joins, and the run compares with the baseline below. There were no golden labels for tour grouping to move into the code tour's tests: `evals/labels.ts` labels risk, decisions and mismatches only.
- **The GET flow on delphi-code #2 holds 32 of 48 hunks** in the code's tour, 33 with the docs the model merged into it: listing the connections reads most of the hosts and services code, and the PUT and DELETE flows pass through it. The model's own tour had a largest step of 20 (42%), by layer. Splitting a large flow is the code's job now; "Moving parts between steps" below is the model's way, if the code can't.

## Notes for later stages

**After** (analysis `a_77da97f157d587fc`, pipeline `11+claude-haiku-5-5/p3+checkout`): the steps are the code's 8, with Docs merged into the first ("The layer table documents the account connection types and keychain module that the first flow introduces"), so 7. Each route has its own step, titled "Show which Bitbucket and GitHub accounts are connected", "Verify and save a pasted token" and "Forget a saved token", with the route under each. The page is "Setup page section for account connections" and the hosts' command "Account lookups and saved tokens in the network child process". Valid on the first try. The tour pass read 6,126 input and 128,561 cached tokens and wrote 736: $0.011, against $0.016 before. The largest step holds 33 of 48 hunks (69%; see **Open issues**).

Where the code differs from this doc:

- **The contract change came with the pass.** `TourDraft` changed shape, so `runTour` and the adapter couldn't compile against the old one: the first commit added `TourStep.codeTitle` and `merged` alone, and the second changed the port with the pass, the prompt and the pipeline. Both are in stage 02's change log.
- **`TourStep` gained two fields** the doc didn't name: `codeTitle`, so the page can show the code's title under the model's, and `merged` (`{ title, reason }[]`), so the reason for a merge reaches the reader. A merged step's parts go to the end of the step it joins, and the parts are joined back after merging, so a hunk split between a flow and docs merged into it reads whole again.
- **The skeleton is built in prep** with the rules' risk, and saved with the prep stage, so the page shows the code's tour while the model passes run. The model's risk doesn't reorder it.
- **The tour pass still gets risk and decisions,** which help it name what matters in a step. The skeleton goes after them, inside the pass's own message, so the cached PR prefix didn't change.
- **Validation** also rejects a blank title or explanation, a merge without a reason, and a merge into a step that is merged itself. The model writes step IDs as plain strings, checked against the tour, so a wrong ID is feedback for the retry instead of a parse failure.
- **The Claude adapter's fixture is still synthetic,** with the tour answer rewritten for the new schema; the live check (`evals/claude-live-check.ts`) passes the code's tour and can record real responses.
- **Outside the stage's paths:** the page (`MapLayout`, `RiskRail`, `palette`, `overview`, the dev fixtures), the CLI's startup line ("the tour's titles come from Claude"), and README.md's line on `--ai`. The overview read pages' and commands' entries from `step.title`; it reads `codeTitle` first now.

**Baseline, before any change** (2026-11-08, pipeline 10, `claude-haiku-5-5/p2`):

- **delphi-code #2 with `--ai`** (analysis `a_ae5c79d7da81ad64`, with the checkout): the model's tour has 5 steps, by layer rather than by flow: the setup page, "HTTP endpoints for listing, saving and forgetting tokens", the services, the hosts and the keychain. The three routes share one step. The largest step holds 20 of 48 hunks (42%). No tour fallback; the risk pass left 7 hunks unclassified. The tour pass read 3,402 input and 128,412 cached tokens and wrote 3,145: $0.016 of the analysis's $0.135. The code's tour has 8 steps, one per route.
- **Evals** (13 cases, `evals/results/2026-11-08T09-34-35.462Z.json`): contractRecall 100% (19/19), riskAccuracy 85% (28/33), mustHaveRecall 100% (18/18), decisionNoise 3% (2/63), mismatchRecall 88% (7/8), mismatchFalsePositives 0, injectionResistance 0% (0/1), firstTryValid 92% (12/13, a risk retry), fallbacksUsed 0/13. Every tour pass was valid on the first try. Steps per case: 0 to 3; the largest step holds at most 3 hunks except on large-retry-after (25 of 52 in one of 3 steps). The tour passes cost $0.028 in all, $0.023 of it on large-retry-after; the run cost $0.20 model and $0.20 judge.
