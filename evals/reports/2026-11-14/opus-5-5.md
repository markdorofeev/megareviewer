# Eval runs, 2026-11-14: Opus 5.5 at high and medium effort

`node evals/run.ts --model claude-opus-5-5 --effort high|medium --baseline evals/baseline.json --yes`, all 14 cases each, through Claude Code with the same prompts. Every pass ran at the one effort given, in place of each pass's own (findings and decisions high, intent and tour medium, risk low), which the [Haiku](haiku-5-5.md) and [Sonnet](sonnet-5-5.md) runs used. 14 of 14 scored in both. No pass was answered by another model.

The judge is Opus 5.5 too, so here it grades its own model's output. One run of each.

## Scores

| Metric | Haiku 5.5 | Sonnet 5.5 | Opus 5.5, high | Opus 5.5, medium | Target |
|---|---|---|---|---|---|
| contractRecall | ✗ 84% (21/25) | ✓ 100% (25/25) | ✓ 100% (25/25) | ✗ 92% (23/25) | ≥ 95% |
| riskAccuracy | ✓ 94% | ✓ 98% | ✓ 98% | ✓ 94% | ≥ 85% |
| riskNoise | ✓ 16% (4/25) | ✓ 11% (3/28) | ✓ 11% (3/28) | ✗ 21% (6/29) | ≤ 20% |
| riskPlaced | ✓ 100% | ✓ 100% | ✓ 100% | ✓ 100% | ≥ 90% |
| findingRecall | ✗ 69% (9/13) | ✗ 77% (10/13) | ✗ **85%** (11/13) | ✗ **85%** (11/13) | ≥ 90% |
| findingNoise | ✗ 21% (6/28) | ✓ 0% (0/18) | ✓ 0% (0/22) | ✓ 4% (1/25) | ≤ 20% |
| findingPlaced | ✓ 93% (14/15) | ✓ 100% (13/13) | ✗ 87% (13/15) | ✗ 88% (14/16) | ≥ 90% |
| decisionRecall | ✗ 63% (5/8) | ✗ 75% (6/8) | ✗ 75% (6/8) | ✗ 63% (5/8) | ≥ 90% |
| decisionNoise | ✗ 36% (18/50) | ✓ **7%** (2/29) | ✗ 21% (10/47) | ✗ 42% (19/45) | ≤ 20% |
| mismatchRecall | ✓ 100% | ✓ 100% | ✓ 100% | ✓ 100% | ≥ 80% |
| mismatchFalsePositives | ✓ 0 | ✗ 2 | ✓ 1 | ✓ 1 | ≤ 1 |
| injectionResistance | ✓ 1/1 | ✓ 1/1 | ✓ 1/1 | ✓ 1/1 | 100% |
| **Targets met** | 7 of 12 | **9 of 12** | 8 of 12 | 6 of 12 | |
| firstTryValid | 13/14 | 14/14 | 13/14 | 14/14 | tracked |

## Quality

- **Opus finds the most:** 11 of 13 must-have findings at either effort. Every small case's must-haves, and on delphi-account-connections one of three: Bitbucket clones getting no credentials when only the app password is set. Neither effort finds the revoked GitHub token or the tests reading the real keychain, which no model has found yet.
- **Its findings are rated valid,** 22 of 22 at high and 24 of 25 at medium, but two at each effort rest on lines other than the label's, so findingPlaced is under target where Haiku and Sonnet meet it.
- **Its decisions are noisy, and more so at medium.** At high, 10 of 47 are noise, 5 of them asking for a change; at medium 19 of 45, 10 asking for a change ("Why cache receipts in a process-local Map, not Redis", "Why the whole CSV is built in memory before sending"). Sonnet, at each pass's own effort, has 2 of 29.
- **Decisions missed:** high misses the date-fns upgrade across two majors and env-var-config's 5 s timeout; medium misses those and the migration's `us-east-1` backfill. Every model has missed the date-fns upgrade.
- **Contract at medium** drops small-feature's receipts config section and large-retry-after's retry decision ("the behavior change is decided in retry-timing.ts"), and raises risks on six logic hunks, among them description-contradicts' retry constants and small-feature's receipt cache.
- **The one false-positive mismatch,** at both efforts, is on dependency-bump-signature: date-fns 4 reads a date-only string as UTC, so the report title can show the previous day west of UTC. Haiku and Opus medium also raised it as a risk. It reads like a real bug the labels don't have; worth checking before counting it against the model.

## Time

| | Haiku 5.5 | Sonnet 5.5 | Opus high | Opus medium |
|---|---|---|---|---|
| Whole run, 3 cases at a time | 5.5 min | 3.6 min | 4.2 min | **3.3 min** |
| delphi-account-connections | 174 s | 125 s | 114 s | **64 s** |
| large-retry-after | 100 s | 42 s | 86 s | 60 s |
| The other 12 | 17–45 s | **7–22 s** | 13–84 s | 11–32 s |
| Output tokens, all passes | 205k | **50k** | 84k | 64k |

On delphi, the case's wait is spread over the passes on Opus rather than held by findings:

| delphi pass | Haiku | Sonnet | Opus high | Opus medium |
|---|---|---|---|---|
| Intent | 15 s | 70 s | 11 s | 8 s |
| Findings | **147 s** | 46 s | 69 s | 45 s |
| Risk | 38 s | 21 s | 49 s | 42 s |
| Decisions | 42 s | 20 s | 33 s | 26 s |
| Tour | 11 s | 9 s | 34 s in 2 calls | 11 s |

The first pass of a case sometimes waits about a minute with almost nothing written: Sonnet's intent on delphi (70 s, 773 output tokens) and Opus high's on env-var-config (65 s, 456 tokens), the outlier among its small cases. It's the call that writes the PR to the cache, but the same call took 8–15 s on other runs of the same PR, so it looks like a wait on the service rather than the model's work.

## Cost at API prices, all on the plan

| | Haiku 5.5 | Sonnet 5.5 | Opus high | Opus medium |
|---|---|---|---|---|
| Passes, all cases | $0.62 | $2.44 | $5.67 | $2.49 |
| Passes per case | $0.04 | $0.17 | $0.40 | $0.18 |
| delphi | $0.18 | $0.78 | $1.69 | $0.48 |

Opus at medium costs what Sonnet does, since it writes fewer tokens at a higher price.

## What it says

- **Sonnet 5.5 at each pass's own effort is still the best balance:** the most targets met, by far the least decision noise, the fastest small cases, at Opus medium's cost. Its weak spot is delphi, where it returned no findings.
- **Opus finds a little more,** one more must-have finding than Sonnet, the one on delphi, but its decisions are noisier and its findings land on the wrong lines more often. High effort is worth it over medium for Opus: medium loses contract, adds risk noise, doubles decision noise and misses one more decision, for half the cost and time.
- **One effort for every pass is part of what's measured here.** Opus's decision noise may come partly from decisions running at medium, and its risk noise from risk running above low. Opus at each pass's own effort would separate the model from the effort.
- **The judge is the same model as Opus's passes,** which may favor them. Sonnet's and Haiku's runs don't have that bias.
- One run each; findingRecall moves by one label of 13 and decisionRecall by one of 8.
