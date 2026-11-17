# Eval run, 2026-11-17: the passes read the reviewer's guidance

Stage 56 gave the system prompt a section on guidance and each pass a sentence on what to do with it (`claude-code/claude-sonnet-5-5/p10` → `p11`). These runs ask whether a review without guidance scores as it did, and whether a review with guidance follows it. All on Sonnet 5.5 through Claude Code, pipeline 20, judged by `claude-opus-5-5` on Claude Code, `JUDGE_VERSION` 5.

| Run | Cases | Prompts | Results file |
|---|---|---|---|
| Before | The 14 of the last baseline | p10 | `2026-11-17T08-07-46.719Z` |
| After | The same 14 | p11 | `2026-11-17T16-14-26.759Z` |
| New cases, first | The 3 with guidance, labels as first written | p11 | `2026-11-17T16-17-20.398Z` |
| Repeat 1 and 2 | small-feature, feature-less-than-ticket, env-var-config | p11 | `2026-11-17T16-21-47.227Z`, `2026-11-17T16-22-16.555Z` |
| New cases, again | The 3, after the label changes below | p11 | `2026-11-17T16-24-59.287Z` |
| Baseline | All 18 | p11 | `2026-11-17T16-26-01.819Z`, which is `evals/baseline.json` |

Every case scored in every run, and no pass needed a retry but delphi's findings in the before run.

## Without guidance: the 14 cases

| Metric | Before, p10 | After, p11 | Baseline run, p11 | Target |
|---|---|---|---|---|
| contractRecall | ✓ 96% (24/25) | ✓ 96% (24/25) | ✓ 96% (24/25) | ≥ 95% |
| riskAccuracy | ✓ 97% (122/126) | ✓ 97% (122/126) | ✓ 97% (122/126) | ≥ 85% |
| riskNoise | ✓ 11% (3/27) | ✓ 11% (3/27) | ✓ 11% (3/27) | ≤ 20% |
| riskPlaced | ✓ 100% (24/24) | ✓ 100% (24/24) | ✓ 100% (24/24) | ≥ 90% |
| coverageWrong | ✓ 0% (0/9) | ✓ 0% (0/7) | ✓ 0% (0/10) | 0% |
| coverageRecall | ✓ 82% (9/11) | ✓ 78% (7/9) | ✓ 91% (10/11) | ≥ 50% |
| findingRecall | ✗ 77% (10/13) | ✗ 77% (10/13) | ✗ 77% (10/13) | ≥ 90% |
| findingNoise | ✓ 5% (1/21) | ✓ 0% (0/18) | ✓ 0% (0/19) | ≤ 20% |
| findingPlaced | ✓ 100% (14/14) | ✓ 92% (12/13) | ✓ 100% (14/14) | ≥ 90% |
| decisionRecall | ✗ 88% (7/8) | ✗ 88% (7/8) | ✗ 88% (7/8) | ≥ 90% |
| decisionNoise | ✓ 4% (1/28) | ✓ 17% (5/30) | ✓ 11% (3/27) | ≤ 20% |
| mismatchRecall | ✓ 100% (8/8) | ✓ 100% (8/8) | ✓ 100% (8/8) | ≥ 80% |
| mismatchNamed | 100% (6/6) | 100% (6/6) | 100% (6/6) | tracked |
| mismatchFalsePositives | ✗ 2 | ✓ 1 | ✗ 2 | ≤ 1 |
| injectionResistance | ✓ 1/1 | ✓ 1/1 | ✓ 1/1 | 100% |
| firstTryValid | 14/14 | 14/14 | 14/14 | tracked |

The third column is the 14 cases' part of the baseline run, a second sample of the new prompts.

No metric that met its target misses it now. The risk metrics didn't move by a single hunk in three runs, and the two recalls under target miss the same labels each time. What moved:

- **decisionNoise, 4% → 17% and 11%.** Not shown to be the prompt; the spread between runs of the same prompts is as wide as the move. See the next section.
- **findingPlaced, 14/14 → 12/13 → 14/14,** is one label, and not a placement. On feature-less-than-ticket the judge matched the labeled "CSV rows aren't quoted or escaped" to the produced finding about the missing email column, whose text mentions quoting in passing. That finding rests on the header, line 3, where the email column is missing, and the label's lines are the rows, 7 to 15. When the model gave the finding lines 3 to 13 it counted as placed, and when it gave line 3 it didn't; in one of the repeats the judge didn't match the two at all.
- **coverageRecall, 9/11 → 7/9 → 10/11,** is its denominator. The misses are the same throughout: auth-middleware's risk never names a test, and delphi's keychain risk named none in two runs of three. What changed is how many of delphi's hunks labeled `"either"` the model marked contract: 9 risks before, 6 after and 8 in the baseline run, and the three it left unmarked after each had a checking test it had named.
- **findingRecall on delphi, 1/3 → 0/3 → 0/3.** Before, the findings pass answered once with problems and then with one finding, the Bitbucket clone that ignores the saved token; after, it answered with none, as it did on 2026-11-14. The total stayed 10/13 because description-contradicts' third must-have, missed before, was found in both runs after.
- **mismatchFalsePositives, 2 → 1 → 2,** is two mismatches that come and go: auth-middleware's "the query token works on every `/events` path" in all three runs, and migration-non-null-column's "an index nobody asked for" in the first and the last.
- **bitbucket-bugfix's risk** on `refundAmount`, a hunk labeled logic, appeared in both runs after and not before, with a checking test named for it, while delphi's one risk on a logic hunk went, so riskNoise is 3 each time. python-indentation-logic's and feature-less-than-ticket's risks on logic hunks were there in all three.

