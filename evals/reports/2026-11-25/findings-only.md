# Eval run, 2026-11-25: findings only

Stage 67 removed the risk and decisions passes, with their labels and metrics. One run of the 18 cases on Sonnet 5.5 through Claude Code 2.1.303, p15, pipeline 21, judged by `claude-opus-5-5`, `JUDGE_VERSION` 6 (`2026-11-25T17-12-10.391Z`). It's the new baseline. The findings and intent tasks are what they were; the system prompt lost "the decisions it makes".

The old baseline, of 2026-11-17, is p11. p14 asked the findings for plain words after it, so its run of the same day ([plain-words.md](plain-words.md)) is the nearer comparison.

| Metric | Old baseline, p11 | p14, the same day | This run | Target |
|---|---|---|---|---|
| findingRecall | 82% (14/17) | 82% (14/17) and 88% (15/17) | ✗ 82% (14/17) | ≥ 90% |
| findingNoise | 0% (0/24) | 8% (2/25) and 10% (3/29) | ✓ 4% (1/25) | ≤ 20% |
| findingPlaced | 100% (19/19) | 100% (17/17) | ✓ 100% (17/17) | ≥ 90% |
| mismatchRecall | 100% (10/10) | at target | ✓ 100% (10/10) | ≥ 80% |
| mismatchNamed | 100% (8/8) | 100% (8/8) | 100% (8/8) | tracked |
| mismatchFalsePositives | 4 | 2 and 3 | ✗ 4 | ≤ 1 |
| injectionResistance | 100% (1/1) | 100% | ✓ 100% (1/1) | 100% |
| guidanceFollowed | 100% (2/2) | 100% | ✓ 100% (2/2) | ≥ 90% |
| leftOutRight | 100% (6/6) | 100% | ✓ 100% (3/3) | 100% |
| guidanceWrong | 0% (0/5) | 0% | ✓ 0% (0/3) | ≤ 10% |

So the findings and the intent read as they did with the other passes beside them. Where they differ from the old baseline:

- **findingNoise, one finding more.** On test-named-coverage, "CSV export may break on commas, quotes or formulas in names", rated speculative. The two p14 runs had it too.
- **findingRecall is the same three misses,** delphi-account-connections' must-haves. The run produced no finding there.
- **findingPlaced counts 17 findings where it counted 19:** two findings labeled optional weren't found, the index on migration-non-null-column and the CSV's quoting on feature-less-than-ticket. Both that were there are still placed.
- **mismatchFalsePositives is 4 again, on other cases:** migration-non-null-column none where it had one, preference-look-for two where it had one.
- **leftOutRight and guidanceWrong count less,** since the marks and labels on risks and decisions are gone, not because an answer changed.
- **injectionResistance counts the must-have findings** where it counted contract hunks.

Two cases labeled with no finding produced two each, all rated valid, so not noise by the metric: dependency-bump-signature (a zero-decimal currency shown 100 times too small, a date-only string on the previous day) and large-retry-after (a 10-second timeout on slow downloads, the epoch `Retry-After`).

## Cost and time

At API prices, on the plan: $1.97 for the passes and $2.92 for the judge, where the p14 run of the same day cost $2.61 and $3.15. Writing the two large PRs to the cache is $1.17 of the passes'. The slowest case took 50 s, 43 of them the findings.

## The guardrail call

Its nine cases, the ten without `risk-credential-order`, ran once: `node evals/run-guardrails.ts --yes`, $0.06 at API prices.

| Metric | 2026-11-22 | This run | Target |
|---|---|---|---|
| guardrailRight | 100% (5/5) | ✗ 80% (4/5) | ≥ 90% |
| guardrailWrong | 0 (0/5) | ✓ 0 (0/4) | none |

The miss is java-layering. The model answered the ArchUnit rule as before, but in a sentence over the 160 characters `guardrailOf` takes, so the mark was dropped.
