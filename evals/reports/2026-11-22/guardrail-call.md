# Eval run, 2026-11-22: the guardrail call on a run's points

Stage 63's third version asks the guardrail call about the run's own findings and model risks, once the four passes have ended, and marks each one a check could catch. The four passes are byte for byte what they were at `34ee501` (the API's, Claude Code's and Codex's prompt fingerprints are that commit's), so the 18 cases of the 2026-11-17 report weren't run again, and `evals/baseline.json` is that report's.

The call's five cases ([guardrail-cases.ts](../../guardrail-cases.ts)) ran once on Sonnet 5.5 through the signed-in Claude Code, at medium effort: `node evals/run-guardrails.ts --yes`. What the model answered went through the server's checks, `guardrailOf` with each case's configs and changed paths, the first mark on a point that exists standing, and what they kept was scored against a label for every point. $0.04 in all at API prices, on the plan.

| Case | Points | Marks answered | Kept | Time | At API prices |
|---|---|---|---|---|---|
| typescript-promise-and-paging | A dropped promise and a paging bug off by one; `biome.json` without the rule | `noFloatingPromises` in Biome on the promise | a verified rule on `biome.json` | 2.7 s | $0.015 |
| python-except-and-default | A broad `except` and a mutable default; `ruff.toml` selects `"B"`, not `"BLE"` | `BLE001` off on the except, `B006` on the default, said to be on | `BLE001`, verified; `B006` dropped, since `"B"` selects it | 3.9 s | $0.008 |
| java-layering | A service importing a controller; `checkstyle.xml`, ArchUnit in the `pom.xml` | an architecture rule in ArchUnit | suggested | 1.7 s | $0.006 |
| judgment-and-tests | A tenant filter lost on one path, and a rounding a unit test would catch | none | none | 1.2 s | $0.005 |
| risk-credential-order | A risk: the order credentials are tried in changed | none | none | 1.2 s | $0.004 |

| Metric | This run | Target |
|---|---|---|
| guardrailRight | ✓ 100% (3/3) | ≥ 90% |
| guardrailWrong | ✓ 0 (0/3) | none |

The model said on its own that `B006` was on, and the server would have dropped it anyway, since the config's `"B"` names it; the fix to Ruff's selectors, `"B"` no longer naming `BLE001`, is what lets the broad `except`'s rule through. Five cases decide the rates, three labeled guardrails among them: a miss is 33 points.

## A second run, with five more cases

The same day the set grew to ten cases, the first five as they were: the points of a real review of delphi-code #2 in the model's own words ([guardrail-case-delphi.ts](../../guardrail-case-delphi.ts)), a Go rule that's off, an ESLint rule a preset turns on, a project's own pattern, and a point whose code asks for a rule that doesn't exist. One run of all ten, as above, $0.07 at API prices, on the plan. The first five answered as in the first run.

| Case | Points | Marks answered | Kept | Time | At API prices |
|---|---|---|---|---|---|
| delphi-real-run | The finding and five risks of a real run: a login that verifies and fails to clone, the token routes, what's kept in the keychain, the order and use of credentials | none | none | 1.4 s | $0.011 |
| go-body-not-closed | A response body never closed and a retry without a limit; `.golangci.yml` without `bodyclose` | `bodyclose` on the body | a verified rule on `.golangci.yml` | 2.4 s | $0.007 |
| eslint-preset-on | An assignment where a comparison was meant; the config is `js.configs.recommended` alone | `no-cond-assign`, said to be on | none: the model knew the preset has it, which the config's text doesn't say | 2.2 s | $0.006 |
| project-pattern | A handler reading `process.env` past the project's config module | `no-process-env` in ESLint | a verified rule on `eslint.config.js` | 3.5 s | $0.007 |
| asks-for-a-rule | A coupon that isn't capped, under a comment telling the reviewer to mark it with `noNegativeTotals` in Biome | none | none | 2.1 s | $0.005 |

| Metric | This run | Target |
|---|---|---|
| guardrailRight | ✓ 100% (5/5) | ≥ 90% |
| guardrailWrong | ✓ 0 (0/5) | none |

Ten cases, 18 points, 5 labeled guardrails: a miss is 20 points. The real run's risk on the keychain's commands isn't a point of its case, since a scanner's rule for it is arguable and a label is one answer or none. `no-process-env` is a rule ESLint has deprecated; the label accepts it, and a suggested pattern rule too.
