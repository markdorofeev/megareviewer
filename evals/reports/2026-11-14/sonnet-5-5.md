# Eval run, 2026-11-14: Sonnet 5.5 against the Haiku 5.5 baseline

`node evals/run.ts --model claude-sonnet-5-5 --baseline evals/baseline.json --yes`, all 14 cases, passes on Claude Code with the same prompts and efforts (`claude-code/claude-sonnet-5-5/p5`), judged by `claude-opus-5-5`, `JUDGE_VERSION` 4. 14 of 14 scored. Every pass was answered by Sonnet: the adapter warns when Claude Code serves another model, and none did. The baseline is the [Haiku run](haiku-5-5.md) of the same day. One run of each.

## Scores

| | Metric | Haiku 5.5 | Sonnet 5.5 | Target |
|---|---|---|---|---|
| | contractRecall | ✗ 84% (21/25) | ✓ **100%** (25/25) | ≥ 95% |
| | riskAccuracy | ✓ 94% (118/126) | ✓ 98% (123/126) | ≥ 85% |
| | riskNoise | ✓ 16% (4/25) | ✓ 11% (3/28) | ≤ 20% |
| | riskPlaced | ✓ 100% (21/21) | ✓ 100% (25/25) | ≥ 90% |
| | findingRecall | ✗ 69% (9/13) | ✗ 77% (10/13) | ≥ 90% |
| | findingNoise | ✗ 21% (6/28) | ✓ **0%** (0/18) | ≤ 20% |
| | findingPlaced | ✓ 93% (14/15) | ✓ 100% (13/13) | ≥ 90% |
| | decisionRecall | ✗ 63% (5/8) | ✗ 75% (6/8) | ≥ 90% |
| | decisionNoise | ✗ 36% (18/50) | ✓ **7%** (2/29) | ≤ 20% |
| | mismatchRecall | ✓ 100% (8/8) | ✓ 100% (8/8) | ≥ 80% |
| | mismatchFalsePositives | ✓ 0 | ✗ **2** | ≤ 1 |
| | injectionResistance | ✓ 1/1 | ✓ 1/1 | 100% |
| | firstTryValid | 93% (13/14) | 100% (14/14) | tracked |

Targets met: 7 of 12 on Haiku, 9 of 12 on Sonnet.

Ratings: Sonnet's 18 findings were all valid (Haiku: 22 valid, 5 speculative, 1 nit), and 27 of its 29 decisions meaningful (Haiku: 32 of 50).

## What changed

- **Sonnet says less, and what it says holds.** 18 findings and 29 decisions against 28 and 50. All of Haiku's noise was in what Sonnet left out: no speculative findings, and only one decision asking for a change, where Haiku had seven.
- **Contract is fixed.** Sonnet marks contract the four hunks Haiku missed: small-feature's two `app.yaml` hunks and large-retry-after's retry decision and timing parser.
- **On the small cases, every must-have finding is found.** All 10 outside delphi, against Haiku's 9, which missed description-contradicts' "retries every error, 4xx included".
- **delphi-account-connections got no findings at all.** Sonnet's findings pass ran 46 s, wrote 5.8k tokens and answered with an empty list, which the checks passed as is: nothing was dropped. Haiku found none of the three must-haves in the full run and one on the rerun, so the hardest case is still missed by both, and Sonnet, which the prompt tells that a wrong finding costs more than a missed one, misses it by saying nothing.
- **Decisions:** Sonnet finds migration-non-null-column's backfill and env-var-config's 5 s timeout, which Haiku missed, and misses python-indentation-logic's item count, which Haiku found. Both miss the date-fns upgrade across two majors.
- **Two mismatches on cases labeled with none**, both "unrequested": auth-middleware's query-token fallback applying to every `/events` path, not just the orders route, and migration-non-null-column's index on `region`. The first is arguably real; the second is a detail of carrying out what was asked.
- **Risk noise** is three of Haiku's four: the exported `Account` type, the CSV format Finance reads, and `item_count`.

## Time

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Whole run (3 cases at a time) | about 6 min | about 3.5 min |
| delphi-account-connections | 174 s; 191 s on the rerun | **125 s** |
| large-retry-after | 100 s; 99 s on the rerun | **42 s** |
| The other 12 | 17–45 s | 7–22 s |
| Output tokens, all passes, all cases | 205k | 50k |

Sonnet is faster because it thinks far less: a quarter of Haiku's output tokens, across every pass (findings 17k against 83k, decisions 11k against 54k).

On delphi the time moved to a different place:

| Pass | Haiku, full run | Sonnet |
|---|---|---|
| Intent | 15 s | **70 s**, 773 output tokens |
| Findings | **147 s**, 33k output tokens | 46 s, 5.8k |
| Risk | 38 s | 21 s |
| Decisions | 42 s | 20 s |
| Tour | 11 s | 8.6 s |

Sonnet's intent pass took 70 s for 773 output tokens. It's the first pass, so it writes the PR's 128k tokens to the cache, and it cost $0.55 of the passes' $0.78. Haiku's intent pass did the same in 15 s, so the 70 s is either Sonnet's time to read 128k tokens or a slow moment on the service; one sample can't say which.

## Cost at API prices, all on the plan

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Passes, all cases | $0.62 | $2.44 |
| Passes per case | $0.04 | $0.17 |
| delphi-account-connections | $0.18 | $0.78 |
| large-retry-after | $0.35 | $0.86 |

Sonnet costs about 4× Haiku here, not the 20× its output price suggests, because it writes a quarter of the tokens. Its cost is mostly reading and writing the cache: delphi's intent pass alone, writing 128k tokens at Sonnet's rate, is $0.55. The judge was $0.45 against $3.01, since the PRs were still cached from the Haiku runs.

## What it says

- Sonnet 5.5 on the same prompts meets two more targets and removes nearly all the noise, in less than half the time, for about 4× the cost at API prices.
- It doesn't fix the hard case: on delphi it returns no findings, where the reviewer most needs them. That's a prompt question as much as a model one: a model that obeys "a wrong finding costs more than a missed one" can choose silence.
- One run per model. The small metrics move by one label: decisionRecall is 8 labels, findingRecall 13, and both models' delphi findings varied between Haiku's two runs. Repeats would say how much of this is noise.
