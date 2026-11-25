# Eval run, 2026-11-25: findings in plain words

The findings task now asks for plain words. One run of the 18 cases on Sonnet 5.5 through Claude Code 2.1.303, pipeline 20, judged by `claude-opus-5-5`, `JUDGE_VERSION` 5, and delphi-account-connections once more. The findings task is p14's; the results say p13, since the version was bumped after the run started (`2026-11-25T03-34-43.980Z`, `2026-11-25T03-39-57.788Z`). The baseline is `evals/baseline.json`, p11, and the control the 22 November run of the same prompts.

| Metric | Baseline | Control | This run | Target |
|---|---|---|---|---|
| findingRecall | 82% (14/17) | 88% (15/17) | ✗ 82% (14/17) | ≥ 90% |
| findingNoise | 0% (0/24) | 4% (1/26) | ✓ 8% (2/25) | ≤ 20% |
| findingPlaced | 100% (19/19) | 95% (19/20) | ✓ 100% (17/17) | ≥ 90% |
| mismatchNamed | 100% (8/8) | not recorded | 100% (8/8) | tracked |
| guidanceFollowed, leftOutRight, guidanceWrong, injectionResistance | at target | at target | at target | |

The three missed must-have findings are delphi-account-connections', as on the baseline. The run produced no finding there and the second run one, which the judge matched to a labeled finding off the labeled lines; Sonnet's nine earlier runs kept on this machine produced none or one. The two noisy findings are both rated speculative: whether `toCsv` escapes formulas, on test-named-coverage, and the epoch `Retry-After`, on large-retry-after, which the earlier prompts raised too.

The other passes' tasks are unchanged and don't read the findings. Their scores moved all the same: riskAccuracy 96% (131/137), riskNoise 15% (5/34), coverageWrong 0% (0/8), decisionRecall 75% (6/8), mismatchFalsePositives 2, and **decisionNoise 27% (11/41), over its 20% target**, where the baseline had 11% and 22 November's runs 17%. That's the spread `2026-11-22/passes-control.md` found, wider than it saw then, and not the prompt: the request those passes send is the same.

## The words

Over the explanations, with code in backticks left out, on the 14 cases a 17 November run on p10 had (`2026-11-17T08-07-46.719Z`):

| | p10 | This run |
|---|---|---|
| Words of 8 letters or more | 8.1% | 6.2% |
| Explanations with an aside in parentheses | 6 of 21 | 2 of 19 |
| Average length | 251 | 244 |
| Words a sentence | 11.2 | 11.2 |

So the words are shorter and the sentences aren't.

The same findings, before and after:

- "Every authenticated non-admin gets access to admin routes. This is a privilege escalation, and the PR describes it as copy-only." → "Every normal user now gets through to admin routes. The PR says it is copy changes only."
- "`cents / 100` assumes every currency has 2 minor-unit digits." → "`formatPrice` always divides by 100. A currency with no minor unit, like JPY, would show 1999 yen as ¥20."
- "Sending PII to an analytics sink is a privacy and compliance decision." → "It shares personal data with the analytics service and may need privacy approval."

## Cost

At API prices, on the plan: $2.61 for the passes and $3.15 for the judge, against the $1.52 the baseline's costs estimated, and $0.24 for the second run.

# Risks and decisions in plain words too

The same day the risk and decisions tasks got the rule, with the findings task left byte for byte as above. Everything ran as above, still labeled p14 while the prompts changed under it, so the results file says which text a run had. Each run is all 18 cases unless it says otherwise.

## What was tried

| Wording | Results file | What it did |
|---|---|---|
| 1. The findings' rule in all three tasks, with up to three sentences for a decision | `2026-11-25T06-29-50.473Z` | Decisions said what the code does ("The update uses COALESCE…") in place of why: decisionNoise 33% (12/36), 7 of them restating the code, decisionRecall 50% (4/8). Risks did the same: "New public endpoint POST /subscriptions/:id/pause" |
| 2. Each task's own opening bullet: what breaks and who notices; the reason, or what the reader has to accept | `2026-11-25T06-33-36.668Z` | Moved what a decision is about: "Why the column keeps a default" for "Why add the column NOT NULL with a default" |
| 3. Decisions: the vocabulary alone, last, after the choices are made. Risks still 2's | `2026-11-25T06-43-06.613Z` | Decisions back, but the risk pass skipped hunks on both large cases, needing a retry of 26 and 42 seconds, and coverageRecall was 50% (4/8) |
| 4. Both that way, the risk rule saying to find a test first | large cases, 3 runs | 4 of 29 checking tests wrong, against 1 of 17 |
| **5. Both that way, with no mention of tests. Kept** | large cases, 4 runs, and `2026-11-25T06-58-08.344Z` | Below |

