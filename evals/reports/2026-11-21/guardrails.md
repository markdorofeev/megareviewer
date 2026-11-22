# Eval run, 2026-11-21: findings name a guardrail

Stage 63 gave every pass's shared text a `<repository_checks>` block, written only when a case has check configs, a paragraph in the system prompt's data section saying what the block is, and the findings task a `guardrail` field (`claude-code/claude-sonnet-5-5/p11` → `p12`). This run asks whether a review without check configs scores as it did, and whether a finding names a rule of the repository's own tools only where one would catch it and isn't on. Sonnet 5.5 through Claude Code, pipeline 20, judged by `claude-opus-5-5` on Claude Code, `JUDGE_VERSION` 6, which adds a section on the configs for a case that has them and leaves every other case's prompt as it was.

One run of all 21 cases, results file `2026-11-21T12-58-35.652Z`, which is `evals/baseline.json`. Every case scored, and no pass needed a retry. $2.78 for the passes and $3.39 for the judge at API prices, all on the plan.

## Without check configs: the 18 cases of the last baseline

None of them has a config in its files, so their rendered input is the same as before, byte for byte. Only the system prompt and the findings task changed.

| Metric | Baseline, p11 | This run, p12 | Target |
|---|---|---|---|
| contractRecall | ✓ 97% (29/30) | ✓ 97% (29/30) | ≥ 95% |
| riskAccuracy | ✓ 97% (133/137) | ✓ 96% (132/137) | ≥ 85% |
| riskNoise | ✓ 9% (3/32) | ✓ 12% (4/33) | ≤ 20% |
| riskPlaced | ✓ 100% (29/29) | ✓ 100% (29/29) | ≥ 90% |
| coverageWrong | ✓ 0% (0/10) | ✓ 0% (0/6) | 0% |
| coverageRecall | ✓ 91% (10/11) | ✓ 75% (6/8) | ≥ 50% |
| findingRecall | ✗ 82% (14/17) | ✗ 88% (15/17) | ≥ 90% |
| findingNoise | ✓ 0% (0/24) | ✓ 0% (0/24) | ≤ 20% |
| findingPlaced | ✓ 100% (19/19) | ✓ 100% (18/18) | ≥ 90% |
| decisionRecall | ✗ 88% (7/8) | ✗ 88% (7/8) | ≥ 90% |
| decisionNoise | ✓ 11% (4/35) | ✓ 5% (2/41) | ≤ 20% |
| mismatchRecall | ✓ 100% (10/10) | ✓ 100% (10/10) | ≥ 80% |
| mismatchNamed | 100% (8/8) | 100% (8/8) | tracked |
| mismatchFalsePositives | ✗ 4 | ✗ 4 | ≤ 1 |
| guidanceFollowed | ✓ 100% (2/2) | ✓ 100% (2/2) | ≥ 90% |
| leftOutRight | ✓ 100% (6/6) | ✓ 100% (6/6) | 100% |
| guidanceWrong | ✓ 0% (0/5) | ✓ 0% (0/5) | ≤ 10% |

No metric that met its target misses it now, and no finding on these cases names a guardrail: the block isn't there, and the prompt says the field is null without it. The three under target were under before, by the same labels or fewer. What moved:

- **riskNoise, 3 → 4 risks on logic hunks,** one each on migration-non-null-column and delphi-account-connections, which the run's comparison lists. The risk pass's instructions didn't change; the system prompt gained a paragraph, which is the only difference these cases' risk pass reads.
- **coverageRecall, 10/11 → 6/8,** is its denominator, as on 2026-11-17: fewer of delphi's hunks labeled `"either"` were marked contract, and the ones left unmarked had checking tests. The miss on auth-middleware is the same.
- **findingRecall, 14/17 → 15/17:** one more of delphi's must-haves found.
- **mismatchFalsePositives, 4 → 4,** the same four cases as before: auth-middleware, migration-non-null-column, preference-look-for and guideline-file.

## With check configs: the three new cases

| Case | Configs | Finding | Guardrail kept |
|---|---|---|---|
| guardrail-missing-rule | `biome.json` (recommended rules), `tsconfig.json` | "Responds 204 before the paid update runs; failures are unhandled" | `noFloatingPromises` in Biome, which the label lists |
| guardrail-rule-on | `biome.json`, the rule on, `src/legacy` not linted | "202 sent before requeue finishes; a DB error becomes an unhandled rejection" | none: the model named `noFloatingPromises`, which the config names, and the server dropped it |
| guardrail-not-lintable | `biome.json`, `tsconfig.json` | "Any caller can read another tenant's contacts via ?tenant=" | none, and none named |

guardrailRight 1/1, guardrailWrong 0/1. Every must-have finding was found, on its lines, and every risk was where the labels put it.

- **The server's check did its job on guardrail-rule-on.** The prompt says a rule the config turns on isn't a guardrail, and the model named it all the same, the very rule the config sets to `"error"`. The check found the rule's name in `biome.json` and dropped it, keeping the finding. Without it the card would have told the reviewer to turn on a rule that's on.
- **Two mismatches the labels don't expect,** which count in mismatchFalsePositives (6 in all): guardrail-rule-on's description promises "a Retry button" and the PR adds only the route, which is a fair "missing"; guardrail-not-lintable's route lets the caller pick any tenant, which nobody asked for, a fair "unrequested". Both are the case's wording, not the model's mistake. The labels should expect them, or the descriptions say less; either needs a run of its own to measure, so neither was changed here.

## Open

- **Few labels decide the guardrail metrics:** one guardrail to find, and one the server had to drop. More cases, a Ruff and an ESLint one among them, would make them rates.
- **The two new cases' mismatch labels,** above.
