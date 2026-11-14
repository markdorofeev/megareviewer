# Eval run, 2026-11-14: GPT-6 Luna and GPT-6 Sol through Codex

`node evals/run.ts --via codex --model gpt-6-luna --baseline evals/baseline.json --yes`, then the same with `--model gpt-6-sol`. All 14 cases, the passes through Codex CLI 0.162.0 on a ChatGPT plan (`codex/gpt-6-luna/p1`, `codex/gpt-6-sol/p1`), with the shared prompts and each pass's own effort, judged by `claude-opus-5-5` on Claude Code, `JUDGE_VERSION` 4. 14 of 14 scored on each. The baseline is the [Haiku run](haiku-5-5.md) of the same day, and [Sonnet](sonnet-5-5.md) is beside it. One run of each.

## Scores

| Metric | Haiku 5.5 | Sonnet 5.5 | GPT-6 Luna | GPT-6 Sol | Target |
|---|---|---|---|---|---|
| contractRecall | ✗ 84% (21/25) | ✓ 100% (25/25) | ✓ 96% (24/25) | ✓ 100% (25/25) | ≥ 95% |
| riskAccuracy | ✓ 94% (118/126) | ✓ 98% (123/126) | ✗ 85% (107/126) | ✗ 83% (104/126) | ≥ 85% |
| riskNoise | ✓ 16% (4/25) | ✓ 11% (3/28) | ✗ **43%** (18/42) | ✗ **47%** (22/47) | ≤ 20% |
| riskPlaced | ✓ 100% (21/21) | ✓ 100% (25/25) | ✓ 96% (23/24) | ✓ 100% (25/25) | ≥ 90% |
| findingRecall | ✗ 69% (9/13) | ✗ 77% (10/13) | ✗ 54% (7/13) | ✗ 69% (9/13) | ≥ 90% |
| findingNoise | ✗ 21% (6/28) | ✓ 0% (0/18) | ✓ 9% (1/11) | ✓ 11% (2/19) | ≤ 20% |
| findingPlaced | ✓ 93% (14/15) | ✓ 100% (13/13) | ✓ 100% (7/7) | ✓ 100% (10/10) | ≥ 90% |
| decisionRecall | ✗ 63% (5/8) | ✗ 75% (6/8) | ✗ **25%** (2/8) | ✗ 75% (6/8) | ≥ 90% |
| decisionNoise | ✗ 36% (18/50) | ✓ 7% (2/29) | ✗ 23% (3/13) | ✓ 18% (5/28) | ≤ 20% |
| mismatchRecall | ✓ 100% (8/8) | ✓ 100% (8/8) | ✓ 100% (8/8) | ✓ 100% (8/8) | ≥ 80% |
| mismatchFalsePositives | ✓ 0 | ✗ 2 | ✓ 0 | ✗ 2 | ≤ 1 |
| injectionResistance | ✓ 1/1 | ✓ 1/1 | ✓ 1/1 | ✓ 1/1 | 100% |
| firstTryValid | 93% (13/14) | 100% (14/14) | 100% (14/14) | 100% (14/14) | tracked |

Targets met: Haiku 7, Sonnet 9, GPT-6 Luna 7, GPT-6 Sol 7 of 12.

Ratings: Luna's 11 findings were 10 valid and 1 speculative, its 13 decisions 10 meaningful and 3 restating the code. Sol's 19 findings were 17 valid, 1 speculative and 1 nit; its 28 decisions 23 meaningful, 1 trivial and 4 restating the code.

## What it says

- **Both are listed,** by stage 51's rule: their scores are recorded here. Neither beats Sonnet, which stays the default; GPT-6 Sol is the default only when Codex is the one provider that can run.
- **Risk is where OpenAI's models fall short.** Both mark far more hunks contract than the labels (42 and 47 risks against 25 contract hunks), so riskNoise is 43% and 47% where Claude's models are at 11–16%. Each risk asks the reviewer to stop, so this is the cost a reviewer on Codex pays most. The risk prompt was tuned against this on Haiku (stage 45); prompts per model are a stage after this one.
- **Luna says little.** 11 findings and 13 decisions over 14 cases, with decisionRecall at 25%: what it says holds, but it misses most of what a reviewer would want to read. Sol finds as much as Haiku with half its finding noise.
- **The injection case is caught by both,** each with a finding that names the hidden instruction ("Reviewer-directed text attempts to suppress security review") beside the real one, that `requireAdmin` lets any signed-in user through.
- **The lockdown never tripped.** In 140 passes no session showed a tool item, and no pass was retried.
- **Two mismatches on unlabeled cases on Sol,** as on Sonnet; dependency-bump-signature's is new.

## Time

| | GPT-6 Luna | GPT-6 Sol |
|---|---|---|
| delphi-account-connections | 70 s | 100 s |
| large-retry-after | 71 s | 104 s |
| The other 12 | 17–50 s | 20–69 s |

Both are faster on the large cases than Haiku (174 s and 100 s) and close to Sonnet. Codex reads the PR again on every pass, since its cache rarely holds across processes (stage 52's measurements), and still answers delphi's risk pass in under a minute.

## Cost at API prices, all on the ChatGPT plan

| | GPT-6 Luna | GPT-6 Sol |
|---|---|---|
| Passes, all cases | $0.15 | $2.98 |
| Passes per case | $0.01 | $0.21 |

Computed from Codex's token counts at OpenAI's prices of 2026-11-14 (Luna $0.10 in and $0.50 out, Sol $2 and $10 per million tokens): Codex reports no cost. Luna costs about a quarter of Haiku at the same list price, because it writes few tokens. The judge was $2.87 on the Luna run and $0.42 on the Sol run, which read the PRs from the first run's cache.

One run per model, so the small metrics move by one label, as in the Claude reports.
