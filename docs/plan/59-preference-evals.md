# Stage 59: Evals for guidance

**Status:** Not started
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

- [ ] `guidance` on a case, passed through the harness; the three cases, labeled, registered, and passing `pnpm test`'s case checks.
- [ ] The three metrics, with tests of the scoring.
- [ ] The run, its report and the new baseline.
- [ ] `evals/README.md` says what's new, once.

## Notes for later stages

