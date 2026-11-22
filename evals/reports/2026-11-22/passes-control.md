# Eval run, 2026-11-22: the passes on stage 63's branch, and a control

Stage 63 adds a model call after the four passes and leaves the passes as they were, so they weren't measured again when it was built. These two runs ask whether that holds: the 18 cases on the branch, and, since that run scored worse than the baseline, the same 18 on the commit before the stage. All on Sonnet 5.5 through Claude Code 2.1.303, pipeline 20, judged by `claude-opus-5-5` on Claude Code, `JUDGE_VERSION` 5.

| Run | Commit | Prompts | Results file |
|---|---|---|---|
| Baseline | Stage 59's | p11 | `2026-11-17T16-26-01.819Z`, which is `evals/baseline.json` |
| Branch | `0acfd9e`, stage 63's third version | p13, the text of p11 | `2026-11-22T08-57-51.483Z` |
| Control | `34ee501`, the commit before the stage | p11 | `control-34ee501-2026-11-22T09-06-34.778Z` |

The control ran nine minutes after the branch, from a worktree of its own with the branch's dependencies.

| Metric | Baseline | Control | Branch | Target |
|---|---|---|---|---|
| contractRecall | 97% (29/30) | ✓ 97% (29/30) | ✗ 93% (28/30) | ≥ 95% |
| riskAccuracy | 97% (133/137) | ✓ 95% (130/137) | ✓ 93% (128/137) | ≥ 85% |
| riskNoise | 9% (3/32) | ✓ 17% (6/35) | ✓ 20% (7/35) | ≤ 20% |
| riskPlaced | 100% | ✓ 100% (29/29) | ✓ 100% (28/28) | ≥ 90% |
| coverageWrong | 0% (0/10) | ✗ 20% (2/10) | ✗ 18% (2/11) | 0% |
| coverageRecall | 91% (10/11) | ✓ 80% (8/10) | ✓ 82% (9/11) | ≥ 50% |
| findingRecall | 82% (14/17) | ✗ 88% (15/17) | ✗ 82% (14/17) | ≥ 90% |
| findingNoise | 0% (0/24) | ✓ 4% (1/26) | ✓ 7% (2/27) | ≤ 20% |
| findingPlaced | 100% | ✓ 95% (19/20) | ✓ 100% (19/19) | ≥ 90% |
| decisionRecall | 88% (7/8) | ✗ 88% (7/8) | ✗ 63% (5/8) | ≥ 90% |
| decisionNoise | 11% (4/35) | ✓ 17% (7/41) | ✓ 17% (6/36) | ≤ 20% |
| mismatchRecall | 100% (10/10) | ✓ 90% (9/10) | ✓ 100% (10/10) | ≥ 80% |
| mismatchFalsePositives | 4 | ✗ 4 | ✗ 5 | ≤ 1 |
| injectionResistance, guidanceFollowed, leftOutRight, guidanceWrong | at target | at target | at target | |

Every case scored in both runs, and every risk pass was valid first time.

## The branch sends what the commit before it sends

The control read its prompts from the cache the branch's run had written. On large-retry-after the branch's intent pass wrote 160,490 tokens to the cache and the control's read 162,605 from it; on small-feature, 5,652 written and 7,768 read. A cache answers only for the same bytes, the system prompt, the answer's schema and the pull request's data, so the two commits send the passes the same request. That's the fingerprint tests' claim, seen on real calls.

So nothing in the branch can have moved a score, and the difference between today's two runs is what two runs of the same request differ by:

| Case | Control | Branch |
|---|---|---|
| migration-non-null-column | contractRecall 3/3 | 2/3 |
| delphi-account-connections | contractRecall 6/6, coverageWrong 1/6, findingRecall 1/3 | 5/6, 0/5, 0/3 |
| large-retry-after | contractRecall 2/3, coverageWrong 1/3, mismatchRecall 0/1 | 3/3, 2/5, 1/1 |
| bitbucket-bugfix, python-indentation-logic | decisionRecall 1/1 each | 0/1 each |
| preference-look-for | decisionNoise 2/2, 1 mismatch false positive | 0/1, 2 |

## The baseline doesn't reproduce

Both of today's runs are worse than the baseline on the risk pass's metrics, with the baseline's own prompts: riskAccuracy by 3 and 5 hunks, riskNoise by 3 and 4 risks, and two wrong checking tests each where the baseline had none. Nearly all of it is on the two largest cases: on delphi-account-connections the baseline marked 46 of 46 hunks as labeled and today's runs 43 and 42.

Stage 59's report had the risk metrics not move by a hunk in three runs. Why they move now isn't known: the model answering differently, a Claude Code update since 17 November, or a spread those three runs didn't show. One run on each commit doesn't tell them apart.

## The checking tests that were wrong

Four claims in the two runs, none of them on the hunk the labels put the test on:

- **delphi-account-connections, control:** Bitbucket's credential order, said to be checked by `test_saved_bitbucket_tokens_sign_in_with_the_email_and_clone_as_api_tokens`. It's the claim the risk task's prompt names as one that doesn't count: the test never stores credentials in git beside the saved token.
- **large-retry-after, both runs:** a `TimeoutError` in place of an `HTTPError`, said to be checked by "totalTimeout bounds hanging HTTPError body reads when timeout is disabled", on `h_e5b8f0108cd99bd7` in the branch's run and `h_4e6dcb154464c3df` in the control's. The labels put that test on a third hunk of the same change, `h_c3ce4ac3781b08ad`, and label these two `either` with no test: the label may be too narrow.
- **large-retry-after, branch:** the doc comment on `afterStatusCodes`, said to be checked by the test that a status missing from `statusCodes` isn't retried. The hunk is labeled `either`, and the test's name is what the comment states.

So one of the four is the model's mistake by the prompt's own rule, and three are on hunks the labels leave open. The labels weren't changed.

## Cost

At API prices, on the plan: the branch's run $2.02 for the passes and $3.19 for the judge, the control $0.98 and $0.50, since it read the pull requests and the judge's input from the cache.

## What stands

`evals/baseline.json` is unchanged. A new baseline would need the spread first: several runs of the same commit, to know what a difference of two hunks means.
