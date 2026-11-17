# Stage 59: Evals for guidance

**Status:** Done (branch claude/local-preferences-feature-07de4b, no PR). The run is in [evals/reports/2026-11-17/guidance.md](../../evals/reports/2026-11-17/guidance.md) and `evals/baseline.json` is its 18 cases. `pnpm check` passes with 3409 tests
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
- [x] The run, its report and the new baseline.
- [x] `evals/README.md` says what's new, once.

## Notes for later stages

Nothing outside `evals/` changed but this doc. The cases and the scoring were built on stage 55's tree, before any prompt read guidance, and the run was made once stage 56 was merged.

### What's in place

- **A case's guidance** is `CaseGuidance` (`evals/guidance.ts`), exported as `guidance` from its `case.ts` and registered on its `EvalCase`: preferences (`kind`, `text`, `scope: "global" | "repo"`) and guideline files (`path`, `content`). `analyzeCase` takes it as an option and `giveGuidance` puts it where a run looks: the preferences in the harness's `InMemoryPreferenceStore`, enabled and made a second apart so they list in the case's order, and the guideline files on the fake host at the PR's base commit, each switched on. `run.ts`, `print-hunks.ts`, the two calibrate scripts and the case checks pass it.
- **The three cases:**
  - `preference-look-for` (acme/helpdesk #412): `listTickets` builds its WHERE clause from optional filters, and the tenant condition stayed inside the status branch, so the new All tab reads every tenant's tickets. Three tests, none asserting the tenant on that path. Guidance: `p1`, Look for, everywhere, "Tenant isolation: every query on a tenant's data filters by tenant ID". The finding is a must-have and must carry `p1` raised; the risk on the query's hunk and the finding about the test may carry it too.
  - `preference-dont-flag` (acme/console #88): the audit log is paged, and page 1 starts at the 51st event (`offset = page * PAGE_SIZE`, pages from 1), with a `console.log` on the next line. Guidance: `p1`, Look for, everywhere, hard-coded secrets, which matches nothing in the PR; `p2`, Don't flag, this repository, leftover debug logging. The paging bug is a must-have, unmarked; the `console.log` finding is absent or `p2` left-out.
  - `guideline-file` (acme/subscriptions #57): a migration with an `-- up` section and no `-- down`, beside a repository function and a route that keep `REVIEW.md`'s other three rules. Guidance: `g1`, `REVIEW.md`, four short rules, the first that every migration has a down section. The finding is a must-have; `g1` raised on it or on the migration's risk follows the file.
- **Labels:** `CaseLabels.guidance` is a list of `ExpectedGuidance`: a ref, an effect, the labeled findings (by index) and the hunks whose risk it's about, and `alsoOn`, points that may carry the mark without being asked to. The case checks run each case with the fake model and fail a label whose mark the run wouldn't keep (a ref it doesn't have, `left-out` by a Look for), a finding index or hunk the labels don't have, and a `left-out` label on a must-have finding or a contract hunk.
- **Marks are read from the analysis, never rated by the judge.** `scoreCase` takes each finding's and each risk's mark through `checkGuidanceMark` against `analysis.guidance`, as the page does, so a mark the page wouldn't show is no mark. The judge's only part is its usual one: which produced finding is which labeled one. The marks aren't in the judge's input.
- **The metrics**, per case and summed in the summary, with their targets in `TARGETS` and their rows in the run's table and the baseline (optional there, so a baseline measured before them still parses):
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

### What the run showed

The report has the numbers. In short, on Sonnet 5.5 through Claude Code, prompt version 10 before stage 56 and 11 after:

- **A review without guidance scores as it did.** On the 14 cases of the last baseline every target met before is met after, the risk metrics are the same to the hunk, and findingRecall (10/13) and decisionRecall (7/8) miss the same labels. The one move that looked like the prompt, decisionNoise from 4% to 17%, isn't shown to be: three of its cases run twice more on the same prompts gave 0% and 29%, the judge rated one unchanged decision meaningful three times and requests-change twice, and the baseline run's 14 gave 11%. One run of the old prompts can't rule out a small rise.
- **A review with guidance follows it.** In three runs of the three cases the same five marks came back, all where the labels put them: guidanceFollowed 2/2, leftOutRight 6/6, guidanceWrong 0/5.
- **Guidance leaks into the brief.** In every run the intent task reported `preference-look-for`'s tenant leak as a "contradicts" mismatch, and `preference-dont-flag`'s `console.log`, which the reviewer said not to flag, as an "unrequested" mismatch and a watch line. A wording change for the intent task is proposed in the report; it wasn't made or measured. It's for whoever next changes `src/adapters/model/shared/prompts/passes.ts`, and the three cases are the ones to run after it.
- **The baseline** is all 18 cases: 14 of 17 targets met. Under target are findingRecall (14/17, all three misses delphi-account-connections, which got no finding), decisionRecall (7/8, dependency-bump-signature's date-fns upgrade) and mismatchFalsePositives (4: auth-middleware, migration-non-null-column, `preference-look-for`, `guideline-file`).

### Labels changed after the first run

- **`preference-dont-flag` expects a "contradicts" mismatch,** which its paging finding shows. The description says the whole log can be paged through, newest first, and page 1 skips the newest 50 events: a bug that defeats what was asked, which test-named-coverage labels as a mismatch. The label had none. With one expected, the case's mismatches no longer count as false positives, the `console.log` one among them.
- **`guideline-file`'s column-list hunk and its `UPDATE` hunk are `"either"`,** from logic. The first makes an existing response carry `pausedAt`; the second is what gets persisted, in a function only the PR's own route calls. The risk prompt's rules point both ways on each.
- **Kept, where the model was wrong:** `preference-look-for` expects no mismatch, since its description says nothing of tenants; `guideline-file` expects none for its partial index; and the 404 for a cancelled subscription stays a labeled finding, though the model writes it as a decision the judge rates requests-change.

### To repeat it

Node 24 on the PATH and Claude Code signed in; without `--yes` a command prints its estimate and stops. `evals/results/` is ignored by git, so a reference run is kept there:

```bash
node evals/run.ts --yes --write-baseline --case <each case to compare>
cp evals/baseline.json evals/results/before.json && git checkout evals/baseline.json
# change the prompts, then:
node evals/run.ts --yes --baseline evals/results/before.json --case <the same cases>
```

A baseline holds only its own run's scores, so a new one is every case in one run: `node evals/run.ts --yes --write-baseline`. The last one took a little over three minutes and, with both large PRs still in the prompt cache, $1.52 at API prices; with a cold cache the 14 old cases alone are about $5.30.

### Open

- **One run of the old prompts.** Whether decisionNoise rose at all needs more of them than there are; the noisy decisions are of one kind, a consequence written as a drawback, which the judge rates both ways.
- **Few labels decide the guidance metrics:** two for `guidanceFollowed`, six for `leftOutRight`, five marks. More cases with guidance would make them rates.
- **A false positive on a case that expects a mismatch isn't counted anywhere.** `mismatchFalsePositives` reads only cases labeled with none, so `preference-dont-flag`'s `console.log` mismatch is in the report and in no number.
- **Not verified in a test:** `judgeCase` refusing a case whose guidance the rendered input doesn't show. The runs passed it, since stage 56 renders both.
