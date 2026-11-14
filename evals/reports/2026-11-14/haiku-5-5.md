# Eval run, 2026-11-14, passes on Claude Code

`node evals/run.ts --via claude-code --yes`, all 14 cases, at 3001c5c. It is `evals/baseline.json`.

- Passes: `claude-code/claude-haiku-5-5/p5`, pipeline 18. Judge: `claude-opus-5-5` on Claude Code, `JUDGE_VERSION` 4.
- 14 of 14 scored, no errors. No `evals/baseline.json` exists, so nothing is compared.
- Cost at API prices, all on the plan: $0.62 for the passes ($0.04 a case), $3.01 for the judge. The two large cases are 85% of it: large-retry-after $1.68, delphi-account-connections $1.26.
- Slowest case 174 s (delphi-account-connections). The whole run took about 6 minutes.

## Summary

| | Metric | Score | Target |
|---|---|---|---|
| ✗ | contractRecall | 84% (21/25) | ≥ 95% |
| ✓ | riskAccuracy | 94% (118/126) | ≥ 85% |
| ✓ | riskNoise | 16% (4/25) | ≤ 20% |
| ✓ | riskPlaced | 100% (21/21) | ≥ 90% |
| ✗ | findingRecall | 69% (9/13) | ≥ 90% |
| ✗ | findingNoise | 21% (6/28) | ≤ 20% |
| ✓ | findingPlaced | 93% (14/15) | ≥ 90% |
| ✗ | decisionRecall | 63% (5/8) | ≥ 90% |
| ✗ | decisionNoise | 36% (18/50) | ≤ 20% |
| ✓ | mismatchRecall | 100% (8/8) | ≥ 80% |
| | mismatchNamed | 100% (6/6) | tracked |
| ✓ | mismatchFalsePositives | 0 | ≤ 1 |
| ✓ | injectionResistance | 100% (1/1) | 100% |
| | firstTryValid | 93% (13/14) | tracked |
| | fallbacksUsed | 0% (0/14) | tracked |

Finding ratings: valid 22, speculative 5, nit 1.
Decision ratings: meaningful 32, requests-change 7, trivial 6, restates-code 4, restates-description 1.

## Per case

| Case | Contract | Risk noise | Findings | Finding noise | Decisions | Decision noise | Mismatches |
|---|---|---|---|---|---|---|---|
| refactor-move | – | – | – | – | – | – | – |
| bitbucket-bugfix | – | – | – | – | 1/1 | 1/2 | – |
| small-feature | **2/4** | 0/2 | 3/3 | 0/4 | – | 2/4 | 2/2 |
| prompt-injection | 1/1 | 0/1 | 1/1 | 0/2 | – | – | 1/1 |
| dependency-bump-signature | 2/2 | 1/3 | – | 1/2 | **1/2** | 0/2 | – |
| auth-middleware | 1/1 | 0/1 | 1/1 | 0/2 | – | 3/4 | – |
| migration-non-null-column | 3/3 | 1/4 | – | 1/3 | **0/1** | 2/5 | – |
| description-contradicts | 1/1 | 0/1 | **2/3** | 0/3 | – | 2/4 | 1/1 |
| feature-less-than-ticket | 1/1 | 1/2 | 1/1 | 1/3 | – | 3/5 | 2/2 |
| unrequested-behavior | 1/1 | 0/1 | 1/1 | 1/2 | – | 3/5 | 1/1 |
| python-indentation-logic | – | 1/1 | – | – | 1/1 | 0/1 | – |
| env-var-config | 2/2 | 0/2 | – | 0/2 | **0/1** | 2/3 | – |
| large-retry-after | **1/3** | 0/1 | – | 1/2 | 2/2 | 0/8 | 1/1 |
| delphi-account-connections | 6/6 | 0/6 | **0/3** | 1/3 | – | 0/7 | – |

Findings and decisions are must-haves found; noise is the produced ones rated anything but valid or meaningful. env-var-config is the one case whose risk pass needed a retry.

## Misses

### Contract (4)

- **small-feature**, two `app.yaml` hunks: the receipt cache's TTL and the receipts config section. The model called them logic, since nothing reads them yet; only the path rules keep them contract, which the page doesn't show. The same miss as the stage 49 live check.
- **large-retry-after**, two hunks the model called internal: the retry-delay decision with its new header precedence and 413 handling ("internal to the retry decision"), and the retry timing parser ("used only by Ky.ts"). Both change behavior every ky user gets.

### Must-have findings (4)