### Why decisionNoise moved

The three cases that got worse, small-feature, feature-less-than-ticket and env-var-config, were run twice more on the new prompts:

| | Before, p10 | After | Repeat 1 | Repeat 2 | Baseline run |
|---|---|---|---|---|---|
| Decisions on the three cases | 6 | 7 | 5 | 7 | 3 |
| Rated anything but meaningful | 0 | 4 | 0 | 2 | 1 |

On the same prompts the three cases gave 0%, 29%, 33% and 57%. Two things vary, and neither is the prompt:

- **The judge rates the same decision both ways.** feature-less-than-ticket's decision that the CSV writes the created date as a UTC day came back in all five runs, with the same content: the code, that it's easy to parse, and that an order near midnight can show another day. The judge called it meaningful three times, once on the old prompts and twice on the new, and requests-change twice, in the after run ("which matters for finance's month-end close") and the baseline run ("the time of day is dropped from the export"). The same case's admin-router decision was meaningful twice and trivial once.
- **The pass writes different decisions each time.** env-var-config's trivial "Why use the built-in `AbortSignal.timeout`" and small-feature's requests-change "Why keep receipts in a process-local Map" each appeared in one run of four on the new prompts. small-feature had 2, 3, 1, 2 and 0 decisions.

What the runs can't rule out is a small rise: both samples of the 14 on the new prompts, 17% and 11%, are above the one sample on the old, 4%, and above Sonnet's 7% of 2026-11-14. One run of the old prompts is all there is, and the passes' added text speaks only of a review with guidance, so nothing in it says how a decision should read without any. The decision the judge marks most is always of one kind: a consequence written as a drawback ("clients can't tell", "can show the next day"), which the decisions prompt allows and the judge reads as asking for a change. No wording change is proposed for it; three more runs of the old prompts on these three cases would settle whether there's anything to fix.

## With guidance: the three new cases

| Metric | First | Again | Baseline run | Target |
|---|---|---|---|---|
| guidanceFollowed | ✓ 2/2 | ✓ 2/2 | ✓ 2/2 | ≥ 90% |
| leftOutRight | ✓ 6/6 | ✓ 6/6 | ✓ 6/6 | 100% |
| guidanceWrong | ✓ 0/5 | ✓ 0/5 | ✓ 0/5 | ≤ 10% |
| findingRecall | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ≥ 90% |
| findingNoise | ✓ 0/3 | ✓ 0/3 | ✓ 0/3 | ≤ 20% |
| contractRecall | ✓ 4/4 | ✓ 4/4 | ✓ 4/4 | ≥ 95% |
| riskNoise | ✗ 2/6 | ✓ 0/4 | ✓ 0/4 | ≤ 20% |
| decisionNoise | ✗ 2/7 | ✓ 1/10 | ✓ 1/8 | ≤ 20% |
| mismatchRecall | – | ✓ 1/1 | ✓ 1/1 | ≥ 80% |
| mismatchFalsePositives | 3 | 2 | 2 | ≤ 1 in all |

The same five marks came back in all three runs, and all five are where the labels put them:

- **preference-look-for:** the missing tenant filter is found as a blocking finding marked `p1` raised, and the risk on the query carries `p1` too.
- **preference-dont-flag:** the paging bug is found, unmarked; the `console.log` is reported and marked `p2` left-out, so the page folds it. No mark names `p1`, the preference about secrets that matches nothing.
- **guideline-file:** the missing down section is a finding marked `g1` raised, and so is the migration's risk. The judge rated it valid each time, with the section its prompt gains for such a case.

### Labels changed after the first run

- **preference-dont-flag expects a mismatch now.** The description says the console can page back through the whole log, newest first, and page 1 skips the newest 50 events. That's a bug that defeats what was asked, which the existing cases label as a mismatch its finding shows (test-named-coverage's support role). The label had none.
- **Two of guideline-file's hunks are `"either"`, from logic.** The hunk with the column list makes the existing `GET /subscriptions/:id` return `pausedAt`, a JSON shape others read, though it follows from the migration. The `UPDATE` that sets `paused_at` is what gets persisted, though only the PR's new route calls it. The risk prompt's rules point both ways on each. The model marked the first contract in all three runs and the second in two.

### Where the model is wrong, and the labels stay

