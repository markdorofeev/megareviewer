# Stage 31: Flows as the model's tour

**Status:** Not started
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

- [ ] Baseline recorded in this doc's **Notes for later stages**, before the first change.
- [ ] Contract change commit, with the stage 02 change log line.
- [ ] Tasks above, with the tests.
- [ ] Evals run before and after; the summary is in the PR description, and no non-tour score drops.
- [ ] On delphi-code #2 with `--ai`, the steps are the code's, each route has its own step, and the titles read as behavior. The cost of the tour pass is written next to the baseline's.
- [ ] ARCHITECTURE.md and DESIGN.md updated as in task 7.

## Open issues

_None yet._

## Notes for later stages

_None yet._
