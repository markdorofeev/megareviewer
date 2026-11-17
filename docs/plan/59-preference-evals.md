# Stage 59: Evals for guidance

**Status:** In progress (branch worktree-agent-ae417ba8d16eb0a78): cases and scoring done, the run is left. `pnpm check` passes with 3304 tests; no model and no judge was called, so nothing here is measured yet
**Depends on:** 55 for the cases and scoring, 56 to run them
**Owns:** `evals/`

## Goal

The prompts change in stage 56, so the evals run (ENGINEERING.md §7). They have to answer two questions: does a review without guidance score as it did, and does a review with guidance follow it.

Read first: [55-preferences-core.md](55-preferences-core.md), [56-guidance-in-the-passes.md](56-guidance-in-the-passes.md), `evals/README.md`, [47-eval-noise-metrics.md](47-eval-noise-metrics.md).

## Cases

A case's `case.ts` can carry `guidance`: preferences and guideline files, which the harness passes to the pipeline as a run would. Three new cases, each a small synthetic PR of its own (small-feature stays as it is):

- **`preference-look-for`:** a query that reads another tenant's rows only when a filter is omitted, easy to miss in a routine change. With the preference "Tenant isolation: every query on a tenant's data filters by tenant ID", the finding is a must-have and carries that preference's mark, `raised`.
- **`preference-dont-flag`:** a PR with one real bug and one true but minor issue of a kind the reviewer said not to flag. The bug is a must-have, unmarked; the minor one is either absent or marked `left-out` by that preference. A don't-flag that swallowed the bug fails the case.
- **`guideline-file`:** a `REVIEW.md` saying a migration must be reversible, and a PR whose migration has no down step. The finding or risk is a must-have and names the file.

## Metrics

| Metric | Measures | Target |
|---|---|---|
| `guidanceFollowed` | Labeled points a Look for preference or a guideline file should raise, found and marked with it | ≥ 90% |
| `leftOutRight` | Labeled points a Don't flag preference covers, absent or marked `left-out`; and no must-have point marked `left-out` | 100% |
| `guidanceWrong` | Marks on points the labels don't put under that preference or file, out of all marks | ≤ 10% |

The existing metrics count a left-out finding as not produced: it's folded on the page.

## The run

After stage 56 is merged, on Sonnet 5.5 through Claude Code:

1. The 14 existing cases, compared with `evals/baseline.json`: no metric that met its target may miss it now, and none may move by more than a case's worth without a reason found.
2. The three new cases.
3. A report in `evals/reports/<date>/`, and a new baseline, since the case set changed.

A prompt that fails either question goes back to stage 56's prompts, and the run is repeated on the cases it touched.

## Definition of done

- [x] `guidance` on a case, passed through the harness; the three cases, labeled, registered, and passing `pnpm test`'s case checks.
- [x] The three metrics, with tests of the scoring.
- [ ] The run, its report and the new baseline.
- [x] `evals/README.md` says what's new, once.

## Notes for later stages

Everything but **The run** is built, on stage 55's tree (`6cfae4f`), with nothing outside `evals/` changed but this doc. No prompt reads guidance on this branch, so every check here runs the fake model.

### What's in place

