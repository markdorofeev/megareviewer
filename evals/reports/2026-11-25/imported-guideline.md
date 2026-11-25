# Eval run, 2026-11-25: a rule in a file a guideline file imports

Stage 67 gives a run the files its guideline files import. This asks whether a rule stated only in one of them is followed, and marked on that file. Four cases, three runs each, on Sonnet 5.5 through Claude Code (`claude-code/claude-sonnet-5-5/p13`, pipeline unchanged), judged by `claude-opus-5-5`. Every case scored, every pass valid on the first try. Results: `2026-11-25T09-20-44.737Z`, `2026-11-25T09-21-36.796Z`, `2026-11-25T09-22-22.450Z`.

The new case, `imported-guideline`: `CLAUDE.md` imports `docs/service-rules.md` (`g2`) and `docs/local-setup.md` (`g3`). Only the first asks a handler that takes away access to record it, and the PR's handler doesn't.

| Metric | Run 1 | Run 2 | Run 3 | Target |
|---|---|---|---|---|
| guidanceFollowed | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ≥ 90% |
| leftOutRight | ✓ 8/8 | ✓ 8/8 | ✓ 8/8 | 100% |
| guidanceWrong | ✓ 0/7 | ✓ 0/7 | ✓ 0/7 | ≤ 10% |
| findingRecall | ✓ 4/4 | ✓ 4/4 | ✓ 4/4 | ≥ 90% |
| findingNoise | ✓ 0/4 | ✓ 0/4 | ✓ 0/4 | ≤ 20% |
| contractRecall | ✓ 5/5 | ✓ 5/5 | ✓ 5/5 | ≥ 95% |
| riskNoise | ✓ 0/5 | ✓ 0/5 | ✓ 0/5 | ≤ 20% |
| decisionNoise | ✗ 3/12 | ✗ 3/9 | ✗ 2/9 | ≤ 20% |
| mismatchFalsePositives | ✗ 2 | ✗ 3 | ✗ 3 | ≤ 1 |

## The mark

In all three runs the unrecorded removal is a major finding marked `g2` raised, and the route's risk carries `g2` too. Nothing was marked `g1`, the file that imports the rule, or `g3`.

## What missed its target

- **mismatchFalsePositives.** `imported-guideline` adds one in every run: the intent task calls the broken rule a mismatch ("missing" twice, "unrequested" once, citing the service rules). A guideline file isn't what was asked for, so that's wrong, and the finding already says it. It's the pattern `preference-look-for` has shown since 2026-11-17, whose report proposes the wording for the intent task. Not made here: this stage leaves the prompts alone. The other false positives are `preference-look-for`'s tenant leak, in every run, and `guideline-file`'s partial index, in two of the three, as in 2026-11-17's runs.
- **decisionNoise.** Of the 8 noisy decisions in 30, 2 are the new case's, in runs 1 and 2, and 6 are the three older cases': 2/9, 2/7 and 2/7 against 1/8 in the baseline. Those cases send the bytes they sent before this stage, which the rendering's hash test holds, so the stage didn't cause them; they're few, and whether the prompts' changes since the baseline (p11 to p13) did isn't answered by three runs.

## Live, on megareviewer's own repository

`8d79787..57aceb4` as a pull request, the fake host's source over the repository's own Markdown files at the base commit, real passes, `CLAUDE.md` on, against the same without guidance. One run each.

| | `CLAUDE.md` on | No guidance |
|---|---|---|
| Given | `CLAUDE.md`, `MISSION.md`, `DESIGN.md`, `ENGINEERING.md` (42 KB) | nothing |
| The shared text | 447,849 bytes | 404,836 bytes |
| Written to the cache by the intent | 167,265 tokens | 153,295 tokens |
| Read from it by each later pass | 168,219 tokens | 154,250 tokens |
| At API prices | $0.84 | $0.78 |

`ARCHITECTURE.md`, 169 KB, was named in the warning as not fitting. The risks were the same two in both; the guided run had one finding and the other none, which one run each says nothing about.
