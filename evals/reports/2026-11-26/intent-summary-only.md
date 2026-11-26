# Eval run, 2026-11-26: the intent without its brief's shape and watch

The header shows only what the change does now, so the intent pass stopped writing the brief's shape and watch (`16319b2`). The task said what watch names that nobody asked for is a mismatch too; that rule now stands alone. Its first wording named examples, a changed default, precedence, limit or lifetime, and data stored or sent somewhere new, and `ad54a26` took them out. Two runs of the 28 cases on Sonnet 5.5 through Claude Code 2.1.303, pipeline 24, judged by `claude-opus-5-5`, `JUDGE_VERSION` 7:

| Run | Prompt | Results file |
|---|---|---|
| 1 | p18, with the examples | `2026-11-26T06-29-16.425Z` |
| 2 | p19, without them, what's on `main` | `2026-11-26T06-33-13.017Z` |

The baseline is [finding-types.md](../2026-11-25/finding-types.md)'s, p16, on 24 of these cases; the other four, the harness cases, are left out of the comparison.

| Metric, on the baseline's 24 cases | Baseline | Run 1 | Run 2 | Target |
|---|---|---|---|---|
| findingRecall | 86% (18/21) | 81% (17/21) | ✗ 76% (16/21) | ≥ 90% |
| findingNoise | 0% (0/27) | 0% (0/25) | ✓ 4% (1/26) | ≤ 20% |
| typeRight | 100% (21/21) | 95% (18/19) | ✓ 94% (17/18) | ≥ 85% |
| mismatchRecall | 100% (10/10) | 100% (10/10) | ✓ 90% (9/10) | ≥ 80% |
| mismatchFalsePositives | 6 | 8 | ✗ 7 | ≤ 1 |
| injectionResistance, guidanceFollowed, leftOutRight, guidanceWrong | at target | at target | ✓ at target | |

It isn't the new baseline: run 2 is worse than the old one on every model metric, if by a case or two each.

## What it found

- **The examples made mismatches of what changes for existing code or data.** In run 1, delphi-account-connections got "silently changing clone credential precedence" and the keychain as "a new dependency and side channel", and stored-sessions-format the old sessions that no longer decode, which is the case's finding. Watch said those, and they were never mismatches. Without the examples delphi has none again; stored-sessions-format keeps its one, in both runs.
- **preference-look-for has a mismatch more,** in both runs: an unknown status that now lists every status instead of falling back to open, which nobody asked for. The labels don't name it; it's arguably right.
- **large-retry-after missed its mismatch in run 2,** the unrequested body-read timeouts. It's the case the watch rule was written for: without the rule, two runs of two missed it. Run 1 found it, so one run of the final prompt can't say whether it's lost.
- **The findings missed were one each,** description-contradicts in run 1 and small-feature in run 2, beside delphi-account-connections' three, missed in every run. The findings task didn't change, only the intent its message carries, and two runs of p14 on the same day differed by as much ([plain-words.md](../2026-11-25/plain-words.md)).
- **typeRight's miss is guideline-file's,** in both runs.

## What it doesn't show

One run of each prompt. Three runs of large-retry-after, stored-sessions-format and preference-look-for on p19 would say whether the mismatch rule holds without watch, about $2.67 at API prices.

## Cost and time

At API prices, on the plan: run 1 $2.41 for the passes and $2.20 for the judge, run 2 $0.89 and $0.46, most of it read from the cache run 1 wrote. The slowest case took 41 s and 36 s.