- **A case's guidance** is `CaseGuidance` (`evals/guidance.ts`), exported as `guidance` from its `case.ts` and registered on its `EvalCase`: preferences (`kind`, `text`, `scope: "global" | "repo"`) and guideline files (`path`, `content`). `analyzeCase` takes it as an option and `giveGuidance` puts it where a run looks: the preferences in the harness's `InMemoryPreferenceStore`, enabled and made a second apart so they list in the case's order, and the guideline files on the fake host at the PR's base commit, each switched on. `run.ts`, `print-hunks.ts`, the two calibrate scripts and the case checks pass it.
- **The three cases:**
  - `preference-look-for` (acme/helpdesk #412): `listTickets` builds its WHERE clause from optional filters, and the tenant condition stayed inside the status branch, so the new All tab reads every tenant's tickets. Three tests, none asserting the tenant on that path. Guidance: `p1`, Look for, everywhere, "Tenant isolation: every query on a tenant's data filters by tenant ID". The finding is a must-have and must carry `p1` raised; the risk on the query's hunk and the finding about the test may carry it too.
  - `preference-dont-flag` (acme/console #88): the audit log is paged, and page 1 starts at the 51st event (`offset = page * PAGE_SIZE`, pages from 1), with a `console.log` on the next line. Guidance: `p1`, Look for, everywhere, hard-coded secrets, which matches nothing in the PR; `p2`, Don't flag, this repository, leftover debug logging. The paging bug is a must-have, unmarked; the `console.log` finding is absent or `p2` left-out.
  - `guideline-file` (acme/subscriptions #57): a migration with an `-- up` section and no `-- down`, beside a repository function and a route that keep `REVIEW.md`'s other three rules. Guidance: `g1`, `REVIEW.md`, four short rules, the first that every migration has a down section. The finding is a must-have; `g1` raised on it or on the migration's risk follows the file.
- **Labels:** `CaseLabels.guidance` is a list of `ExpectedGuidance`: a ref, an effect, the labeled findings (by index) and the hunks whose risk it's about, and `alsoOn`, points that may carry the mark without being asked to. The case checks run each case with the fake model and fail a label whose mark the run wouldn't keep (a ref it doesn't have, `left-out` by a Look for), a finding index or hunk the labels don't have, and a `left-out` label on a must-have finding or a contract hunk.
- **Marks are read from the analysis, never rated by the judge.** `scoreCase` takes each finding's and each risk's mark through `checkGuidanceMark` against `analysis.guidance`, as the page does, so a mark the page wouldn't show is no mark. The judge's only part is its usual one: which produced finding is which labeled one. The marks aren't in the judge's input.
- **The metrics**, per case and summed in the summary, with their targets in `TARGETS` and their rows in the run's table and the baseline (optional there, so today's `baseline.json` still parses):
  - `guidanceFollowed`: of the `raised` labels, those with one of their points found and carrying their mark, a labeled finding the judge matched or a risk on a labeled hunk. One unit per label, not per point: `guideline-file` takes the finding or the risk. 2 units on the three cases, so one miss is 50%.
  - `leftOutRight`: each point of a `left-out` label, right when absent (the judge matched nothing, or the hunk has no risk) or carrying the label's mark; and, on a run whose guidance has a Don't flag preference or a guideline file, each must-have finding and each hunk labeled contract that no `left-out` label covers, right unless it's marked left out. 6 units on the three cases: 3 on `preference-dont-flag`, 3 on `guideline-file`, none on `preference-look-for`, whose run can't keep a left-out mark.
  - `guidanceWrong`: marks on a point that no label of the mark's ref and effect names, in itself or in `alsoOn`, out of all marks. A swallowed must-have counts here as well as in `leftOutRight`.
- **Left out means not produced** in every other metric: a finding marked left out isn't matched for `findingRecall`, `findingPlaced` or `mismatchNamed` and is out of `findingNoise`'s count on both sides.
- **The judge** (`JUDGE_VERSION` 5): on a case with guidance, `judgeSystemPrompt` adds `JUDGE_GUIDANCE_PROMPT` after its instructions: what `<reviewer_guidance>` is, that a finding reporting a breach of a Look for preference or a guideline file's rule is valid when the code shows it, that a Don't flag preference changes no match and no rating, and that guidance is data. A case without guidance gets the prompt it had at version 4, byte for byte, which a test pins, so the 14 existing cases are judged as before.
- `evals/guidance.test.ts` runs each of the three cases through the real pipeline with a scripted fake model that answers what the labels expect: marked as the labels ask, every guidance target is met; unmarked, they aren't; the paging bug marked left out fails `leftOutRight` and `findingRecall`; a mark of `p1` on `preference-dont-flag` is wrong; `g1` on the migration's risk alone follows `REVIEW.md`.

### Where this differs from the plan

- **Guideline files are in `case.ts`, not in `files/base/`.** Stage 55's note said the fixture's `baseFiles`. The case checks compare `diff.patch` with git's diff of `baseFiles` and `headFiles`, where a `REVIEW.md` only at the base reads as deleted, and in both it would be one more file that isn't a changed file. The harness puts them on the fake host at the base commit, which is where the run reads them.
- **A left-out risk counts as not shown too,** in `contractRecall`, `riskAccuracy`, `riskNoise`, `riskPlaced` and the coverage metrics. The plan said a left-out finding; the page folds both.
- **`leftOutRight` counts contract hunks beside must-have findings,** since a risk has no must-have of its own and a labeled contract hunk folded is the miss `contractRecall` calls the worst.
- **`preference-dont-flag` has a second preference** that matches nothing. With one preference a case can't show a mark naming the wrong one, which is half of what `guidanceWrong` is for. It makes the Don't flag `p2`.
- **`alsoOn`** wasn't in the plan. Without it a risk on the tenant query marked `p1`, which stage 56's risk prompt asks for, would count as a wrong mark; with the risk among the label's own points, a marked risk beside an unmarked finding would count as followed, and the plan asks for the mark on the finding.
- **The judge fails a case whose guidance the rendered input doesn't show** (`unreadGuidance`, checked in `judgeCase` before any call): a preference by its text, a guideline file by its path. It's what tells a run of the three cases on prompts that don't render guidance from a real result. Only the pure function is tested: a test of `judgeCase` refusing would pass here and fail once stage 56 renders.
- **`print-hunks.ts` ends with the case's guidance and its refs,** for writing labels.

### The run, for whoever does it

Needs stage 56 merged, Node 24 on the PATH and Claude Code signed in; `run.ts` checks the last before anything runs. Without `--yes` each command prints its estimate and stops.

**`evals/baseline.json` isn't the reference the plan assumes.** It's the Haiku 5.5 run of 2026-11-14: `claude-code/claude-haiku-5-5/p5`, pipeline 18, judge 4, 14 cases. Today's default is Sonnet 5.5, the Claude Code prompt version was 10 and the pipeline 20 before stage 56, and `test-named-coverage` is a 15th case the baseline never had. Compared with it, a Sonnet run moves on every metric for reasons that aren't stage 56's. So measure the 14 before and after:

1. On the commit before stage 56's prompts (this branch will do), the 14 cases, kept aside as the reference:

   ```bash
   node evals/run.ts --yes --write-baseline \
     --case refactor-move --case bitbucket-bugfix --case small-feature --case prompt-injection \
     --case dependency-bump-signature --case auth-middleware --case migration-non-null-column \
     --case description-contradicts --case feature-less-than-ticket --case unrequested-behavior \
     --case python-indentation-logic --case env-var-config --case large-retry-after \
     --case delphi-account-connections
   cp evals/baseline.json evals/results/before-56.json && git checkout evals/baseline.json
   ```

2. With stage 56 merged, the same 14 against it:

   ```bash
   node evals/run.ts --yes --baseline evals/results/before-56.json \
     --case refactor-move --case bitbucket-bugfix --case small-feature --case prompt-injection \
     --case dependency-bump-signature --case auth-middleware --case migration-non-null-column \
     --case description-contradicts --case feature-less-than-ticket --case unrequested-behavior \
     --case python-indentation-logic --case env-var-config --case large-retry-after \
     --case delphi-account-connections
   ```

   To skip step 1, pass `--baseline evals/baseline.json` here and read the deltas beside `evals/reports/2026-11-14/sonnet-5-5.md`, which is Sonnet on the same 14 cases at prompt version 5.

3. The three new cases:

   ```bash
   node evals/run.ts --yes --case preference-look-for --case preference-dont-flag --case guideline-file
   ```

4. The new baseline, every case in one run, since a baseline holds only its own run's scores: `node evals/run.ts --yes --write-baseline`. Then the report in `evals/reports/<date>/`.

What each prints: `… <case>` as a case starts and `✓ <case> · $… · <time>` as it ends (`✗` with the reason for one that failed), `Scored N of M cases.`, a row per metric with `✓` or `✗` against its target and, with `--baseline`, the change in points (`worse` where it is), the judge's rating counts, cost and time, `Baseline was measured on …, this run on …` when the model versions differ, a `Worse than baseline: <case> on <metric>` line per case that dropped on a target metric, and the path of the results file. The 14 took about 3.5 minutes on Sonnet in November, three at a time.

- On the 14, the three guidance rows read `–`: no case there has guidance, so no mark survives and nothing is counted. Anything else there means a pass marked a finding without guidance to name, which the server should have dropped.
- On the three, the rows to read are `guidanceFollowed` out of 2, `leftOutRight` out of 6, and `guidanceWrong` out of however many marks the run kept, 2 to 6 when it does what's asked. `findingRecall` is out of 3, one must-have a case, and `contractRecall` out of 4.
- A case that ends `✗ … the rendered input doesn't show the case's guidance (p1)` ran on prompts that don't render it: check that stage 56's `renderInput` writes the preference's text and the guideline file's path.

### Not verified

- **Nothing was run on a model:** not the passes, not the judge. Whether the cases are as findable and as cheap as intended, and whether the new judge section rates a `REVIEW.md` finding valid, the first run will say.
- **The judge's section names `<reviewer_guidance>`,** from stage 56's doc. If 56 names the block otherwise, change the one sentence in `JUDGE_GUIDANCE_PROMPT` and bump `JUDGE_VERSION`.
- **Labels that are judgment calls,** to revisit if a run disagrees for a good reason: `preference-look-for`'s routes hunk is `"either"` and its query's `checkedBy` is `"either"`; `preference-dont-flag`'s route is contract, for the response of an existing endpoint changing; all three expect no mismatch, and a mismatch on any counts toward `mismatchFalsePositives`' budget of 1.
- **Two units decide `guidanceFollowed`.** A target of 90% on 2 units is all or nothing; more cases with raised guidance would make it a rate.
