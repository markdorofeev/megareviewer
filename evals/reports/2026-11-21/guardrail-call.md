# Eval run, 2026-11-21: the guardrail call

Stage 63's second version moves the guardrail out of the four passes into a call of its own after the findings, which groups the reviewer's comments and raised points in a repository by meaning and names the check that could say each group. The passes are byte for byte what they were at `34ee501` (the API's, Claude Code's and Codex's prompt fingerprints are that commit's again), so the 18 cases of the 2026-11-17 report weren't run again, and `evals/baseline.json` is that report's.

The call's four cases ([guardrail-cases.ts](../../guardrail-cases.ts)) ran once on Sonnet 5.5 through the signed-in Claude Code, at medium effort: `node evals/run-guardrails.ts --yes`. What the model answered went through the server's checks, and what they kept was scored. $0.05 in all at API prices, on the plan.

| Case | What it checks | Groups answered | Kept | Time | At API prices |
|---|---|---|---|---|---|
| dropped-promise-typescript | A dropped promise said on four pull requests in four wordings that share no words, among unrelated comments, a `biome.json` without the rule and a finding of that kind | 1, the four signals and the finding, `noFloatingPromises` in Biome, off | 1, a verified rule on `biome.json` | 5.4 s | $0.022 |
| layering-java | Services importing controllers on three pull requests, a `checkstyle.xml` and ArchUnit in the `pom.xml`, and a pair of comments from two pull requests | 1, the three signals and the finding, an architecture rule in ArchUnit | 1, suggested | 3.3 s | $0.011 |
| tenant-isolation-judgment | Tenant isolation on three pull requests | 1, the three signals and the finding, no guardrail | 1, none | 2.9 s | $0.008 |
| nothing-repeats | Twelve unrelated comments | none | none | 1.7 s | $0.007 |

| Metric | This run | Target |
|---|---|---|
| repeatsFound | ✓ 100% (3/3) | ≥ 90% |
| repeatsWrong | ✓ 0% (0/3) | ≤ 10% |
| guardrailRight | ✓ 100% (2/2) | ≥ 90% |
| guardrailWrong | ✓ 0 (0/1) | none |
| findingsNamed | 100% (3/3) | tracked |

What the answers said:

- **The dropped promise** was one group of the four wordings, "Promises that are started without being awaited, returned or handled, so a rejection or failed result goes unnoticed (fire-and-forget calls, dropped results of async functions).", with terms `await`, `promise`, `fire-and-forget`, `rejects`, `unhandled`, `background`, `dropped` and `async`, and the finding about `notifyCustomer`. Its rule is the label's, and the server verified it: `biome.json` doesn't name it.
- **The layering** was one group, "Service-layer classes importing or depending on web-layer controllers…", an architecture rule in ArchUnit, which the `pom.xml` lists, asserting "that classes in the service package do not depend on classes in the web.controller package". The pair about `Optional` wasn't grouped at all; the server would have dropped it for its two pull requests.
- **Tenant isolation** was one group with no guardrail, as the prompt asks of a matter of judgment.

Four cases decide the rates, one or two labels each: a miss is 33 or 50 points. The sentence a group `says` was over 160 characters in two of three cases, under the 300 a preference takes.