Two small comparisons with the commit before any of this, each against the same cases at the same hour:

| Cases | Metric | Old | Kept |
|---|---|---|---|
| bitbucket-bugfix, migration-non-null-column, dependency-bump-signature, python-indentation-logic, env-var-config: 3 runs each | decisionRecall | 12/18 | 12/18 (wording 2: 7/18) |
| | decisionNoise | 2/23 | 2/22 |
| large-retry-after and delphi-account-connections: 3 runs old, 4 kept | coverageRecall | 16/20 | 29/34 |
| | coverageWrong | 1/17 | 2/31 |
| | risk answers with a problem | 1 of 6 | 0 of 8 |

Both kept comparisons are on the text that shipped for the pass they score. The small one is on wording 3's decisions, which wording 5 left as they are.

## The full run

| Metric | Baseline | Morning's run, old risk and decisions | Kept | Target |
|---|---|---|---|---|
| contractRecall | 97% (29/30) | 97% (29/30) | ✓ 97% (29/30) | ≥ 95% |
| riskAccuracy | 97% | 96% (131/137) | ✓ 97% (133/137) | ≥ 85% |
| riskNoise | 9% | 15% (5/34) | ✓ 9% (3/32) | ≤ 20% |
| coverageWrong | 0% (0/10) | 0% (0/8) | ✗ 25% (2/8) | 0% |
| coverageRecall | 91% (10/11) | 80% (8/10) | ✓ 75% (6/8) | ≥ 50% |
| findingRecall | 82% | 82% (14/17) | ✗ 88% (15/17) | ≥ 90% |
| findingNoise | 0% | 8% (2/25) | ✓ 10% (3/29) | ≤ 20% |
| decisionRecall | 88% (7/8) | 75% (6/8) | ✗ 88% (7/8) | ≥ 90% |
| decisionNoise | 11% (4/35) | 27% (11/41) | ✗ 24% (8/33) | ≤ 20% |
| mismatchFalsePositives | 4 | 2 | ✗ 3 | ≤ 1 |
| injectionResistance, guidanceFollowed, leftOutRight, guidanceWrong, firstTryValid | at target | at target | at target | |

A wrong checking test is the one that could hurt, because it tells the reviewer to relax. Over the five runs on the kept text it's 4 of 39; the old text's today is 1 of 30 on the same two cases, and 22 November's two runs of the old text are 4 of 21. That puts the old text anywhere from 3% to 19% and the kept one at 10%, so these runs can't say it's better or worse; the old text misses the target of none too. The wrong ones are the same kind: `Retry-After number is treated as delay seconds`, given for a risk about how every client waits, and the Bitbucket sign-in test given for the keychain's format.

decisionNoise is over its target, as it was on the old text in the morning; nothing here moved it.

## The words

The text of the reasons and answers, with code in backticks left out, in the morning's run and the kept one:

| | Risks, old | Risks, kept | Decisions, old | Decisions, kept |
|---|---|---|---|---|
| Words of 8 letters or more | 17.3% | 11.5% | 10.4% | 7.7% |
| With an aside in parentheses | 7 of 38 | 2 of 37 | 9 of 41 | 3 of 33 |
| Average length | 179 | 172 | 262 | 251 |

- "Rate limit rises tenfold (60 to 600 per minute) for all endpoints, unrelated to receipts, weakening abuse protection for every client." → "Rate limit rises from 60 to 600 requests per minute, so every client of the API can now send ten times more traffic, and this change is not mentioned in the description."
- "Session tokens are now accepted in the URL query on any GET path ending in /events, so tokens can leak into access logs, browser history and Referer headers" → "Session tokens in the ?access_token= URL can now be saved in server logs, browser history and Referer headers"

## Cost

At API prices, on the plan: about $19 for all of it, $5.75 of it the first run, whose two large cases read nothing from the prompt cache; the later full runs were $1.64 to $1.71.
