# Eval run, 2026-11-25: a type on every finding

Stage 68 has the findings pass look for logic, contract and architecture findings, and gives it the code outside the PR that uses what it changes. One run of 24 cases, the 18 of [findings-only.md](findings-only.md) and six new ones, on Sonnet 5.5 through Claude Code 2.1.303, p16, pipeline 22, judged by `claude-opus-5-5`, `JUDGE_VERSION` 7 (`2026-11-25T17-31-11.146Z`). It met the stage's bar, so it's the only one of the three allowed, and the new baseline. The prompt is the first one tried.

| Metric | Stage 67's 18 cases | These 18 | All 24 | Target |
|---|---|---|---|---|
| findingRecall | 82% (14/17) | 82% (14/17) | ✗ 86% (18/21) | ≥ 90% |
| … logic | 73% (8/11) | 73% (8/11) | 73% (8/11) | |
| … contract | 100% (6/6) | 100% (6/6) | 100% (8/8) | |
| … architecture | | | 100% (2/2) | |
| findingNoise | 4% (1/25) | 0% (0/23) | ✓ 0% (0/27) | ≤ 20% |
| findingPlaced | 100% (17/17) | 100% (17/17) | ✓ 100% (21/21) | ≥ 90% |
| typeRight | | 100% (17/17) | ✓ 100% (21/21) | ≥ 85% |
| unwantedFindings | | | ✓ 0 | 0 |
| mismatchRecall | 100% (10/10) | 100% (10/10) | ✓ 100% (10/10) | ≥ 80% |
| mismatchNamed | 100% (8/8) | 100% (8/8) | 100% (8/8) | tracked |
| mismatchFalsePositives | 4 | 3 | ✗ 6 | ≤ 1 |
| injectionResistance, guidanceFollowed, leftOutRight, guidanceWrong | at target | at target | ✓ at target | |

The bar: noise at most one finding over stage 67's on its cases, logic recall no lower, and no finding on the cases with nothing wrong. Noise by type is 0 of 15 logic findings, 0 of 10 contract and 0 of 2 architecture.

## What it found

- **The three missed must-haves are delphi-account-connections',** as in every run before. It produced no finding there.
- **The contract findings that were logic's before** are the ones a type was the point of: the admin check, the tenant filter, the support role's export, the token in the URL, the data sent to analytics and the rate limit. None of them is new.
- **The four must-haves of the new cases:** "Cards are charged 100 times the order total", on `chargeOrder`, which the PR doesn't change; "Existing sessions can't be read, so signed-in users get errors after deploy"; "Restore route runs its own SQL and skips the service"; "Quote prices can drift from order prices: tiers are copied".
- **Nothing on the two new cases where nothing is wrong,** an optional field in a response, with its callers, and a credential read in another module. Nor any contract or architecture finding on refactor-move, bitbucket-bugfix, dependency-bump-signature, python-indentation-logic or large-retry-after, whose hunks the risk pass used to mark contract.
- **One finding fewer is rated noise:** test-named-coverage's CSV escaping wasn't raised this time.
- **mismatchFalsePositives is 6, three of them on new cases:** the intent calls the unchanged caller "missing", the restore route's SQL "unrequested" and the copied tiers "contradicts". Each is the case's finding, which names the mismatch, so the reviewer reads it once. On the old 18 it's 3.

## What it doesn't show

It's one run of a set where a finding is 4 to 5 points, and architecture is two must-haves in two small cases written for it. How many wrong contract or architecture findings a large PR gets is measured on two: large-retry-after, with one finding, and delphi-account-connections, with none.

## Cost and time

At API prices, on the plan: $2.22 for the passes and $0.51 for the judge. The slowest case took 53 s.
