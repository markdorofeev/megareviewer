# Evals

Measure the model passes on a labeled golden set, so a prompt change is judged by numbers. Run them by hand whenever a prompt, schema or the model changes (ENGINEERING.md §7). CI never runs them, because they cost money or a plan's usage.

## Run

```bash
node evals/run.ts --baseline evals/baseline.json
```

That prints the estimated cost at API prices and stops. Add `--yes` to run, `--case <name>` (repeatable) for a subset, `--model <id>` to run the passes on another option's model, Sonnet 5.5, the product's default, without it (the estimate is still the baseline's model), `--effort low|medium|high` to run every pass at that effort instead of its own, and `--write-baseline` to replace `evals/baseline.json` with this run's scores.

| Part | Runs on | Needs |
|---|---|---|
| The passes | The signed-in Claude Code, on its plan, or with `--via api` the API, or with `--via codex` the signed-in Codex, GPT-6 Sol unless `--model` says otherwise | Anthropic credentials (`ANTHROPIC_API_KEY` or `ant auth login`) for the API; `codex login` for Codex |
| The judge | Always the signed-in Claude Code, on its plan | Claude Code signed in, checked before anything runs |

So by default a run needs no API credentials, and charges nothing per token: the run comes out of the plan's usage limits, and its cost is shown at API prices only to tell a heavy run from a light one. A case the plan's rate limit stops is an error with Claude Code's reason.

For the Claude Code transport, `node evals/record-claude-code.ts` records its fixtures from real runs, and `node evals/calibrate-claude-code.ts` measures the bytes per token its size estimate rests on. Both run on the signed-in Claude Code's plan. `node evals/record-codex.ts` and `node evals/calibrate-codex.ts` do the same for Codex, on its ChatGPT plan.

Each case runs through stage 10's real pipeline with the real Claude adapter and tree-sitter parser; its PR and tickets come from fakes. A Claude Opus 5.5 judge ([judge.ts](judge.ts)) matches the produced findings, decisions and mismatches against the labels and rates each produced finding and decision. It reads the whole PR exactly as the passes did, the same rendered input, so it rates a finding against the code it rests on, in or outside the hunks it cites. It runs through the same locked-down `claude -p` as the passes, and a session on any model but Opus fails the case; a PR too large for its input fails the case too, rather than being cut. The full outputs go to `evals/results/<time>.json` (gitignored), and the summary compares each metric with the baseline and its target. A run worth keeping gets a write-up of its metrics in `evals/reports/<date>/`.

| Metric | Measures | Target |
|---|---|---|
| `contractRecall` | Hunks labeled contract that the page shows as a risk. A miss is the worst model failure | ≥ 95% |
| `riskAccuracy` | Hunks labeled logic or contract shown as labeled: a risk is contract, anything else logic | ≥ 85% |
| `riskNoise` | Risks on hunks labeled logic, out of risks on hunks labeled logic or contract | ≤ 20% |
| `riskPlaced` | Risks on hunks with a `riskAt` that land on lines it names: the model's own lines, or the first changed line its band falls back to | ≥ 90% |
| `coverageWrong` | Checking tests named on risks that aren't where the labels' `checkedBy` puts a test that checks the risk, out of all named. A wrong one tells the reviewer to relax | 0% |
| `coverageRecall` | Risks whose label names a checking test, named there | ≥ 50% |
| `findingRecall` | Must-have findings the judge finds among the produced ones | ≥ 90% |
| `findingNoise` | Produced findings the judge rates speculative or a nit | ≤ 20% |
| `findingPlaced` | Labeled findings found whose produced one rests on a hunk and lines the label names | ≥ 90% |
| `decisionRecall` | Must-have decisions the judge finds among the produced ones | ≥ 90% |
| `decisionNoise` | Produced decisions the judge rates trivial, restating the code or the description, or asking for a change | ≤ 20% |
| `mismatchRecall` | Labeled mismatches found | ≥ 80% |
| `mismatchNamed` | Labeled findings that show a mismatch, both found, whose finding names that mismatch | tracked |
| `mismatchFalsePositives` | Mismatches produced on cases labeled with none, in total | ≤ 1 |
| `injectionResistance` | Injection reported, with risk and must-have findings and decisions as if it weren't there | 100% |
| `guidanceFollowed` | Preferences and guideline files labeled as raising something, with one of their labeled points, a finding or a risk, found and carrying their mark | ≥ 90% |
| `leftOutRight` | Points labeled as covered by a Don't flag preference, absent or marked left out by it; and, on a run that could leave something out, must-have findings and contract hunks not marked left out | 100% |
| `guidanceWrong` | Marks on a point the labels don't put under that preference or file, out of all marks | ≤ 10% |
| `firstTryValid`, `fallbacksUsed` | Risk pass valid without a retry; cases needing a fallback | tracked |

The risk metrics read the risks the page shows, which are the model's contract: a hunk only the path rules mark contract counts as logic, and a hunk labeled `"either"` counts in none of them. A finding or a risk marked left out is folded on the page, so every metric above the guidance ones counts it as not produced.

A case can carry guidance, a reviewer's preferences and the repository's guideline files, which its run reads as a real one would: the preferences from the preference store, the files from the host at the PR's base commit. The three guidance metrics come from the marks the analysis kept, compared with the labels; the judge doesn't rate a mark, it only says which produced finding is which labeled one. On such a case the judge's prompt gains a section saying what the guidance is, so a finding that reports a breach of a guideline file's rule is rated valid; a case without guidance is judged by the prompt it always was.

The summary ends with how many of each rating the judge gave, so a change in noise says which kind moved. Then each case's time, slowest first: the analysis, split into the code's stages (prep) and each pass's calls added up, retries included, and the judge's. Findings, risk and decisions run in parallel, so the slowest of the three is what the case waits on.

A case whose analysis fails or times out, or whose judge fails, is reported as an error and left out of the scores.

## The guardrail call

```bash
node evals/run-guardrails.ts
```

The call a model run makes after its passes, which marks each finding and risk a check could catch, has a golden set of its own in [guardrail-cases.ts](guardrail-cases.ts): a case is the call's input, the run's points with their code, the check configs and the build files, with the pull request's changed paths and a label for every point, the guardrails it accepts or none. Add `--yes` to run it on the signed-in Claude Code with Sonnet 5.5, one call a case. The answer goes through the server's own checks, `guardrailOf` with the case's configs and changed paths, the first mark on a point that exists standing, and what they keep is scored without a judge ([guardrail-score.ts](guardrail-score.ts)); the passes' cases don't run, since the call changes nothing they read.

| Metric | Measures | Target |
|---|---|---|
| `guardrailRight` | Labeled guardrails a point got as one its label accepts: a verified rule of its tool with a listed name, or a suggested check of a listed kind | ≥ 90% |
| `guardrailWrong` | Marks on points labeled none, and verified rules no accepted guardrail of their point lists, out of all marks kept | none |

## Add a case

1. Make `cases/<name>/` with `files/base/` and `files/head/` holding the changed files, and a `case.ts` with the PR's metadata (copy one). Or import a public GitHub PR: `GITHUB_TOKEN=$(gh auth token) node evals/import-pr.ts <url> <name>`.
2. For a synthetic case, write its diff: `node evals/make-diff.ts <name>`.
3. List its hunks with `node evals/print-hunks.ts <name>` (free: it uses the fake model) and write `labels.ts`: a risk class for every hunk without a mechanical proof (`"either"` when it could fairly go both ways), by the risk prompt's rule that contract means a mistake would break or expose something outside the PR; for every contract hunk, `riskAt`, the lines its risk is about, and, when the PR has tests, `checkedBy`: the lines of the tests whose assertions would fail if what the risk is about broke, `[]` when none would, judged by the assertions and never by a test's name; the findings (what looks wrong, the hunks and lines that show it, and the index of the mismatch it shows), the decisions (why the code makes a choice, each a question starting with "Why"), which of both a reviewer must see, and the expected mismatches (`[]` means none).
4. For a case with guidance, export `guidance` from `case.ts`: the preferences in the order a run numbers them (`p1`, `p2`, …, everywhere's before the repository's) and the guideline files, which stay out of `files/`, in the order of `GUIDELINE_PATHS` (`g1`, …) with the files they import after them in `imported`; `print-hunks.ts` lists both with their refs. In the labels' `guidance`, say what each should do, by its ref: `raised` with the labeled findings and the hunks whose risk it should lead to, one of which is enough, or `left-out` with those it covers, none of them a must-have; `alsoOn` lists the points that may carry its mark without being asked to. A preference that should do nothing gets no label, so any mark of it is wrong.
5. Register it in [cases/index.ts](cases/index.ts). `pnpm test` checks the diff, that every hunk is labeled and every contract hunk has a `riskAt` on lines it shows, the labels' hunk IDs, the tickets, and that the guidance labels name refs the run has, with an effect it would keep.

Changing a label, the judge prompt (bump `JUDGE_VERSION`) or the case set makes scores incomparable with the baseline: run again and write a new one.
