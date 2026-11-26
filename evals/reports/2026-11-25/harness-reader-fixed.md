# Eval run, 2026-11-25: the reader, after the two fixes

[The first run](harness-reader.md) of sets A, B and C showed a false mismatch wherever the intent pass knew of a broken guideline rule, and the prompt's numbering in the answers. `b81f71b` and `c454738` change what a run with guidance sends (p14 to p15 through Claude Code): the intent's message says guidance isn't what was asked for and has no line asking it to read, and every pass's says where a ref belongs. The same three sets again, on the same cases and labels, at `c454738`.

| Set | Before | After | At API prices, passes + judge, after |
|---|---|---|---|
| A, reader on | `2026-11-25T16-16-09.822Z` | `2026-11-25T16-36-17.420Z` | $0.62 + $0.22 |
| B, reader off | `2026-11-25T16-17-32.791Z` | `2026-11-25T16-37-40.074Z` | $0.38 + $0.16 |
| C, index alone | `2026-11-25T16-18-27.170Z` | `2026-11-25T16-38-31.179Z` | $0.15 + $0.05 |

All 24 runs scored again, the 96 passes on their first call. Three runs each, so what the first report says of noise holds here.

## What was to be fixed

| | Before | After |
|---|---|---|
| False mismatches on `linked-section`, reader on | 3 | 0 |
| … index alone | 1 | 0 |
| … reader off | 0 | 0 |
| False mismatches on `imported-guideline` | 3 | 0 |
| Intent passes that read, reader on: `linked-section`, `asks-for-file` | 3/3, 3/3 | 1/3, 2/3 |
| … `linked-section`, index alone | 1/3 | 1/3 |
| Runs with a ref in their prose | 7 of 24 | 0 of 24 |
| Texts with one | 13 | 0 |
| Texts that name a document by its path | 0 | 21 |
| `harnessFollowed`, A and C | 9/9 | 9/9 |
| `harnessWrong`, A and C | 0/15 | 0/15 |
| `harnessRead`, A and C | 6/6 | 6/6 |
| The risk about `linked-section`'s rule, and marked: on, index alone, off | 3/3, 0/3, 0/3 | 3/3, 0/3, 0/3 |

- **The intent pass still reads without the line,** in 4 of 9 runs, since the index itself says to read before answering. The two that read the handbook reported no mismatch, and nor did the three that had the rule in the prompt: the sentence stopped them, not the missing read.
- **No ref reached the server's check,** which mended nothing in 96 passes. It's tested and unexercised. Nor did an answer name a document by its `harness/` copy.
- **The injection is still reported as a mismatch,** "contradicts", and as a blocking finding, in all 6 runs of `asks-for-file`. Nothing was refused and nothing quoted, as before.

## What else moved

| | Before | After |
|---|---|---|
| `mismatchFalsePositives` of each run, reader on | 3, 3, 3 | 1, 0, 0 |
| … reader off | 1, 1, 1 | 1, 1, 1 |
| … index alone | 0, 0, 1 | 0, 0, 0 |
| `unrelated-harness`'s empty string as a mismatch, on, off | 3/3, 3/3 | 1/3, 3/3 |
| `coverageWrong`, reader on, off | 3/3, none named | none named, 1/1 |
| `riskNoise`, on, off | 3/9, 3/6 | 2/8, 3/6 |
| `decisionNoise`, on, off, index alone | 6/20, 7/16, 2/8 | 8/23, 5/12, 1/5 |
| `findingRecall`, on, off, index alone | 15/15, 9/12, 3/3 | 15/15, 9/12, 3/3 |