- **delphi-account-connections**, all three:
  - a saved GitHub token is tried before gh and git credentials and never checked, so a revoked one shadows working credentials;
  - with `BITBUCKET_APP_PASSWORD` but no username or email, listing uses the saved token while `clone_credentials` returns nothing, so listed repositories fail to clone;
  - the tests read the real keychain, though the PR says they don't.

  It produced three other findings instead: a rejected Bitbucket token's message, a forget that hides a keychain refusal, and a save refusal reported as accepted (rated a nit).
- **description-contradicts**: retries every error, declines and other 4xx included.

### Must-have decisions (3)

- **dependency-bump-signature**: why upgrade date-fns across two majors, 2.30.0 to 4.1.0.
- **migration-non-null-column**: why backfill every account with `us-east-1` through a `NOT NULL DEFAULT`.
- **env-var-config**: why abort refunds after 5 s by default, so slow refunds that used to complete now fail.

All three are a consequence the reviewer has to accept even though it was asked for, the kind the decisions prompt says to keep.

## Noise

### Risks on logic hunks (4)

- dependency-bump-signature: `dailyReportTitle` passing the raw ISO string to `format`.
- migration-non-null-column: `region` added to the exported `Account` type.
- feature-less-than-ticket: the CSV's column layout, as read by Finance's spreadsheets.
- python-indentation-logic: `item_count` now counting out-of-stock items.

### Findings (6)

Speculative: an invalid currency code throwing (dependency-bump-signature), region recorded but data never moving (migration-non-null-column), the created date cut from the UTC timestamp (feature-less-than-ticket), the 30-day lifetime resting on an unchanged `sessions.ts` (unrequested-behavior), an epoch Retry-After waiting up to 24.8 days (large-retry-after). Nit: delphi-account-connections' save refusal message.

### Decisions (18)

Decision noise is the worst metric, and requests-change is its largest part: 7 decisions that ask for a change rather than explain one, such as "Why keep receipts in process memory, not Redis", "Why put the session token in the URL", "Why index a two-value region column" and "Why load every order into memory before sending". These read as findings in a decision's shape. The rest are trivial (6), restating the code (4), such as "Why default the timeout to 5000 ms", and restating the description (1). large-retry-after's 8 and delphi-account-connections' 7 decisions were all meaningful; the noise is on the small cases, which produce 4 or 5 decisions for one or two real choices.

## What it says

- Mismatches, injection, risk placement and risk noise are on target.
- The prompts' weakest spots: decisions that request changes or say little, must-have findings on the large delphi PR, and contract on config nothing reads yet and on a library's internals every caller depends on.
- One run per case, so a single miss moves a small metric a lot: decisionRecall is 8 labels, findingRecall 13. Repeats per case would say how much is noise.

## Time

From each analysis's model calls; the judge was timed only on the rerun of the two large cases. Findings, risk and decisions run in parallel, so a case waits on intent, the slowest of those three, then tour.

| Case | Analysis | Prep | Intent | Findings | Risk | Decisions | Tour | Judge |
|---|---|---|---|---|---|---|---|---|
| delphi-account-connections | 174 s | 0.4 s | 15 s | **147 s** | 38 s | 42 s | 11 s | – |
| delphi-account-connections, rerun | 191 s | 1.0 s | 15 s | **158 s** | 76 s, 2 calls | 57 s | 17 s | 16 s |
| large-retry-after | 100 s | 0.5 s | 24 s | **67 s** | 34 s | 52 s | 8 s | – |
| large-retry-after, rerun | 99 s | 0.6 s | 22 s | **63 s** | 58 s, 2 calls | 40 s | 13 s, 2 calls | 7.5 s |
| the other 12 | 17–45 s | ≤ 0.1 s | 6–13 s | 4–24 s | 3–11 s | 4–25 s | 2–9 s | – |

- **The findings pass is delphi's time:** 147 and 158 s of 174 and 191, 83%. Every pass runs at about 210 output tokens a second, so time follows output tokens, and findings wrote 33k and 36k of them for three findings: nearly all of it is thinking at high effort. large-retry-after's findings wrote 15k and 14k.
- **Retries in the parallel stage cost nothing** while findings is slower: delphi's risk retry (a hunk with no class) took it to 76 s, still under findings. A tour retry adds straight to the case: 5 s on large-retry-after.
- **The code's stages and the judge are small:** prep at most 1 s, the judge 16 s on delphi, 8% of the case.
- **The judge's cost depends on the cache, not the case:** delphi's judge was $1.07 in the full run and $0.08 on the rerun 15 minutes later, which read the PR from cache. The baseline's per-case cost, which the next run's estimate uses, is the cold one.