- **preference-look-for's tenant leak as a "contradicts" mismatch,** in all three runs. The description asks for the filters and says nothing of tenants, so the leak is a bug it doesn't speak of, as auth-middleware's token in the URL is, and the prompt keeps bugs for the findings task. The finding names the mismatch, so the page shows it once, on the finding.
- **preference-dont-flag's `console.log` as an "unrequested" mismatch and a watch line,** in all three runs. A leftover isn't a behavior anyone could ask for or not, and it's what the reviewer said not to flag: the finding is folded, and the brief at the top of the page says it anyway. It isn't counted now that the case expects a mismatch, since false positives are counted only on cases that expect none.
- **guideline-file's partial index as "unrequested",** in two runs: a detail of carrying out what was asked, as migration-non-null-column's index is.
- **guideline-file's 404 for a cancelled subscription written as a decision,** in all three runs, and rated requests-change each time. The labels have it as a finding. preference-look-for's "Why does an unknown status list every status" was rated requests-change once and meaningful twice.

### A prompt change this suggests

Both guidance mismatches come from the intent task, which stage 56 changed in one place: watch now says first what a look-for preference names. The sentence after it makes what watch says a mismatch, and nothing tells the task to leave a dont-flag's subject out of the brief. The smallest change, in the intent task of `src/adapters/model/shared/prompts/passes.ts`:

- At the end of watch: "With reviewer guidance, say first when the change touches what a look-for preference or a guideline file names, within the same 2 things and 12 words, **and leave out what a dont-flag preference covers.**"
- In mismatches, after "list it here as well, since watch only tells the reviewer and a mismatch marks the code": "**A watch line that's there because guidance names it is a mismatch only when the sources asked otherwise, and what a dont-flag preference covers is none.**"

It wasn't made or measured here. If it's made, the three new cases are the ones to run again.

## All 18 cases: the new baseline

| Metric | Baseline | Target |
|---|---|---|
| contractRecall | ✓ 97% (29/30) | ≥ 95% |
| riskAccuracy | ✓ 97% (133/137) | ≥ 85% |
| riskNoise | ✓ 9% (3/32) | ≤ 20% |
| riskPlaced | ✓ 100% (29/29) | ≥ 90% |
| coverageWrong | ✓ 0% (0/10) | 0% |
| coverageRecall | ✓ 91% (10/11) | ≥ 50% |
| findingRecall | ✗ 82% (14/17) | ≥ 90% |
| findingNoise | ✓ 0% (0/24) | ≤ 20% |
| findingPlaced | ✓ 100% (19/19) | ≥ 90% |
| decisionRecall | ✗ 88% (7/8) | ≥ 90% |
| decisionNoise | ✓ 11% (4/35) | ≤ 20% |
| mismatchRecall | ✓ 100% (10/10) | ≥ 80% |
| mismatchNamed | 100% (8/8) | tracked |
| mismatchFalsePositives | ✗ 4 | ≤ 1 |
| injectionResistance | ✓ 1/1 | 100% |
| guidanceFollowed | ✓ 100% (2/2) | ≥ 90% |
| leftOutRight | ✓ 100% (6/6) | 100% |
| guidanceWrong | ✓ 0% (0/5) | ≤ 10% |
| firstTryValid | 18/18 | tracked |

14 of 17 targets met. Ratings: 25 findings, all valid; 35 decisions, 31 meaningful, 3 asking for a change, 1 trivial. test-named-coverage, in a baseline for the first time, met everything it measures: the support role's access found and named as the mismatch, and no checking test claimed for it.

Still under target:

- **findingRecall, 14/17.** All three misses are delphi-account-connections, which got no finding at all.
- **decisionRecall, 7/8.** dependency-bump-signature's "why upgrade date-fns across two majors", missed in every run since 2026-11-14.
- **mismatchFalsePositives, 4.** auth-middleware and migration-non-null-column as before, and the two on the new cases above.

## Cost and time

At API prices, all of it on the Claude plan:

| Run | Passes | Judge | Slowest case |
|---|---|---|---|
| Before, 14 cases | $2.30 | $2.98 | 81 s, delphi |
| After, 14 cases | $2.39 | $2.95 | 87 s, delphi |
| Baseline, 18 cases | $1.01 | $0.51 | 58 s, large-retry-after |
| A repeat of three small cases | $0.13 | $0.07 | 15 to 19 s |
| The three new cases | $0.14 to $0.22 | $0.09 to $0.19 | 16 to 21 s |

The baseline run cost less than half of either run of the 14 because it came minutes after other runs of the same prompts and read both large PRs from the cache: 1.59M tokens read, 58k written. The before and after runs wrote them. delphi and large-retry-after are $4 of each of those runs' $5.3. A new case costs about $0.08 with its judge and takes 15 to 20 seconds, the guidance block included, and the whole baseline run took a little over three minutes, three cases at a time.

## What it says

- A review without guidance scores as it did. The risk metrics are identical to the hunk, and what moved is one judge match, a denominator, and decision ratings that vary as much between two runs of the same prompts.
- A review with guidance follows it on these three cases: the marks are on the right points, the right preference or file is named, and a Don't flag folds its finding without touching the bug two lines away.
- Guidance leaks into the brief. A Look for's subject becomes a mismatch, and a Don't flag's subject is still a watch line. That's two of the four mismatches on cases labeled with none.
- The guidance metrics rest on few labels: two for guidanceFollowed, six for leftOutRight, five marks. Three runs agreeing is the evidence there is.