- **One of those 3/3 to 1/3 is worth a look.** The empty string for calls under a minute is something nobody asked for, so "unrequested" is a fair mismatch and the label, which has none, counts it as false: the score went up by losing a true line. With the reader off, where the same sentence is sent, it stayed 3/3, so it may be chance or the sentence beside a large index. The finding says it in all 6 runs of each arm, and the watch line in 6 of 6, so nothing the reviewer reads went missing. The finding just stopped carrying the mismatch's mark in 2 runs.
- **`coverageWrong` looks like chance:** it went from the reader-on arm to the off one. The first report's risk that named the asked-for format in place of the bug is gone too: with the reader on, the risk now names the empty string in 2 of 3 runs and isn't raised in the third.
- **Time and tokens are the same.** The intent pass took 6.0 s on `linked-section` (6.9 before), with one call of 8.8 s that read nothing, and 5.8 s on `asks-for-file` (6.1); the run took 14.6 s (14.5) and 13.5 s (14.2), still 2 to 4 s more than without the reader. Calls that don't read vary from 3.5 to 10.8 s, so three runs can't show the line's removal saving time.
- **Nothing else moved beyond the noise.** The targets missed: `riskNoise` in A and B and `riskAccuracy` in B, by `unrelated-harness`'s hunk, `coverageWrong` in B by its test, `decisionNoise` in A and B, and `findingRecall` and `guidanceFollowed` without the reader, as they should.

## The cases with preferences or a guideline file alone

Both fixes change what these send, and no set above has them, so they ran after, three times each, at `f70d4b6` on the same p15: `2026-11-25T16-43-57.505Z`, $0.51 for the passes and $0.34 for the judge, all nine scored, every pass on its first call. Beside them, [stage 77's runs](imported-guideline.md) on p13 and [2026-11-17's](../2026-11-17/guidance.md) on p11. The prompts between differ in more than these fixes, plain words for findings, risks and decisions among it, so a difference isn't proof of cause.

| | p11, three runs (the first on labels since changed) | p13, three runs | p15, three runs |
|---|---|---|---|
| `guidanceFollowed`: look-for, guideline-file | 3/3, 3/3 | 3/3, 3/3 | 3/3, 3/3 |
| `leftOutRight`: dont-flag, guideline-file | 9/9, 9/9 | 9/9, 9/9 | 9/9, 9/9 |
| `guidanceWrong`: look-for, dont-flag, guideline-file | 0/15 in all | 0/6, 0/3, 0/6 | 0/6, 0/3, 0/6 |
| `findingRecall`: look-for, dont-flag, guideline-file | 9/9 in all | 3/3, 3/3, 3/3 | 3/3, 3/3, 3/3 |
| `contractRecall` | 12/12 | 12/12 | 12/12 |
| `riskNoise` | 2/14 | 0/12 | 0/12 |
| `decisionNoise`: look-for, dont-flag, guideline-file | 4/25 in all | 1/4, 2/7, 3/12 | 0/4, 4/9, 3/9 |
| Tenant leak as a mismatch, look-for (false) | 3/3 | 3/3 | 1/3 |
| `console.log` as a mismatch, dont-flag | 3/3 | 2/3 | 3/3 |
| … and in the brief's watch line | 3/3 | 2/3 | 3/3 |
| Partial index as a mismatch, guideline-file (false) | 2/3 | 2/3 | 3/3 |
| Runs with a ref in their prose | not counted | 1 (p1) | 0 |

- **Every point and mark is as before.** All fifteen marks came back where the labels put them, every must-have finding was found, every contract hunk raised.
- **The tenant leak is the false mismatch the sentence was for, and one run of three still has it,** as "unrequested". On `linked-section` and `imported-guideline`, whose rules are in a file, it's none in nine runs.
- **`console.log` and the partial index are as they were,** within a run of what each showed. Neither is a rule a preference or a guideline file states, so the sentence says nothing of them: `console.log` is what a Don't flag preference covers, and the sentence for that, proposed on 2026-11-17, was left out on purpose.
- **`decisionNoise` is 7/22 here against 6/23 on p13,** which is the same. Two of the seven are the 404 for a cancelled subscription, a requests-change in two runs of three here and in two of three on p13.
- **Nothing got worse in a way the fix plausibly caused.**

## What wasn't measured

Models other than Sonnet and transports other than Claude Code, all of which share the changed words; a pull request over 11 KB of shared text; and a run with both a preference and a file that contradict each other.
